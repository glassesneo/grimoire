// The keel contract: every record keel's parts exchange through the SHIELD hub, as JSON.
//
// Three parties speak it. The driver is the process the hub starts: it runs Pi and the
// extensions' code, and writes Pi's meaning as entries. The model is Shield.Keel inside the
// hub: it owns every piece of state screens show, numbers its changes, and decides which
// operation may run. A screen follows the model's state and asks it to run actions.
//
//   driver -> model   DriverRecord, one per line on the driver's stdout
//   model -> driver   Instruction, one per line on the driver's stdin
//   screen -> model   ScreenRequest, an engine_request payload
//   model -> screen   InvokeResult as a response payload, Snapshot as a snapshot record's
//                     payload, StateEvent as an event record's payload
//
// The receiver of each direction validates what it receives against this contract and never
// coerces, defaults, or drops fields to make a record pass. Fields typed unknown are opaque:
// they are carried, never interpreted by whoever only relays them.
import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Keel;

// ---------------------------------------------------------------------------
// State the model publishes
// ---------------------------------------------------------------------------

model SessionInfo {
  id: string;
  cwd: string;
  `model`: string | null;
  thinking: string | null;
}

/**
 * keel's run control, not Pi's: a paused run is still active in Pi. `pausing` means a pause
 * was asked for and the run has not reached a point where it can wait yet.
 */
model RunInfo {
  phase: "idle" | "running" | "pausing" | "paused" | "stopping";
  compacting: boolean;
  retrying: boolean;
}

model QueueInfo {
  steering: string[];
  followUp: string[];
}

model Draft {
  text: string;

  /** Grows with every change of the text. */
  revision: safeint;
}

union RequestKind {
  "choice",
  "confirm",
}

model RequestInfo {
  id: string;
  kind: RequestKind;
  title: string;
  message?: string;
  options: string[];

  /** The draft destination that holds the request's supplement; absent when it takes none. */
  destination?: string;
}

model CandidateAction {
  id: string;
  args?: unknown;
}

model Candidate {
  id: string;
  label: string;
  detail?: string;
  current?: boolean;

  /** The action accepting the candidate runs, checked as that action. */
  action: CandidateAction;
}

model AssistInfo {
  id: string;
  title: string;

  /** The draft destination the assist's candidates follow. */
  destination: string;

  /** The draft revision the candidates were computed from; -1 before the first. */
  revision: safeint;

  candidates: Candidate[];
}

union ActionClass {
  "view",
  "control",
  "write",
}

model ActionInfo {
  id: string;
  class: ActionClass;
  title?: string;

  /** The screen runs it from its own code; the model only declares it. */
  local: boolean;
}

// ---------------------------------------------------------------------------
// Items: the timeline as screens show it
// ---------------------------------------------------------------------------

union Tone {
  "user",
  "dim",
  "accent",
  "warning",
  "error",
}

model ItemBase {
  id: string;

  /** Changes whenever anything else in the item does. */
  version: safeint;

  variant?: string;

  /** The item this one is a part of; it comes after its parent in the order. */
  parentId?: string;

  /** The item as plain text, for a screen without a renderer for its kind. */
  text: string;

  /** What the copy action writes; absent when the item holds no original text. */
  source?: string;

  tone?: Tone;
}

union ToolState {
  "pending",
  "running",
  "done",
  "error",
  "unfinished",
}

model ArgumentsAvailable {
  available: true;
  value: unknown;
}

model ArgumentsUnavailable {
  available: false;
}

union ToolArguments {
  ArgumentsAvailable,
  ArgumentsUnavailable,
}

model UserData {
  text: string;

  /** Attachment descriptions; images themselves are not sent. */
  images: string[];
}

model ResponseData {
  /** Thinking text joined, for a collapsed preview. */
  thinking: string;

  hasThinking: boolean;

  /** Every thinking block was withheld; there is nothing to preview. */
  thinkingWithheld: boolean;

  /** The prose and code as the model wrote them. */
  body: string;

  streaming: boolean;

  /** Pi's stop reason, such as stop, length, toolUse, error, or aborted. */
  stopReason?: string;

  errorMessage?: string;
}

model ThinkingData {
  text: string;
  withheld: boolean;
}

model ProseData {
  text: string;
  streaming: boolean;
}

model CodeData {
  language: string;
  body: string;

  /** The raw fenced block, fences included. */
  sourceText: string;

  /** No closing fence yet, as while a reply streams. */
  open: boolean;
}

model ToolResultData {
  /** The result's text blocks joined. */
  text: string;

  /** Descriptions of the result's images. */
  images: string[];

  details?: unknown;

  /** A streamed update rather than the final result. */
  partial: boolean;
}

model NestedCallSummary {
  name: string;
  args: ToolArguments;
  state: ToolState;
}

model ToolData {
  callId: string;
  name: string;
  args: ToolArguments;
  state: ToolState;

  /** Absent when no result arrived; not an empty result. */
  result?: ToolResultData;

  /** Calls this tool made, and calls those made, in the order they started. */
  calls: NestedCallSummary[];

  /** What the extensions decorating this tool added, by their names; opaque to the model. */
  extra?: Record<unknown>;
}

model CompactionData {
  state: "running" | "completed" | "failed" | "aborted";
  reason?: string;
  summary?: string;
  tokensBefore?: float64;
  errorMessage?: string;
}

model RetryAttempt {
  attempt: float64;
  maxAttempts: float64;
  delayMs: float64;
  error: string;
}

model RetryData {
  category: "response" | "summary";
  state: "waiting" | "retrying" | "succeeded" | "failed" | "ended";
  attempts: RetryAttempt[];
  finalError?: string;
}

model CustomData {
  customType: string;
  text: string;
  details?: unknown;
}

model ConfigData {
  setting: "model" | "thinking";
  from: string;
  to: string;
}

union NoticeLevel {
  "info",
  "warning",
  "error",
}

model NoticeData {
  level: NoticeLevel;
  text: string;
}

model UserItem {
  ...ItemBase;
  kind: "user";
  data: UserData;
}

model ResponseItem {
  ...ItemBase;
  kind: "response";
  data: ResponseData;
}

model ThinkingItem {
  ...ItemBase;
  kind: "thinking";
  data: ThinkingData;
}

model ProseItem {
  ...ItemBase;
  kind: "prose";
  data: ProseData;
}

model CodeItem {
  ...ItemBase;
  kind: "code";
  data: CodeData;
}

model ToolItem {
  ...ItemBase;
  kind: "tool";
  data: ToolData;
}

model CompactionItem {
  ...ItemBase;
  kind: "compaction";
  data: CompactionData;
}

model RetryItem {
  ...ItemBase;
  kind: "retry";
  data: RetryData;
}

model CustomItem {
  ...ItemBase;
  kind: "custom";
  data: CustomData;
}

model ConfigItem {
  ...ItemBase;
  kind: "config";
  data: ConfigData;
}

model NoticeItem {
  ...ItemBase;
  kind: "notice";
  data: NoticeData;
}

/** A timeline item: its renderer data by kind, and plain text any screen can show. */
union Item {
  UserItem,
  ResponseItem,
  ThinkingItem,
  ProseItem,
  CodeItem,
  ToolItem,
  CompactionItem,
  RetryItem,
  CustomItem,
  ConfigItem,
  NoticeItem,
}

model State {
  session: SessionInfo;
  run: RunInfo;
  items: Item[];
  queue: QueueInfo;
  requests: RequestInfo[];
  assists: AssistInfo[];
  drafts: Record<Draft>;
  actions: ActionInfo[];

  /** The chords of each action after the key configuration was applied. */
  keys: Record<string[]>;

  /**
   * Item kind, or `kind/variant`, to the screen renderer that presents it. A kind without an
   * entry, or naming a renderer the screen lacks, is shown as its `text`.
   */
  kinds: Record<string>;
}

/**
 * One state change. `items` upserts complete items by id; `order`, when present, is the
 * complete new order of item ids, and items absent from it are removed. Every other present
 * section replaces the previous value whole.
 */
model Changes {
  items?: Item[];
  order?: string[];
  session?: SessionInfo;
  run?: RunInfo;
  queue?: QueueInfo;
  requests?: RequestInfo[];
  assists?: AssistInfo[];
  drafts?: Record<Draft>;
  actions?: ActionInfo[];
  keys?: Record<string[]>;
  kinds?: Record<string>;
}

/** The model's state as of `seq`, the last change it includes. */
model Snapshot {
  /** Names the model of one agent; a screen that sees another resynchronizes. */
  instance: string;

  seq: safeint;
  state: State;
}

/** The change numbered `seq`; the first event after a snapshot is numbered one more. */
model StateEvent {
  instance: string;
  seq: safeint;
  changes: Changes;
}

// ---------------------------------------------------------------------------
// Screen and model
// ---------------------------------------------------------------------------

/** Runs a declared action. */
model InvokeRequest {
  `op`: "invoke";
  action: string;
  args?: unknown;

  /** The writer epoch the screen last saw; a write without it, or under another, is refused. */
  writerEpoch?: safeint;
}

/** Resubscribes from a new snapshot, after a gap. */
model SnapshotRequest {
  `op`: "snapshot";
}

union ScreenRequest {
  InvokeRequest,
  SnapshotRequest,
}

model Rejected {
  outcome: "rejected";
  code: string;
  message?: string;
}

/** Whether the operation took effect is not known; it is never retried on its own. */
model Unknown {
  outcome: "unknown";
  code: string;
  message?: string;
}

/** The operation was taken; its effects follow as events. */
model InvokeAccepted {
  outcome: "accepted";
  appliedSeq?: safeint;
  detail?: unknown;
}

/** The operation finished, with every change at or before `appliedSeq`. */
model InvokeDone {
  outcome: "done";
  appliedSeq?: safeint;
  detail?: unknown;
}

union InvokeResult {
  Rejected,
  Unknown,
  InvokeAccepted,
  InvokeDone,
}

/** The keel engine's attach options. */
model AttachOptions {
  /** The absolute directory the driver reads its configuration from. */
  configDir: string;

  launch: Launch;

  /** The hub keeps explicit identities apart per mode; keel's screens name none. */
  mode?: string;
}

model Launch {
  executable: string;
  argv: string[];
  env: Record<string>;
}

// ---------------------------------------------------------------------------
// Driver and model
// ---------------------------------------------------------------------------

model EntryBase {
  /** Unique among the driver's entries. */
  id: string;

  /** The driver's count of this entry's changes; not the model's state sequence. */
  version: safeint;
}

model UserEntry {
  ...EntryBase;
  kind: "user";
  text: string;
  images: string[];
}

model ThinkingPart {
  type: "thinking";
  text: string;
  withheld: boolean;
}

model TextPart {
  type: "text";
  text: string;
}

union Part {
  ThinkingPart,
  TextPart,
}

model AssistantEntry {
  ...EntryBase;
  kind: "assistant";
  parts: Part[];
  streaming: boolean;
  stopReason?: string;
  errorMessage?: string;
}

model ToolEntry {
  ...EntryBase;
  kind: "tool";
  callId: string;

  /** The tool entry whose call made this one. */
  parentId?: string;

  name: string;
  args: ToolArguments;
  state: ToolState;
  result?: ToolResultData;

  /** The decorators' results, present while any decorates the tool. */
  extra?: Record<unknown>;
}

model CompactionEntry {
  ...EntryBase;
  kind: "compaction";
  ...CompactionData;
}

model RetryEntry {
  ...EntryBase;
  kind: "retry";
  ...RetryData;
}

model CustomEntry {
  ...EntryBase;
  kind: "custom";
  ...CustomData;
}

model ConfigEntry {
  ...EntryBase;
  kind: "config";
  ...ConfigData;
}

model NoticeEntry {
  ...EntryBase;
  kind: "notice";
  ...NoticeData;
}

/** What happened in the driver's session, in keel's vocabulary. */
union Entry {
  UserEntry,
  AssistantEntry,
  ToolEntry,
  CompactionEntry,
  RetryEntry,
  CustomEntry,
  ConfigEntry,
  NoticeEntry,
}

/** The driver is started: every extension has declared what it declares. */
model ReadyRecord {
  type: "ready";
  session: SessionInfo;

  /** keybindings.json as the driver read it; absent when there is none. */
  keys?: unknown;
}

/**
 * Entries that are new or changed. A new entry goes after the last one unless `order` is
 * present, which then lists every entry of the driver in its new order.
 */
model EntriesRecord {
  type: "entries";
  entries: Entry[];
  order?: string[];
}

/** State the driver owns, each part whole when it changed. */
model StatusRecord {
  type: "status";
  session?: SessionInfo;
  run?: RunInfo;
  queue?: QueueInfo;
}

model ActionDeclaration {
  /** `<layer>.<name>`; a layer that is a region (`editor`, `timeline`, `stage`) scopes its keys. */
  id: string;

  /** `write` when absent. */
  class?: ActionClass;

  title?: string;

  /** Default chords; global actions take none. */
  keys?: string[];

  /** Where it runs: in the driver, or in the screen's own code. */
  runs: "driver" | "screen";
}

/** Declares actions together; all are refused when one is invalid or taken. */
model DeclareActions {
  `op`: "declare_actions";
  actions: ActionDeclaration[];
}

/** Shows items of `kind` (or `kind/variant`) with the screen renderer named `renderer`. */
model Present {
  `op`: "present";
  kind: string;
  renderer: string;
}

/** An assist whose candidates the driver computes for its draft. */
model DeclareAssist {
  `op`: "declare_assist";
  id: string;
  title: string;
}

/** Withdraws what a registration declared. */
model Withdraw {
  `op`: "withdraw";
  registration: string;
}

model ListAssists {
  `op`: "list_assists";
}

/** Replaces an open draft as the driver; no writer is checked. */
model SetDraft {
  `op`: "set_draft";
  destination: string;
  text: string;
}

/** Adds text to the end of an open draft, after a blank line when it has text. */
model AppendDraft {
  `op`: "append_draft";
  destination: string;
  text: string;
}

model OpenRequest {
  `op`: "open_request";
  kind: RequestKind;
  title: string;
  message?: string;
  options: string[];

  /** Whether the answer carries a supplement the screen types. */
  supplement: boolean;
}

model CancelRequest {
  `op`: "cancel_request";
  request: string;
}

/** Cancels every open request the driver opened. */
model CancelRequests {
  `op`: "cancel_requests";
}

union Operation {
  DeclareActions,
  Present,
  DeclareAssist,
  Withdraw,
  ListAssists,
  SetDraft,
  AppendDraft,
  OpenRequest,
  CancelRequest,
  CancelRequests,
}

/** An operation on the model's state; answered by an OperationResult with the same id. */
model OperationRecord {
  type: "operation";
  id: string;
  operation: Operation;
}

model ActionDone {
  outcome: "done";
  detail?: unknown;
}

model ActionAccepted {
  outcome: "accepted";
  detail?: unknown;
}

/** Pi accepted the prompt: it started a run, queued it, or an extension command handled it. */
model Submitted {
  outcome: "submitted";
  disposition: "started" | "queued" | "handled";
}

model CandidateList {
  outcome: "candidates";
  candidates: Candidate[];
}

union DriverResult {
  ActionDone,
  ActionAccepted,
  Rejected,
  Unknown,
  Submitted,
  CandidateList,
}

/** The driver's answer to the instruction with the same id. */
model ResultRecord {
  type: "result";
  id: string;
  result: DriverResult;
}

/** The driver cannot go on; it exits after writing this. */
model FailRecord {
  type: "fail";
  code: string;
  message?: string;
}

union DriverRecord {
  ReadyRecord,
  EntriesRecord,
  StatusRecord,
  OperationRecord,
  ResultRecord,
  FailRecord,
}

model OperationValue {
  registration?: string;
  revision?: safeint;
  request?: string;
  assists?: string[];
}

model OperationAccepted {
  type: "operation_result";
  id: string;
  outcome: "ok";
  value: OperationValue;
}

model OperationRejected {
  type: "operation_result";
  id: string;
  outcome: "rejected";
  code: string;
  message?: string;
}

/** Runs a driver action for `connection`; the model already checked that it may. */
model RunAction {
  type: "run_action";
  id: string;
  action: string;
  args?: unknown;
  connection: string;

  /** Whether that connection held the write right when it asked. */
  writer: boolean;
}

/** Sends `text` to Pi as the prompt sends it; answered by Submitted, Rejected, or Unknown. */
model Submit {
  type: "submit";
  id: string;
  text: string;
}

/** Computes an assist's candidates for `text`; answered by CandidateList or Rejected. */
model QueryAssist {
  type: "query_assist";
  id: string;
  assist: string;
  text: string;
}

model Answered {
  status: "answered";

  /** The chosen option of a choice, or whether a confirm's first option was chosen. */
  value: string | boolean;

  /** Present when the request took a supplement. */
  supplement?: string;
}

model Cancelled {
  status: "cancelled";
}

union RequestAnswer {
  Answered,
  Cancelled,
}

/** A request the driver opened is closed. */
model RequestClosed {
  type: "request_closed";
  request: string;
  answer: RequestAnswer;
}

union Instruction {
  OperationAccepted,
  OperationRejected,
  RunAction,
  Submit,
  QueryAssist,
  RequestClosed,
}

/** Every record of the contract, reachable from one document. */
@jsonSchema
model KeelContract {
  driverRecord: DriverRecord;
  instruction: Instruction;
  screenRequest: ScreenRequest;
  invokeResult: InvokeResult;
  snapshot: Snapshot;
  event: StateEvent;
  attachOptions: AttachOptions;
}
