/**
 * The keel wire: what the runtime and the screen exchange through the SHIELD
 * hub. Everything here is JSON; neither side sends code, JSX, or closures.
 *
 * The runtime owns the state. It numbers every state change with `seq`, one
 * per event, starting after the snapshot a subscriber received. The hub relays
 * runtime records without reading or renumbering them, and reports its own
 * concerns (lifecycle, writer) as separate management records without a state
 * seq. A screen that sees a gap in `seq` or a different `runtimeInstance`
 * stops changing anything and asks for a new snapshot; nothing is replayed.
 */

/** Records the runtime writes to its stdout, one JSON object per line. */
export type RuntimeOutput =
  | { type: "ready"; runtimeInstance: string }
  | { type: "snapshot"; id: string; snapshot: Snapshot }
  | { type: "snapshot_error"; id: string; code: string }
  | { type: "event"; event: StateEvent }
  | { type: "result"; id: string; result: InvokeResult }
  | { type: "fail"; code: string; message?: string };

/** Records the hub writes to the runtime's stdin. */
export type RuntimeInput =
  | { type: "snapshot_request"; id: string }
  | {
      type: "invoke";
      id: string;
      /** The hub's identifier of the connection that sent the request. */
      connection: string;
      invoke: Invoke;
    }
  /** The writer changed; `connection` null means nobody may write. */
  | { type: "writer"; connection: string | null; epoch: number };

export interface Snapshot {
  runtimeInstance: string;
  /** The last change already applied to `state`. */
  seq: number;
  state: State;
}

export interface StateEvent {
  runtimeInstance: string;
  seq: number;
  changes: Changes;
}

/**
 * One state change. `items` upserts complete items by id; `order`, when
 * present, is the complete new order of item ids, and items absent from it are
 * removed. Every other present section replaces the previous value whole.
 */
export interface Changes {
  items?: Item[];
  order?: string[];
  session?: SessionInfo;
  run?: RunInfo;
  queue?: QueueInfo;
  requests?: RequestInfo[];
  assists?: AssistInfo[];
  drafts?: Record<string, Draft>;
  actions?: ActionInfo[];
  keys?: Record<string, string[]>;
  kinds?: Record<string, string>;
}

export interface State {
  session: SessionInfo;
  run: RunInfo;
  items: Item[];
  queue: QueueInfo;
  requests: RequestInfo[];
  assists: AssistInfo[];
  drafts: Record<string, Draft>;
  actions: ActionInfo[];
  /** The chords of each action after the key configuration was applied. */
  keys: Record<string, string[]>;
  /**
   * Item kind, or `kind/variant`, to the screen renderer that presents it.
   * A kind without an entry, or naming a renderer the screen lacks, is shown
   * as its `text`.
   */
  kinds: Record<string, string>;
}

export interface SessionInfo {
  id: string;
  cwd: string;
  model: string | null;
  thinking: string | null;
}

/**
 * `phase` is keel's run control, not Pi's: a paused run is still active in Pi.
 * `pausing` means a pause was asked for and the run has not reached a point
 * where it can wait yet.
 */
export interface RunInfo {
  phase: "idle" | "running" | "pausing" | "paused" | "stopping";
  compacting: boolean;
  retrying: boolean;
}

export interface QueueInfo {
  steering: string[];
  followUp: string[];
}

/** A timeline item: its renderer data, and plain text any screen can show. */
export interface Item {
  id: string;
  /** Changes whenever anything else in the item does. */
  version: number;
  kind: string;
  variant?: string;
  /** The item this one is a part of; it comes after its parent in the order. */
  parentId?: string;
  /** The item as plain text, for a screen without a renderer for its kind. */
  text: string;
  /** What the copy action writes; absent when the item holds no original text. */
  source?: string;
  tone?: "user" | "dim" | "accent" | "warning" | "error";
  data: unknown;
}

export interface RequestInfo {
  id: string;
  kind: "choice" | "confirm";
  title: string;
  message?: string;
  options: string[];
  /** The draft destination that holds the request's supplement. */
  destination: string;
}

export interface AssistInfo {
  id: string;
  title: string;
  /** The draft destination the assist's candidates follow. */
  destination: string;
  /** The draft revision the candidates were computed from. */
  revision: number;
  candidates: Candidate[];
}

export interface Candidate {
  id: string;
  label: string;
  detail?: string;
  current?: boolean;
  /** The action accepting the candidate runs, checked as that action. */
  action: { id: string; args?: unknown };
}

export interface Draft {
  text: string;
  revision: number;
}

export type ActionClass = "view" | "control" | "write";

export interface ActionInfo {
  id: string;
  class: ActionClass;
  title?: string;
  /** The screen runs it from its own code; the runtime only declares it. */
  local: boolean;
}

/** A screen's request to run a registered action. */
export interface Invoke {
  action: string;
  args?: unknown;
  /** The writer epoch the screen last saw; a write without it, or under another, is refused. */
  writerEpoch?: number;
}

export type InvokeResult =
  | { outcome: "rejected"; code: string; message?: string }
  /** The runtime took the operation; its effects follow as events. */
  | { outcome: "accepted"; appliedSeq?: number; detail?: unknown }
  /** The operation finished here, with every change at or before `appliedSeq`. */
  | { outcome: "done"; appliedSeq?: number; detail?: unknown };

/** Draft destination of the prompt. */
export const PROMPT = "prompt";
export const requestDestination = (id: string) => `request:${id}`;
export const assistDestination = (id: string) => `assist:${id}`;
