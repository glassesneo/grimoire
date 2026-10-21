// The SHIELD management contract: the envelope every hub client and the hub exchange over the
// socket, the hub's own requests and responses, and the records it sends about agents.
//
// The hub never validates against this contract at run time; it keeps its own parsing and
// limits (Shield.Protocol). The contract checks that what clients and the hub actually
// serialize conforms. Engine requests and engine payloads are opaque here: each engine's
// contract owns them, and no engine's names are listed.
import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Management;

/** Requests the hub answers itself. */
model HubRequest {
  v: 1;
  type: "hub_request";

  /** Unique among the connection's unresolved requests. */
  id: string;

  /** The agent a method concerns, such as `take_write`'s; null for the others. */
  `agent-id`: string | null;

  /** The engine the request means; absent or null means the hub's default. */
  engine?: string | null;

  method: string;
  payload: Record<unknown>;
}

/** A request the agent's engine answers. */
model EngineRequest {
  v: 1;
  type: "engine_request";
  id: string;
  `agent-id`: string;
  engine?: string | null;
  payload: Record<unknown>;
}

union Request {
  HubRequest,
  EngineRequest,
}

model ErrorDetail {
  code: string;
}

model Success {
  v: 1;
  type: "response";
  id: string;
  `agent-id`: string | null;
  engine: string | null;
  success: true;
  payload: unknown;
}

model Failure {
  v: 1;
  type: "response";

  /** The request's id as it was sent, which an invalid request may lack. */
  id: unknown;

  `agent-id`: unknown;
  engine: string | null;
  success: false;
  error: ErrorDetail;

  /** The engine's detail, when it gives one. */
  payload?: unknown;
}

union Response {
  Success,
  Failure,
}

union Lifecycle {
  "starting",
  "ready",
  "stopping",
  "exited",
  "failed",
}

model Writer {
  /** The connection that may write; null when nobody may. */
  connection: string | null;

  /** The number of writer changes so far. */
  epoch: safeint;
}

/** Delivers the engine's snapshot to the connection that subscribed. */
model SnapshotRecord {
  v: 1;
  type: "snapshot";
  `agent-id`: string;
  engine: string;
  `hub-instance`: string;

  /** The receiving connection's name, as writers are named. */
  connection: string;

  lifecycle: Lifecycle;
  writer: Writer;
  payload: unknown;
}

/** A state event of the engine, for live subscribers. */
model EventRecord {
  v: 1;
  type: "event";
  `agent-id`: string;
  engine: string;
  payload: unknown;
}

model LifecycleDetail {
  /** The failure's code. */
  error?: string;

  /** The engine process's exit status. */
  exitCode?: safeint;
}

model LifecycleChange {
  `op`: "lifecycle";
  state: Lifecycle;
  detail: LifecycleDetail;
}

model WriterChange {
  `op`: "writer";
  connection: string | null;
  epoch: safeint;
}

union ManagementPayload {
  LifecycleChange,
  WriterChange,
}

/** The hub's news about an agent, for every subscriber. */
model ManagementRecord {
  v: 1;
  type: "management";
  `agent-id`: string;
  engine: string;
  `hub-instance`: string;
  payload: ManagementPayload;
}

/** The agent's state owner crashed; its unresolved requests are answered with this code. */
model AgentFailedRecord {
  v: 1;
  type: "agent_failed";
  `agent-id`: string;
  engine: null;
  error: ErrorDetail;
}

/** A record the hub sends a connection. */
union HubRecord {
  Response,
  SnapshotRecord,
  EventRecord,
  ManagementRecord,
  AgentFailedRecord,
}

model Selection {
  /** `cwd` joins the newest live agent of the directory; `identity` reserves `key`. */
  kind: "cwd" | "identity";

  key: string;
}

/** `attach`'s payload. */
model AttachPayload {
  /** An existing absolute directory. */
  cwd: string;

  harness: string;
  selection: Selection;

  /** The engine's attach options. */
  options: Record<unknown>;
}

model AttachResult {
  `agent-id`: string;
  connection: string;
}

/** `stop`'s payload. */
model StopPayload {
  id: string;
}

model PingResult {
  `hub-instance`: string;
  `hub-pid`: string;
}

model AgentSummary {
  `agent-id`: string;
  cwd: string;
  harness: string;
  engine: string;
  state: Lifecycle;
  `parent-id`: string | null;
}

model TakeWriteResult {
  connection: string;
  epoch: safeint;
}

/** The payload of `stop`'s and `shutdown`'s success. */
model Empty {}

/** Every shape of the contract, reachable from one document. */
@jsonSchema
model ManagementContract {
  request: Request;
  record: HubRecord;
  attachPayload: AttachPayload;
  attachResult: AttachResult;
  stopPayload: StopPayload;
  pingResult: PingResult;
  listResult: AgentSummary[];
  takeWriteResult: TakeWriteResult;
  empty: Empty;
}
