/**
 * The screen's copies of the drafts it edits. The runtime holds every draft;
 * this copy exists so typing shows at once. A destination's copy is either
 * following the runtime, and replaced by every new runtime text, or holding
 * edits not yet confirmed, and then left alone by later runtime text until
 * they are. One edit per destination is in flight at a time, always from the
 * revision the runtime confirmed last, so an edit never overwrites a text it
 * did not start from. A refused edit gives the copy back to the runtime's
 * text.
 */
import type { Draft, InvokeResult } from "../protocol/wire";
import { Emitter } from "./ui/controllers";

interface Local {
  text: string;
  /** The runtime revision `text` was last confirmed as. */
  revision: number;
  /** Local text the runtime has not confirmed. */
  dirty: boolean;
  sending: Promise<void> | undefined;
}

export interface DraftHost {
  drafts(): Record<string, Draft>;
  writable(): boolean;
  invoke(action: string, args: unknown): Promise<InvokeResult>;
  notify(text: string): void;
}

export class Drafts extends Emitter {
  readonly #local = new Map<string, Local>();
  readonly #replaced = new Map<string, number>();

  constructor(readonly host: DraftHost) {
    super();
  }

  /** The text to show for a destination. */
  text(destination: string): string {
    const local = this.#local.get(destination);
    return local?.dirty || local?.sending
      ? local.text
      : (this.host.drafts()[destination]?.text ?? "");
  }

  /** Follows new runtime drafts for destinations without pending edits. */
  sync(): void {
    const drafts = this.host.drafts();
    let changed = false;
    for (const [destination, local] of this.#local) {
      const runtime = drafts[destination];
      if (!runtime) {
        this.#local.delete(destination);
        changed = true;
        continue;
      }
      if (local.dirty || local.sending) continue;
      if (local.text !== runtime.text || local.revision !== runtime.revision) {
        local.text = runtime.text;
        local.revision = runtime.revision;
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** The user typed; returns false when this screen may not write. */
  edit(destination: string, text: string): boolean {
    const runtime = this.host.drafts()[destination];
    if (!runtime) return false;
    if (!this.host.writable()) {
      this.host.notify("This screen views only; take the write to type");
      this.#replace(destination);
      return false;
    }
    let local = this.#local.get(destination);
    if (!local) {
      local = {
        text: runtime.text,
        revision: runtime.revision,
        dirty: false,
        sending: undefined,
      };
      this.#local.set(destination, local);
    }
    if (local.text === text) return true;
    local.text = text;
    local.dirty = true;
    this.changed();
    this.#send(destination, local);
    return true;
  }

  #send(destination: string, local: Local): void {
    if (local.sending || !local.dirty) return;
    local.dirty = false;
    const text = local.text;
    local.sending = (async () => {
      const result = await this.host.invoke("draft.set", {
        destination,
        text,
        base: local.revision,
      });
      if (result.outcome === "rejected") {
        // The runtime's text wins; what was typed meanwhile is dropped with it.
        const runtime = this.host.drafts()[destination];
        local.dirty = false;
        local.text = runtime?.text ?? "";
        local.revision = runtime?.revision ?? 0;
        this.#replace(destination);
        this.host.notify(`The draft was not saved (${result.code}); it shows the agent's text`);
      } else {
        local.revision = (result.detail as { revision: number }).revision;
      }
    })().finally(() => {
      local.sending = undefined;
      if (local.dirty) this.#send(destination, local);
      else this.sync();
      this.changed();
    });
  }

  /**
   * Counts the times typing in the destination was undone, by a refused edit
   * or because this screen may not write, so the editor shows the draft again.
   */
  replaced(destination: string): number {
    return this.#replaced.get(destination) ?? 0;
  }

  #replace(destination: string): void {
    this.#replaced.set(destination, this.replaced(destination) + 1);
    this.changed();
  }

  /**
   * Waits until every edit of the destination is confirmed, and resolves with
   * the revision the runtime holds the text shown now as; undefined when the
   * runtime ends up with another text, as after a refused edit.
   */
  async settle(destination: string): Promise<number | undefined> {
    const expected = this.text(destination);
    for (;;) {
      const local = this.#local.get(destination);
      if (!local) {
        const runtime = this.host.drafts()[destination];
        return runtime?.text === expected ? runtime.revision : undefined;
      }
      if (local.sending) {
        await local.sending;
        continue;
      }
      if (local.dirty) {
        this.#send(destination, local);
        continue;
      }
      const runtime = this.host.drafts()[destination];
      return local.text === expected && runtime?.text === expected ? local.revision : undefined;
    }
  }
}
