/**
 * The runtime's state and its sequence. Changes made in one synchronous step
 * become one event: a change marks its section, and the store publishes every
 * marked section together at the end of the current task, or when asked to.
 * `seq` counts events from 1; a snapshot carries the last one it includes.
 *
 * Drafts carry a revision that grows with every change. A writer's edit names
 * the revision it started from and is refused when the draft moved on, so a
 * late edit never overwrites a newer text.
 */
import type { ActionDefinition, AssistProvider, Disposable, RequestAnswer } from "../api";
import { applyKeyConfig, validActionId } from "../protocol/keys";
import {
  type ActionInfo,
  type AssistInfo,
  assistDestination,
  type Candidate,
  type Changes,
  type Draft,
  PROMPT,
  type QueueInfo,
  type RequestInfo,
  requestDestination,
  type RunInfo,
  type RuntimeOutput,
  type SessionInfo,
  type Snapshot,
  type State,
} from "../protocol/wire";
import { Timeline } from "./timeline";

type Section = Exclude<keyof Changes, "items" | "order">;

interface Registered {
  definition: ActionDefinition;
  token: object;
}

interface PendingRequest {
  info: RequestInfo;
  resolve(answer: RequestAnswer<unknown>): void;
  onAbort?: () => void;
  signal?: AbortSignal;
}

interface Assist {
  provider: AssistProvider;
  token: object;
  info: AssistInfo;
  /** The revision whose candidates are being computed. */
  pending: number | undefined;
}

/** An operation the runtime took; its effects follow as events. */
export class Accepted {
  constructor(readonly detail?: unknown) {}
}

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

export class Store {
  readonly timeline: Timeline;
  readonly #emit: (record: RuntimeOutput) => void;
  readonly instance: string;
  #seq = 0;
  #dirty = new Set<Section>();
  #itemsDirty = false;
  #scheduled = false;
  session: SessionInfo;
  run: RunInfo = { phase: "idle", compacting: false, retrying: false };
  queue: QueueInfo = { steering: [], followUp: [] };
  readonly #drafts = new Map<string, Draft>([[PROMPT, { text: "", revision: 0 }]]);
  /** The latest revision of each draft claimed for sending. */
  readonly #claimed = new Map<string, number>();
  readonly #requests = new Map<string, PendingRequest>();
  readonly #assists = new Map<string, Assist>();
  readonly #actions = new Map<string, Registered>();
  readonly #kinds = new Map<string, { renderer: string; token: object }>();
  #keys: Record<string, string[]> = {};
  #keyConfig: unknown;
  #keysApplied = false;
  readonly #reportedKeyProblems = new Set<string>();
  #nextRequest = 0;
  /** Requests made while stopping are cancelled at once. */
  refuseRequests = false;
  #items: State["items"] = [];

  constructor(options: {
    emit: (record: RuntimeOutput) => void;
    instance: string;
    session: SessionInfo;
  }) {
    this.#emit = options.emit;
    this.instance = options.instance;
    this.session = options.session;
    this.timeline = new Timeline({
      model: options.session.model ?? undefined,
      thinking: options.session.thinking ?? undefined,
    });
  }

  get seq(): number {
    return this.#seq;
  }

  mark(section: Section): void {
    this.#dirty.add(section);
    this.#schedule();
  }

  /** The timeline changed; its items are published with the next event. */
  items(): void {
    this.#itemsDirty = true;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** Publishes the pending changes as one event, and returns the seq that includes them. */
  flush(): number {
    this.#scheduled = false;
    const changes: Changes = {};
    if (this.#itemsDirty) {
      this.#itemsDirty = false;
      const published = this.timeline.publish();
      this.#items = published.items;
      if (published.changed.length) changes.items = published.changed;
      if (published.order) changes.order = published.order;
    }
    for (const section of this.#dirty)
      Object.assign(changes, { [section]: this.#section(section) });
    this.#dirty.clear();
    if (Object.keys(changes).length === 0) return this.#seq;
    this.#seq++;
    this.#emit({
      type: "event",
      event: { runtimeInstance: this.instance, seq: this.#seq, changes },
    });
    return this.#seq;
  }

  snapshot(): Snapshot {
    this.flush();
    return {
      runtimeInstance: this.instance,
      seq: this.#seq,
      state: {
        session: this.session,
        run: this.run,
        items: this.#items,
        queue: this.queue,
        requests: this.#section("requests") as RequestInfo[],
        assists: this.#section("assists") as AssistInfo[],
        drafts: this.#section("drafts") as Record<string, Draft>,
        actions: this.#section("actions") as ActionInfo[],
        keys: this.#keys,
        kinds: this.#section("kinds") as Record<string, string>,
      },
    };
  }

  #section(section: Section): unknown {
    switch (section) {
      case "session":
        return this.session;
      case "run":
        return this.run;
      case "queue":
        return this.queue;
      case "requests":
        return [...this.#requests.values()].map((request) => request.info);
      case "assists":
        return [...this.#assists.values()].map((assist) => assist.info);
      case "drafts":
        return Object.fromEntries(this.#drafts);
      case "actions":
        return [...this.#actions.values()].map(({ definition }): ActionInfo => ({
          id: definition.id,
          class: definition.class ?? "write",
          ...(definition.title ? { title: definition.title } : {}),
          local: definition.run === undefined,
        }));
      case "keys":
        return this.#keys;
      case "kinds":
        return Object.fromEntries([...this.#kinds].map(([kind, { renderer }]) => [kind, renderer]));
    }
  }

  setRun(changes: Partial<RunInfo>): void {
    const next = { ...this.run, ...changes };
    if (JSON.stringify(next) === JSON.stringify(this.run)) return;
    this.run = next;
    this.mark("run");
  }

  setSession(changes: Partial<SessionInfo>): void {
    const next = { ...this.session, ...changes };
    if (JSON.stringify(next) === JSON.stringify(this.session)) return;
    this.session = next;
    this.mark("session");
  }

  setQueue(queue: QueueInfo): void {
    if (JSON.stringify(queue) === JSON.stringify(this.queue)) return;
    this.queue = { steering: [...queue.steering], followUp: [...queue.followUp] };
    this.mark("queue");
  }

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  draft(destination: string): Draft {
    return this.#drafts.get(destination) ?? { text: "", revision: 0 };
  }

  /** Whether the destination is one a draft may be written to now. */
  destinationOpen(destination: string): boolean {
    if (destination === PROMPT) return true;
    const [kind, id] = splitDestination(destination);
    if (kind === "request") return this.#requests.has(id);
    if (kind === "assist") return this.#assists.has(id);
    return false;
  }

  /** The runtime replaces a draft; returns its new revision. */
  setDraft(destination: string, text: string): number {
    const previous = this.draft(destination);
    if (previous.text === text && this.#drafts.has(destination)) return previous.revision;
    const draft = { text, revision: previous.revision + 1 };
    this.#drafts.set(destination, draft);
    this.mark("drafts");
    this.#draftChanged(destination);
    return draft.revision;
  }

  /** A writer's edit, refused unless it starts from the current revision. */
  editDraft(destination: string, text: string, base: number): number {
    if (!this.destinationOpen(destination)) throw new StoreError("closed_destination");
    const current = this.draft(destination);
    if (base !== current.revision) throw new StoreError("stale_revision");
    return this.setDraft(destination, text);
  }

  /**
   * Claims the draft's current `revision` for sending: a revision is claimed
   * once, so one already sent, or being sent, is refused. The returned
   * function gives the claim back, for a send that did not happen.
   */
  claimDraft(destination: string, revision: number): () => void {
    const claimed = this.#claimed.get(destination) ?? -1;
    if (this.draft(destination).revision !== revision || revision <= claimed)
      throw new StoreError("stale_revision");
    this.#claimed.set(destination, revision);
    return () => {
      if (this.#claimed.get(destination) === revision) this.#claimed.set(destination, claimed);
    };
  }

  /** Clears a draft only if it is still the revision that was sent. */
  clearDraft(destination: string, revision: number): boolean {
    if (this.draft(destination).revision !== revision) return false;
    this.setDraft(destination, "");
    return true;
  }

  #dropDraft(destination: string): void {
    if (this.#drafts.delete(destination)) this.mark("drafts");
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  request<T>(
    info: Omit<RequestInfo, "id" | "destination">,
    signal: AbortSignal | undefined,
  ): Promise<RequestAnswer<T>> {
    if (this.refuseRequests || signal?.aborted)
      return Promise.resolve({ status: "cancelled" as const });
    const id = `r${this.#nextRequest++}`;
    const destination = requestDestination(id);
    return new Promise((resolve) => {
      const pending: PendingRequest = {
        info: { ...info, id, destination },
        resolve: resolve as PendingRequest["resolve"],
        signal,
      };
      if (signal) {
        pending.onAbort = () => this.#close(id, { status: "cancelled" });
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.#requests.set(id, pending);
      this.#drafts.set(destination, { text: "", revision: 0 });
      this.mark("requests");
      this.mark("drafts");
    });
  }

  requestInfo(id: string): RequestInfo | undefined {
    return this.#requests.get(id)?.info;
  }

  /**
   * Answers a request with one of its options and its supplement as of
   * `revision`. Throws when the request is closed, the value is not an
   * option, or the supplement moved on.
   */
  answer(id: string, value: string, revision: number): void {
    const pending = this.#requests.get(id);
    if (!pending) throw new StoreError("request_closed");
    if (!pending.info.options.includes(value)) throw new StoreError("invalid_answer");
    const draft = this.draft(pending.info.destination);
    if (draft.revision !== revision) throw new StoreError("stale_revision");
    const answer =
      pending.info.kind === "confirm"
        ? {
            status: "answered" as const,
            value: value === pending.info.options[0],
            supplement: draft.text,
          }
        : { status: "answered" as const, value, supplement: draft.text };
    this.#close(id, answer);
  }

  cancelRequests(): void {
    for (const id of this.#requests.keys()) this.#close(id, { status: "cancelled" });
  }

  #close(id: string, answer: RequestAnswer<unknown>): void {
    const pending = this.#requests.get(id);
    if (!pending) return;
    this.#requests.delete(id);
    if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
    this.#dropDraft(pending.info.destination);
    this.mark("requests");
    pending.resolve(answer);
  }

  // -------------------------------------------------------------------------
  // Assists
  // -------------------------------------------------------------------------

  registerAssist(provider: AssistProvider): Disposable {
    if (!/^[a-z0-9_-]+$/.test(provider.id)) throw new Error(`invalid assist id: ${provider.id}`);
    if (this.#assists.has(provider.id)) throw new Error(`duplicate assist: ${provider.id}`);
    const token = {};
    const destination = assistDestination(provider.id);
    const assist: Assist = {
      provider,
      token,
      info: { id: provider.id, title: provider.title, destination, revision: -1, candidates: [] },
      pending: undefined,
    };
    this.#assists.set(provider.id, assist);
    if (!this.#drafts.has(destination)) this.#drafts.set(destination, { text: "", revision: 0 });
    this.mark("assists");
    this.mark("drafts");
    this.#refreshAssist(assist);
    return {
      dispose: () => {
        if (this.#assists.get(provider.id)?.token !== token) return;
        this.#assists.delete(provider.id);
        this.#dropDraft(destination);
        this.mark("assists");
      },
    };
  }

  assistIds(): string[] {
    return [...this.#assists.keys()];
  }

  async queryAssist(id: string, text: string): Promise<readonly Candidate[]> {
    const assist = this.#assists.get(id);
    if (!assist) throw new StoreError("unknown_assist");
    return assist.provider.candidates(text);
  }

  assistInfo(id: string): AssistInfo | undefined {
    return this.#assists.get(id)?.info;
  }

  #draftChanged(destination: string): void {
    const [kind, id] = splitDestination(destination);
    if (kind !== "assist") return;
    const assist = this.#assists.get(id);
    if (assist) this.#refreshAssist(assist);
  }

  #refreshAssist(assist: Assist): void {
    const draft = this.draft(assist.info.destination);
    const revision = draft.revision;
    assist.pending = revision;
    void Promise.resolve()
      .then(() => assist.provider.candidates(draft.text))
      .then(
        (candidates) => {
          if (this.#assists.get(assist.info.id) !== assist || assist.pending !== revision) return;
          assist.pending = undefined;
          assist.info = { ...assist.info, revision, candidates: [...candidates] };
          this.mark("assists");
        },
        (error: unknown) => {
          if (this.#assists.get(assist.info.id) !== assist || assist.pending !== revision) return;
          assist.pending = undefined;
          assist.info = { ...assist.info, revision, candidates: [] };
          this.mark("assists");
          this.notice(
            "warning",
            `assist ${assist.info.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
  }

  // -------------------------------------------------------------------------
  // Actions, keys, and kinds
  // -------------------------------------------------------------------------

  registerActions(definitions: readonly ActionDefinition[]): Disposable {
    const batch = new Set<string>();
    for (const definition of definitions) {
      if (!validActionId(definition.id)) throw new Error(`invalid action id: ${definition.id}`);
      if (batch.has(definition.id) || this.#actions.has(definition.id))
        throw new Error(`duplicate action: ${definition.id}`);
      if (definition.class && !["view", "control", "write"].includes(definition.class))
        throw new Error(`invalid class of ${definition.id}: ${definition.class}`);
      batch.add(definition.id);
    }
    const token = {};
    for (const definition of definitions) this.#actions.set(definition.id, { definition, token });
    this.mark("actions");
    this.#reapplyKeys();
    return {
      dispose: () => {
        let removed = false;
        for (const definition of definitions)
          if (this.#actions.get(definition.id)?.token === token) {
            this.#actions.delete(definition.id);
            removed = true;
          }
        if (removed) {
          this.mark("actions");
          this.#reapplyKeys();
        }
      },
    };
  }

  action(id: string): ActionDefinition | undefined {
    return this.#actions.get(id)?.definition;
  }

  /** Applies the key configuration; until this runs, published keys stay empty. */
  applyKeys(config: unknown): void {
    this.#keyConfig = config;
    this.#keysApplied = true;
    this.#reapplyKeys();
  }

  #reapplyKeys(): void {
    if (!this.#keysApplied) return;
    const { keys, diagnostics } = applyKeyConfig(
      [...this.#actions.values()].map(({ definition }) => definition),
      this.#keyConfig,
    );
    for (const diagnostic of diagnostics) {
      if (this.#reportedKeyProblems.has(diagnostic.text)) continue;
      this.#reportedKeyProblems.add(diagnostic.text);
      this.notice(diagnostic.level, diagnostic.text);
    }
    if (JSON.stringify(keys) === JSON.stringify(this.#keys)) return;
    this.#keys = keys;
    this.mark("keys");
  }

  present(kind: string, renderer: string): Disposable {
    if (this.#kinds.has(kind)) throw new Error(`items of ${kind} are already presented`);
    const token = {};
    this.#kinds.set(kind, { renderer, token });
    this.mark("kinds");
    return {
      dispose: () => {
        if (this.#kinds.get(kind)?.token !== token) return;
        this.#kinds.delete(kind);
        this.mark("kinds");
      },
    };
  }

  notice(level: "info" | "warning" | "error", text: string): void {
    this.timeline.notice(level, text);
    this.items();
  }
}

function splitDestination(destination: string): [string, string] {
  const index = destination.indexOf(":");
  return index === -1
    ? [destination, ""]
    : [destination.slice(0, index), destination.slice(index + 1)];
}
