/**
 * What this screen's stage has selected: a request, an assist, or nothing, in
 * which case the editor shows the prompt. The selection and the cursor among
 * a request's options or an assist's candidates are this screen's alone; the
 * requests, assists, and their drafts are the runtime's. A new request never
 * changes the selection; a selected request that closes leaves the stage on
 * nothing.
 */
import { type AssistInfo, PROMPT, type RequestInfo, type State } from "../protocol/wire";
import { Emitter } from "./ui/controllers";

export type Target = { kind: "request"; info: RequestInfo } | { kind: "assist"; info: AssistInfo };

export class StageModel extends Emitter {
  #selected: { kind: "request" | "assist"; id: string } | undefined;
  readonly #cursors = new Map<string, number>();

  constructor(readonly state: () => State | undefined) {
    super();
  }

  /** Requests in arrival order, then assists. */
  targets(): Target[] {
    const state = this.state();
    if (!state) return [];
    return [
      ...state.requests.map((info) => ({ kind: "request" as const, info })),
      ...state.assists.map((info) => ({ kind: "assist" as const, info })),
    ];
  }

  selected(): Target | undefined {
    const selected = this.#selected;
    if (!selected) return undefined;
    return this.targets().find(
      (target) => target.kind === selected.kind && target.info.id === selected.id,
    );
  }

  /** The draft the editor shows. */
  destination(): string {
    return this.selected()?.info.destination ?? PROMPT;
  }

  /** Drops a selection whose target closed. */
  sync(): void {
    if (this.#selected && !this.selected()) {
      this.#selected = undefined;
      this.changed();
    }
  }

  select(kind: "request" | "assist", id: string): boolean {
    if (!this.targets().some((target) => target.kind === kind && target.info.id === id))
      return false;
    this.#selected = { kind, id };
    this.changed();
    return true;
  }

  move(delta: number): void {
    const targets = this.targets();
    if (targets.length === 0) return;
    const current = this.selected();
    const index = current
      ? targets.findIndex((t) => t.kind === current.kind && t.info.id === current.info.id)
      : delta > 0
        ? -1
        : targets.length;
    const next = targets[(index + delta + targets.length) % targets.length]!;
    this.#selected = { kind: next.kind, id: next.info.id };
    this.changed();
  }

  leave(): void {
    if (!this.#selected) return;
    this.#selected = undefined;
    this.changed();
  }

  /** The cursor among the selected target's options or candidates, kept in range. */
  cursor(target = this.selected()): number {
    if (!target) return 0;
    const count =
      target.kind === "request" ? target.info.options.length : target.info.candidates.length;
    const value = this.#cursors.get(`${target.kind}:${target.info.id}`) ?? 0;
    return Math.max(0, Math.min(Math.max(0, count - 1), value));
  }

  moveCursor(delta: number): void {
    const target = this.selected();
    if (!target) return;
    this.#cursors.set(`${target.kind}:${target.info.id}`, this.cursor(target) + delta);
    this.changed();
  }

  /** Requests nobody has selected, for the hint the stage shows while it has nothing. */
  waiting(): number {
    return this.state()?.requests.length ?? 0;
  }
}
