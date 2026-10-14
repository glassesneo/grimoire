/** The command palette's state, copied from the harness: a stage request that picks a command, then its candidate or an argument drafted in the editor. */
import { type Registration, type StageContentType, type StageHandle, type StageController } from "./controllers";
import type { EditorController } from "./editor-engine";

export interface CommandCandidate {
  value: string;
  label: string;
  description?: string;
  current?: boolean;
}
export interface QuinCommand {
  name: string;
  description: string;
  acceptsArguments: boolean;
  candidates?(): readonly CommandCandidate[] | Promise<readonly CommandCandidate[]>;
  execute(argument?: string): void | Promise<void>;
}
export interface CommandValue {
  query: string;
  queryCursor: number;
  cursor: number;
  mode: "name" | "loading" | "candidates" | "arguments" | "executing";
  command?: QuinCommand;
  candidates: readonly CommandCandidate[];
  filtered: readonly CommandCandidate[];
  destination?: string;
}

/** Native commands and their drafts outlive pi registrations, not candidate generations. */
export class CommandController<Render = unknown> {
  readonly #definitions = new Map<string, QuinCommand>();
  #type: StageContentType<CommandValue, Render> | undefined;
  #handle: StageHandle<CommandValue> | undefined;
  #draft: AbortController | undefined;
  #operation = 0;
  readonly #unsubscribe: () => void;

  constructor(readonly stage: StageController<Render>, readonly editor: EditorController, readonly notify: (text: string) => void) {
    this.#unsubscribe = editor.subscribe(() => {
      const handle = this.#handle;
      if (!handle) return;
      const value = handle.value();
      if (value.mode !== "arguments" || editor.snapshot().destination !== value.destination || !value.command?.candidates) return;
      const query = editor.text().toLowerCase();
      const filtered = value.candidates.filter((candidate) => `${candidate.label} ${candidate.value}`.toLowerCase().includes(query));
      const selected = value.filtered[value.cursor]?.value;
      const cursor = Math.max(0, filtered.findIndex((candidate) => candidate.value === selected));
      handle.update({ ...value, filtered, cursor });
    });
  }

  register(definition: QuinCommand): Registration {
    if (!definition.name || /\s/.test(definition.name)) throw new Error("Command names must be a single nonempty name");
    if (this.#definitions.has(definition.name)) throw new Error(`duplicate command registration: ${definition.name}`);
    this.#definitions.set(definition.name, definition);
    this.#refresh();
    return { dispose: () => {
      if (this.#definitions.get(definition.name) !== definition) return;
      this.#definitions.delete(definition.name);
      this.#refresh();
    } };
  }

  setType(type: StageContentType<CommandValue, Render>): void { this.#type = type; }

  names(query = this.#handle?.value().query ?? ""): readonly QuinCommand[] {
    return [...this.#definitions.values()].filter((command) => command.name.toLowerCase().includes(query.toLowerCase()));
  }

  open(): void {
    if (this.#handle) { this.stage.activate(this.#handle.id); return; }
    if (!this.#type) throw new Error("Command UI is not set up");
    const handle = this.stage.show({ requester: "quin", type: this.#type,
      value: { query: "", queryCursor: 0, cursor: 0, mode: "name", candidates: [], filtered: [] }, preferredHeight: 10 });
    this.#handle = handle;
    void handle.closed.then(() => { if (this.#handle === handle) this.#finish(handle); });
  }

  value(): CommandValue | undefined { return this.#handle?.value(); }
  id(): string | undefined { return this.#handle?.id; }
  acceptsText(): boolean { return this.stage.active()?.acceptsText ?? false; }
  ownsDraft(): boolean {
    const value = this.value();
    return value?.mode === "arguments" && value.destination === this.editor.snapshot().destination;
  }

  setQuery(query: string, cursor = query.length): void {
    const handle = this.#handle;
    if (!handle || !this.#front(handle) || handle.value().mode !== "name") return;
    if (/\s/.test(query)) { this.notify("Command input accepts a single name, not arguments"); handle.update({ ...handle.value() }); return; }
    const value = handle.value();
    const selected = this.names(value.query)[value.cursor]?.name;
    const names = this.names(query);
    handle.update({ ...value, query, queryCursor: cursor, cursor: Math.max(0, names.findIndex((command) => command.name === selected)) });
  }

  setQueryCursor(cursor: number): void {
    const handle = this.#handle;
    if (handle && this.#front(handle) && handle.value().mode === "name" && handle.value().queryCursor !== cursor) handle.update({ ...handle.value(), queryCursor: cursor });
  }

  move(delta: number, draft = false): void {
    const handle = this.#handle;
    if (!handle || (draft ? !this.ownsDraft() : !this.#front(handle))) return;
    const value = handle.value();
    if (!["name", "candidates", "arguments"].includes(value.mode)) return;
    const count = value.mode === "name" ? this.names().length : value.filtered.length;
    handle.update({ ...value, cursor: Math.max(0, Math.min(count - 1, value.cursor + delta)) });
  }

  async confirm(): Promise<void> {
    const handle = this.#handle;
    if (!handle || !this.#front(handle)) return;
    const value = handle.value();
    if (value.mode === "name") {
      const command = this.names()[value.cursor];
      if (!command) { this.notify("Unknown command"); return; }
      if (command.candidates) await this.#load(handle, command, false);
      else await this.#execute(handle, command);
    } else if (value.mode === "candidates" && value.command) {
      const candidate = value.filtered[value.cursor];
      if (candidate) await this.#execute(handle, value.command, candidate.value);
    }
  }

  async arguments(): Promise<void> {
    const handle = this.#handle;
    if (!handle || !this.#front(handle) || this.#draft) return;
    const value = handle.value();
    if (value.mode !== "name" && value.mode !== "candidates") return;
    const command = value.command ?? this.names()[value.cursor];
    if (!command?.acceptsArguments) return;
    if (command.candidates) await this.#load(handle, command, true);
    else this.#openDraft(handle, command, []);
  }

  cancel(): void {
    const handle = this.#handle;
    if (handle && this.#front(handle)) this.#close(handle);
  }

  resetGeneration(): void {
    const handle = this.#handle;
    if (!handle) return;
    const value = handle.value();
    if (value.mode === "loading" || value.mode === "candidates" || (value.mode === "arguments" && value.command?.candidates)) {
      this.notify("Command candidates became unavailable when the session generation ended");
      this.#close(handle);
    }
  }

  dispose(): void {
    if (this.#handle) this.#close(this.#handle);
    this.#unsubscribe();
  }

  #front(handle: StageHandle<CommandValue>): boolean { return this.#handle === handle && this.stage.active()?.id === handle.id && this.stage.focused(); }
  #refresh(): void {
    const handle = this.#handle;
    if (handle?.value().mode === "name") handle.update({ ...handle.value(), cursor: Math.min(handle.value().cursor, Math.max(0, this.names().length - 1)) });
  }

  async #load(handle: StageHandle<CommandValue>, command: QuinCommand, draft: boolean): Promise<void> {
    const operation = ++this.#operation;
    handle.update({ ...handle.value(), mode: "loading", command });
    try {
      const candidates = await command.candidates!();
      if (this.#handle !== handle || this.#operation !== operation) return;
      if (!candidates.length) throw new Error("No command candidates are available");
      if (draft) this.#openDraft(handle, command, candidates);
      else handle.update({ ...handle.value(), mode: "candidates", candidates, filtered: candidates, cursor: 0 });
    } catch (error) {
      if (this.#handle !== handle || this.#operation !== operation) return;
      this.notify(String(error)); this.#close(handle);
    }
  }

  #openDraft(handle: StageHandle<CommandValue>, command: QuinCommand, candidates: readonly CommandCandidate[]): void {
    const abort = new AbortController();
    this.#draft = abort;
    const destination = `command:${handle.id}`;
    handle.update({ ...handle.value(), mode: "arguments", command, destination, candidates, filtered: candidates, cursor: 0 });
    let argument: string | undefined;
    void this.editor.openDraft({ destination, label: `command: ${command.name}`, requester: "editor", fresh: true, signal: abort.signal,
      validateSubmit: (text) => {
        if (this.#handle !== handle) return false;
        const selected = handle.value().filtered[handle.value().cursor];
        if (command.candidates && !selected) { this.notify("No matching command candidate"); return false; }
        argument = command.candidates ? selected!.value : text;
        return true;
      },
    }).then(async (result) => {
      if (this.#draft === abort) this.#draft = undefined;
      if (this.#handle !== handle) return;
      if (result.status === "submitted") await this.#execute(handle, command, argument);
      else {
        handle.update({ ...handle.value(), mode: "name", command: undefined, destination: undefined, cursor: 0, candidates: [], filtered: [] });
        this.stage.activate(handle.id);
      }
    });
  }

  async #execute(handle: StageHandle<CommandValue>, command: QuinCommand, argument?: string): Promise<void> {
    if (this.#handle !== handle || handle.value().mode === "executing") return;
    handle.update({ ...handle.value(), mode: "executing", command });
    try { await command.execute(argument); }
    catch (error) { this.notify(String(error)); }
    finally { if (this.#handle === handle) this.#close(handle); }
  }

  #finish(handle: StageHandle<CommandValue>): void {
    if (this.#handle !== handle) return;
    this.#handle = undefined;
    this.#operation++;
    this.#draft?.abort();
    this.#draft = undefined;
  }
  #close(handle: StageHandle<CommandValue>): void { this.#finish(handle); handle.close(); }
}
