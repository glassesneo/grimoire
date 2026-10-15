/**
 * UI-only session records. pi persists top-level messages but not the results
 * of calls a tool makes through `ctx.executeTool()`, nor retry sequences and
 * failed compactions, so the harness appends them as plain custom entries.
 * Plain custom entries stay out of the model's context, and each lands on the
 * branch that was active when it was written, so branch membership decides
 * what a restored timeline may use.
 *
 * Records are captured in memory as events arrive and appended only at an SDK
 * idle boundary, after the native messages they refer to are persisted. A
 * failed write marks the session's storage uncertain; nothing is retried,
 * repaired, or truncated.
 *
 * ponytail: nested output and images are stored as faithful snapshots in the
 * session JSONL, so a session grows with them. When that growth is measured
 * to matter, move payloads to external storage referenced from the records.
 */
import type {
  AgentSessionEvent,
  SessionEntry as PiSessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  type CompactionEntry,
  isContentBlock,
  isRecord,
  isResultContent,
  type NoticeEntry,
  type NoticeLevel,
  type ResultContent,
  type RetryAttempt,
  type RetryCategory,
  type RetryEntry,
  type SessionEntry,
} from "./session-entries";

export const DISPLAY_RECORD_TYPE = "harness-display-record";

type DisplayRecordKind = "nested-tool-result" | "retry" | "compaction-status";

export interface DisplayRecordData {
  version: 1;
  recordId: string;
  revision: number;
  /** The branch entry this record belongs after: the response that issued the root call, or where an operation began. */
  originEntryId: string;
  kind: DisplayRecordKind;
  payload: NestedToolPayload | RetryPayload | CompactionPayload;
}

export interface NestedToolPayload {
  callId: string;
  parentCallId: string;
  rootCallId: string;
  name: string;
  ordinal: number;
  /** Absent when the call's arguments could not be stored as JSON. */
  args?: unknown;
  content: ResultContent;
  details?: unknown;
  state: "done" | "error" | "unfinished";
  /** The root call's result entry, when it was persisted before the flush. */
  resultEntryId?: string;
}

export interface RetryPayload {
  category: RetryCategory;
  state: "succeeded" | "failed" | "ended";
  attempts: RetryAttempt[];
  finalError?: string;
}

export interface CompactionPayload {
  state: "failed" | "aborted";
  reason?: string;
  errorMessage?: string;
}

export interface NestedToolRecord extends NestedToolPayload {
  originEntryId: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isOptionalString = (value: unknown) => value === undefined || typeof value === "string";

function isAttempt(value: unknown): value is RetryAttempt {
  return (
    isRecord(value) &&
    isCount(value.attempt) &&
    isCount(value.maxAttempts) &&
    isCount(value.delayMs) &&
    typeof value.error === "string"
  );
}

function checkPayload(kind: unknown, payload: unknown): string | undefined {
  if (!isRecord(payload)) return "payload is not an object";
  switch (kind) {
    case "nested-tool-result":
      if (![payload.callId, payload.parentCallId, payload.rootCallId, payload.name].every(isText))
        return "nested call ids or name are missing";
      if (!isCount(payload.ordinal)) return "nested call ordinal is not a count";
      if (!isResultContent(payload.content)) return "nested call content is malformed";
      if (payload.state !== "done" && payload.state !== "error" && payload.state !== "unfinished")
        return "nested call state is unknown";
      if (!isOptionalString(payload.resultEntryId)) return "nested call result entry is malformed";
      return undefined;
    case "retry":
      if (payload.category !== "response" && payload.category !== "summary")
        return "retry category is unknown";
      if (payload.state !== "succeeded" && payload.state !== "failed" && payload.state !== "ended")
        return "retry state is unknown";
      if (!Array.isArray(payload.attempts) || !payload.attempts.every(isAttempt))
        return "retry attempts are malformed";
      if (!isOptionalString(payload.finalError)) return "retry error is malformed";
      return undefined;
    case "compaction-status":
      if (payload.state !== "failed" && payload.state !== "aborted")
        return "compaction state is unknown";
      if (!isOptionalString(payload.reason) || !isOptionalString(payload.errorMessage))
        return "compaction fields are malformed";
      return undefined;
    default:
      return `kind ${JSON.stringify(kind)} is not supported`;
  }
}

/** Checks a record's shape; the result names what is wrong. Unknown versions are not interpreted. */
export function parseDisplayRecord(
  data: unknown,
): { record: DisplayRecordData } | { error: string } {
  if (!isRecord(data)) return { error: "record is not an object" };
  if (data.version !== 1)
    return { error: `version ${JSON.stringify(data.version)} is not supported` };
  if (!isText(data.recordId)) return { error: "record id is missing" };
  if (!isCount(data.revision)) return { error: "revision is not a count" };
  if (!isText(data.originEntryId)) return { error: "origin entry is missing" };
  const problem = checkPayload(data.kind, data.payload);
  if (problem) return { error: problem };
  return { record: data as unknown as DisplayRecordData };
}

// ---------------------------------------------------------------------------
// Reading a branch
// ---------------------------------------------------------------------------

export interface DisplayRecords {
  /** Captured nested calls of one root call, scoped by the response that issued it. */
  nested(originEntryId: string, rootCallId: string): readonly NestedToolRecord[];
  /** Operation items that belong right after a branch entry. */
  operationsAfter(entryId: string): readonly SessionEntry[];
  /** Notices about records that could not be used. */
  diagnostics(): readonly NoticeEntry[];
}

function operationEntry(record: DisplayRecordData): SessionEntry {
  const id = `record:${record.recordId}`;
  if (record.kind === "retry") {
    const payload = record.payload as RetryPayload;
    const entry: RetryEntry = {
      kind: "retry",
      id,
      version: record.revision,
      category: payload.category,
      state: payload.state,
      attempts: payload.attempts,
      finalError: payload.finalError,
    };
    return entry;
  }
  const payload = record.payload as CompactionPayload;
  const entry: CompactionEntry = {
    kind: "compaction",
    id,
    version: record.revision,
    state: payload.state,
    reason: payload.reason,
    summary: undefined,
    tokensBefore: undefined,
    errorMessage: payload.errorMessage,
  };
  return entry;
}

/**
 * The display records on `branch`, latest revision per record id. Records
 * whose origin is not an earlier entry of the same branch are not used, nor
 * are entries a failed write left unconfirmed in memory.
 */
export function readDisplayRecords(
  branch: readonly PiSessionEntry[],
  options: { unconfirmed?: ReadonlySet<string> } = {},
): DisplayRecords {
  const seen = new Set<string>();
  const latest = new Map<string, DisplayRecordData>();
  const problems: string[] = [];
  for (const entry of branch) {
    seen.add(entry.id);
    if (entry.type !== "custom" || entry.customType !== DISPLAY_RECORD_TYPE) continue;
    if (options.unconfirmed?.has(entry.id)) continue;
    const parsed = parseDisplayRecord(entry.data);
    if ("error" in parsed) {
      problems.push(parsed.error);
      continue;
    }
    const { record } = parsed;
    if (!seen.has(record.originEntryId)) {
      problems.push("origin entry is not earlier on this branch");
      continue;
    }
    const previous = latest.get(record.recordId);
    if (!previous || record.revision > previous.revision) latest.set(record.recordId, record);
  }

  const nested = new Map<string, NestedToolRecord[]>();
  const operations = new Map<string, SessionEntry[]>();
  for (const record of latest.values()) {
    if (record.kind === "nested-tool-result") {
      const payload = record.payload as NestedToolPayload;
      const key = `${record.originEntryId}\u0000${payload.rootCallId}`;
      const list = nested.get(key) ?? [];
      list.push({ ...payload, originEntryId: record.originEntryId });
      nested.set(key, list);
    } else {
      const list = operations.get(record.originEntryId) ?? [];
      list.push(operationEntry(record));
      operations.set(record.originEntryId, list);
    }
  }
  const diagnostics: NoticeEntry[] =
    problems.length === 0
      ? []
      : [
          {
            kind: "notice",
            id: "display-records:diagnostics",
            version: 0,
            level: "warning",
            text: `${problems.length} display record${problems.length === 1 ? "" : "s"} could not be used, so some details are unavailable: ${[...new Set(problems)].join("; ")}`,
          },
        ];
  return {
    nested: (origin, root) => nested.get(`${origin}\u0000${root}`) ?? [],
    operationsAfter: (entryId) => operations.get(entryId) ?? [],
    diagnostics: () => diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Capturing and writing
// ---------------------------------------------------------------------------

/** A JSON round trip, or undefined when the value cannot be stored as JSON. */
function asJson(value: unknown): { value: unknown } | undefined {
  if (value === undefined) return { value: undefined };
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

function resultParts(result: unknown): { content: ResultContent; details: unknown } {
  if (isRecord(result)) {
    const content = Array.isArray(result.content) ? result.content.filter(isContentBlock) : [];
    return { content, details: result.details };
  }
  return {
    content: typeof result === "string" ? [{ type: "text", text: result }] : [],
    details: undefined,
  };
}

interface CapturedCall {
  /** Which response of the run issued the root call: call ids are unique only within one. */
  scope: number;
  root: string;
  callId: string;
  parentCallId: string;
  name: string;
  ordinal: number;
  args: unknown;
  content: ResultContent;
  details: unknown;
  state: "done" | "error" | "unfinished";
}

interface CapturedOperation {
  recordId: string;
  originEntryId: string | null;
  kind: "retry" | "compaction-status";
  payload: RetryPayload | CompactionPayload | undefined;
  /** Still running: written only once it settles. */
  open: boolean;
}

export interface DisplayRecorderSession {
  readonly sessionManager: Pick<
    SessionManager,
    "getLeafId" | "getBranch" | "appendCustomEntry" | "branch" | "resetLeaf"
  >;
}

export interface DisplayRecorderOptions {
  notify(level: NoticeLevel, text: string): void;
  /** Called once, when a write fails and the session's storage becomes uncertain. */
  onStorageFailure(error: Error): void;
  /** Storage is already uncertain; nothing is written. */
  failed?: boolean;
}

let nextRecord = 0;
const newRecordId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextRecord++}`;

/**
 * Captures one session's records from its events and writes them at idle
 * boundaries. Observing never writes; `flush` does, and only it.
 */
export class DisplayRecorder {
  readonly #session: DisplayRecorderSession;
  readonly #options: DisplayRecorderOptions;
  /** Captured nested calls by `<scope>:<call id>`. */
  readonly #calls = new Map<string, CapturedCall>();
  /** The scope a call id was last started in; a call runs only while its response's tools do. */
  readonly #scopeOf = new Map<string, number>();
  readonly #rootOf = new Map<string, string>();
  /** Start order of nested calls, counted per root call. */
  readonly #ordinals = new Map<string, number>();
  readonly #operations: CapturedOperation[] = [];
  readonly #unconfirmed = new Set<string>();
  /**
   * Responses that ended since the last flush. pi persists the same message
   * object it emits (SessionManager.appendMessage stores it), so the entry of
   * a scope is the branch entry holding that object.
   */
  readonly #responses: object[] = [];
  #failed = false;

  constructor(session: DisplayRecorderSession, options: DisplayRecorderOptions) {
    this.#session = session;
    this.#options = options;
    this.#failed = options.failed ?? false;
  }

  /** Entries a failed write left in memory; restoration must not trust them. */
  get unconfirmed(): ReadonlySet<string> {
    return this.#unconfirmed;
  }

  get storageFailed(): boolean {
    return this.#failed;
  }

  observe(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_end":
        if (event.message.role === "assistant") this.#responses.push(event.message);
        return;
      case "tool_execution_start": {
        if (event.parentToolCallId === undefined) {
          const scope = this.#responses.length - 1;
          this.#scopeOf.set(event.toolCallId, scope);
          this.#rootOf.set(`${scope}:${event.toolCallId}`, event.toolCallId);
          return;
        }
        const scope = this.#scopeOf.get(event.parentToolCallId) ?? this.#responses.length - 1;
        const key = `${scope}:${event.toolCallId}`;
        const root =
          this.#rootOf.get(`${scope}:${event.parentToolCallId}`) ?? event.parentToolCallId;
        this.#scopeOf.set(event.toolCallId, scope);
        this.#rootOf.set(key, root);
        const ordinal = this.#ordinals.get(`${scope}:${root}`) ?? 0;
        this.#ordinals.set(`${scope}:${root}`, ordinal + 1);
        this.#calls.set(key, {
          scope,
          root,
          callId: event.toolCallId,
          parentCallId: event.parentToolCallId,
          name: event.toolName,
          ordinal,
          args: event.args,
          content: [],
          details: undefined,
          state: "unfinished",
        });
        return;
      }
      case "tool_execution_update": {
        const call = this.#nested(event.toolCallId, event.parentToolCallId);
        if (call) Object.assign(call, resultParts(event.partialResult));
        return;
      }
      case "tool_execution_end": {
        const call = this.#nested(event.toolCallId, event.parentToolCallId);
        if (call)
          Object.assign(call, resultParts(event.result), {
            state: event.isError ? "error" : "done",
          });
        return;
      }
      case "auto_retry_start":
      case "summarization_retry_scheduled": {
        const category: RetryCategory = event.type === "auto_retry_start" ? "response" : "summary";
        let operation = this.#openOperation(
          "retry",
          (payload) => (payload as RetryPayload).category === category,
        );
        if (!operation) {
          operation = {
            recordId: newRecordId("retry"),
            originEntryId: this.#session.sessionManager.getLeafId(),
            kind: "retry",
            payload: { category, state: "ended", attempts: [] },
            open: true,
          };
          this.#operations.push(operation);
        }
        (operation.payload as RetryPayload).attempts.push({
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          error: event.errorMessage,
        });
        return;
      }
      case "auto_retry_end": {
        const operation = this.#openOperation(
          "retry",
          (payload) => (payload as RetryPayload).category === "response",
        );
        if (!operation) return;
        const payload = operation.payload as RetryPayload;
        payload.state = event.success ? "succeeded" : "failed";
        if (event.finalError !== undefined) payload.finalError = event.finalError;
        operation.open = false;
        return;
      }
      case "summarization_retry_finished": {
        const operation = this.#openOperation(
          "retry",
          (payload) => (payload as RetryPayload).category === "summary",
        );
        if (operation) operation.open = false;
        return;
      }
      case "compaction_start":
        this.#operations.push({
          recordId: newRecordId("compaction"),
          originEntryId: this.#session.sessionManager.getLeafId(),
          kind: "compaction-status",
          payload: undefined,
          open: true,
        });
        return;
      case "compaction_end": {
        const operation = this.#openOperation("compaction-status", () => true);
        if (!operation) return;
        operation.open = false;
        // A completed compaction is a native entry already.
        if (!event.result) {
          operation.payload = {
            state: event.aborted ? "aborted" : "failed",
            reason: event.reason,
            ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
          };
        }
        return;
      }
      default:
        return;
    }
  }

  #openOperation(
    kind: CapturedOperation["kind"],
    matches: (payload: CapturedOperation["payload"]) => boolean,
  ): CapturedOperation | undefined {
    return this.#operations.findLast(
      (operation) => operation.open && operation.kind === kind && matches(operation.payload),
    );
  }

  #resetCalls(): void {
    this.#calls.clear();
    this.#scopeOf.clear();
    this.#rootOf.clear();
    this.#ordinals.clear();
    this.#responses.length = 0;
  }

  #nested(callId: string, parentCallId: string | undefined): CapturedCall | undefined {
    if (parentCallId === undefined) return undefined;
    return this.#calls.get(`${this.#scopeOf.get(callId)}:${callId}`);
  }

  /**
   * Write what has settled. Call only at an idle boundary: native messages are
   * persisted by then, and no listener is mid-dispatch. After the session moved
   * to another point of the tree, `adoptOrphans` places operations that began
   * on the old branch, such as summarizing it, after the new leaf.
   */
  flush(options: { adoptOrphans?: boolean } = {}): void {
    if (this.#failed) return;
    if (this.#calls.size === 0 && this.#operations.every((operation) => operation.open)) {
      this.#resetCalls();
      return;
    }
    const manager = this.#session.sessionManager;
    const branch = manager.getBranch();
    const records: DisplayRecordData[] = [];

    const byRoot = new Map<string, CapturedCall[]>();
    for (const call of this.#calls.values()) {
      const key = `${call.scope}:${call.root}`;
      const list = byRoot.get(key) ?? [];
      list.push(call);
      byRoot.set(key, list);
    }
    const issues = (index: number, root: string) => {
      const entry = branch[index];
      return (
        entry?.type === "message" &&
        entry.message.role === "assistant" &&
        entry.message.content.some((block) => block.type === "toolCall" && block.id === root)
      );
    };
    let dropped = 0;
    for (const calls of byRoot.values()) {
      const { scope, root } = calls[0]!;
      // A scope names one response even when call ids repeat; without it, the last issuer.
      const message = this.#responses[scope];
      const scoped =
        message === undefined
          ? -1
          : branch.findIndex((entry) => entry.type === "message" && entry.message === message);
      const originIndex =
        scoped !== -1 && issues(scoped, root)
          ? scoped
          : branch.findLastIndex((_, index) => issues(index, root));
      if (originIndex === -1) {
        dropped += calls.length;
        continue;
      }
      const origin = branch[originIndex]!;
      const resultEntry = branch
        .slice(originIndex + 1)
        .find(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "toolResult" &&
            entry.message.toolCallId === root,
        );
      for (const call of calls) {
        const args = asJson(call.args);
        const details = asJson(call.details);
        records.push({
          version: 1,
          recordId: `${origin.id}:${call.callId}`,
          revision: 0,
          originEntryId: origin.id,
          kind: "nested-tool-result",
          payload: {
            callId: call.callId,
            parentCallId: call.parentCallId,
            rootCallId: root,
            name: call.name,
            ordinal: call.ordinal,
            content: call.content,
            state: call.state,
            ...(args ? { args: args.value } : {}),
            ...(details && details.value !== undefined ? { details: details.value } : {}),
            ...(resultEntry ? { resultEntryId: resultEntry.id } : {}),
          },
        });
      }
    }
    this.#resetCalls();
    if (dropped > 0) {
      this.#options.notify(
        "warning",
        `Results of ${dropped} nested tool call${dropped === 1 ? "" : "s"} were not saved: the call that made them is not on the current branch`,
      );
    }

    const branchIds = new Set(branch.map((entry) => entry.id));
    const leaf = manager.getLeafId();
    let orphans = 0;
    for (const operation of this.#operations.filter((candidate) => !candidate.open)) {
      if (!operation.payload) continue;
      const onBranch = operation.originEntryId !== null && branchIds.has(operation.originEntryId);
      const origin = onBranch ? operation.originEntryId : options.adoptOrphans ? leaf : null;
      if (origin === null) {
        orphans++;
        continue;
      }
      records.push({
        version: 1,
        recordId: operation.recordId,
        revision: 0,
        originEntryId: origin,
        kind: operation.kind,
        payload: operation.payload,
      });
    }
    if (orphans > 0) {
      this.#options.notify(
        "warning",
        `${orphans} retry or compaction record${orphans === 1 ? " was" : "s were"} not saved: ${orphans === 1 ? "it began" : "they began"} on another branch`,
      );
    }
    this.#operations.splice(
      0,
      this.#operations.length,
      ...this.#operations.filter((operation) => operation.open),
    );

    for (const record of records) {
      if (!this.#append(record)) return;
    }
  }

  #append(record: DisplayRecordData): boolean {
    const manager = this.#session.sessionManager;
    // Validate and serialize before touching the session: a value that cannot
    // be stored is a local problem and must not change the session.
    const checked = parseDisplayRecord(record);
    let data: unknown;
    try {
      if ("error" in checked) throw new Error(checked.error);
      data = JSON.parse(JSON.stringify(record));
    } catch (error) {
      this.#options.notify(
        "warning",
        `A display record was not saved: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    // pi updates its in-memory tree and leaf before writing the file, so a
    // failed write is undone in memory through the public leaf API.
    const previousLeaf = manager.getLeafId();
    try {
      manager.appendCustomEntry(DISPLAY_RECORD_TYPE, data);
      return true;
    } catch (error) {
      const failedLeaf = manager.getLeafId();
      if (failedLeaf !== null && failedLeaf !== previousLeaf) this.#unconfirmed.add(failedLeaf);
      if (previousLeaf === null) manager.resetLeaf();
      else manager.branch(previousLeaf);
      this.#failed = true;
      this.#options.onStorageFailure(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
}
