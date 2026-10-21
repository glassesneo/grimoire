// Generated from contracts/keel.tsp by `just shield-contracts`; do not edit.
export default {
  $comment: "Generated from contracts/keel.tsp by `just shield-contracts`; do not edit.",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "KeelContract.json",
  type: "object",
  properties: {
    driverRecord: {
      $ref: "#/$defs/DriverRecord",
    },
    instruction: {
      $ref: "#/$defs/Instruction",
    },
    screenRequest: {
      $ref: "#/$defs/ScreenRequest",
    },
    invokeResult: {
      $ref: "#/$defs/InvokeResult",
    },
    snapshot: {
      $ref: "#/$defs/Snapshot",
    },
    event: {
      $ref: "#/$defs/StateEvent",
    },
    attachOptions: {
      $ref: "#/$defs/AttachOptions",
    },
  },
  required: [
    "driverRecord",
    "instruction",
    "screenRequest",
    "invokeResult",
    "snapshot",
    "event",
    "attachOptions",
  ],
  unevaluatedProperties: false,
  description: "Every record of the contract, reachable from one document.",
  $defs: {
    DriverRecord: {
      anyOf: [
        {
          $ref: "#/$defs/ReadyRecord",
        },
        {
          $ref: "#/$defs/EntriesRecord",
        },
        {
          $ref: "#/$defs/StatusRecord",
        },
        {
          $ref: "#/$defs/OperationRecord",
        },
        {
          $ref: "#/$defs/ResultRecord",
        },
        {
          $ref: "#/$defs/FailRecord",
        },
      ],
    },
    Instruction: {
      anyOf: [
        {
          $ref: "#/$defs/OperationAccepted",
        },
        {
          $ref: "#/$defs/OperationRejected",
        },
        {
          $ref: "#/$defs/RunAction",
        },
        {
          $ref: "#/$defs/Submit",
        },
        {
          $ref: "#/$defs/QueryAssist",
        },
        {
          $ref: "#/$defs/RequestClosed",
        },
      ],
    },
    ScreenRequest: {
      anyOf: [
        {
          $ref: "#/$defs/InvokeRequest",
        },
        {
          $ref: "#/$defs/SnapshotRequest",
        },
      ],
    },
    InvokeResult: {
      anyOf: [
        {
          $ref: "#/$defs/Rejected",
        },
        {
          $ref: "#/$defs/Unknown",
        },
        {
          $ref: "#/$defs/InvokeAccepted",
        },
        {
          $ref: "#/$defs/InvokeDone",
        },
      ],
    },
    Snapshot: {
      type: "object",
      properties: {
        instance: {
          type: "string",
          description: "Names the model of one agent; a screen that sees another resynchronizes.",
        },
        seq: {
          type: "integer",
        },
        state: {
          $ref: "#/$defs/State",
        },
      },
      required: ["instance", "seq", "state"],
      unevaluatedProperties: false,
      description: "The model's state as of `seq`, the last change it includes.",
    },
    StateEvent: {
      type: "object",
      properties: {
        instance: {
          type: "string",
        },
        seq: {
          type: "integer",
        },
        changes: {
          $ref: "#/$defs/Changes",
        },
      },
      required: ["instance", "seq", "changes"],
      unevaluatedProperties: false,
      description:
        "The change numbered `seq`; the first event after a snapshot is numbered one more.",
    },
    AttachOptions: {
      type: "object",
      properties: {
        configDir: {
          type: "string",
          description: "The absolute directory the driver reads its configuration from.",
        },
        launch: {
          $ref: "#/$defs/Launch",
        },
        mode: {
          type: "string",
          description:
            "The hub keeps explicit identities apart per mode; keel's screens name none.",
        },
      },
      required: ["configDir", "launch"],
      unevaluatedProperties: false,
      description: "The keel engine's attach options.",
    },
    ReadyRecord: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "ready",
        },
        session: {
          $ref: "#/$defs/SessionInfo",
        },
        keys: {
          description: "keybindings.json as the driver read it; absent when there is none.",
        },
      },
      required: ["type", "session"],
      unevaluatedProperties: false,
      description: "The driver is started: every extension has declared what it declares.",
    },
    EntriesRecord: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "entries",
        },
        entries: {
          type: "array",
          items: {
            $ref: "#/$defs/Entry",
          },
        },
        order: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["type", "entries"],
      unevaluatedProperties: false,
      description:
        "Entries that are new or changed. A new entry goes after the last one unless `order` is\npresent, which then lists every entry of the driver in its new order.",
    },
    StatusRecord: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "status",
        },
        session: {
          $ref: "#/$defs/SessionInfo",
        },
        run: {
          $ref: "#/$defs/RunInfo",
        },
        queue: {
          $ref: "#/$defs/QueueInfo",
        },
      },
      required: ["type"],
      unevaluatedProperties: false,
      description: "State the driver owns, each part whole when it changed.",
    },
    OperationRecord: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "operation",
        },
        id: {
          type: "string",
        },
        operation: {
          $ref: "#/$defs/Operation",
        },
      },
      required: ["type", "id", "operation"],
      unevaluatedProperties: false,
      description:
        "An operation on the model's state; answered by an OperationResult with the same id.",
    },
    ResultRecord: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "result",
        },
        id: {
          type: "string",
        },
        result: {
          $ref: "#/$defs/DriverResult",
        },
      },
      required: ["type", "id", "result"],
      unevaluatedProperties: false,
      description: "The driver's answer to the instruction with the same id.",
    },
    FailRecord: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "fail",
        },
        code: {
          type: "string",
        },
        message: {
          type: "string",
        },
      },
      required: ["type", "code"],
      unevaluatedProperties: false,
      description: "The driver cannot go on; it exits after writing this.",
    },
    OperationAccepted: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "operation_result",
        },
        id: {
          type: "string",
        },
        outcome: {
          type: "string",
          const: "ok",
        },
        value: {
          $ref: "#/$defs/OperationValue",
        },
      },
      required: ["type", "id", "outcome", "value"],
      unevaluatedProperties: false,
    },
    OperationRejected: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "operation_result",
        },
        id: {
          type: "string",
        },
        outcome: {
          type: "string",
          const: "rejected",
        },
        code: {
          type: "string",
        },
        message: {
          type: "string",
        },
      },
      required: ["type", "id", "outcome", "code"],
      unevaluatedProperties: false,
    },
    RunAction: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "run_action",
        },
        id: {
          type: "string",
        },
        action: {
          type: "string",
        },
        args: {},
        connection: {
          type: "string",
        },
        writer: {
          type: "boolean",
          description: "Whether that connection held the write right when it asked.",
        },
      },
      required: ["type", "id", "action", "connection", "writer"],
      unevaluatedProperties: false,
      description: "Runs a driver action for `connection`; the model already checked that it may.",
    },
    Submit: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "submit",
        },
        id: {
          type: "string",
        },
        text: {
          type: "string",
        },
      },
      required: ["type", "id", "text"],
      unevaluatedProperties: false,
      description:
        "Sends `text` to Pi as the prompt sends it; answered by Submitted, Rejected, or Unknown.",
    },
    QueryAssist: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "query_assist",
        },
        id: {
          type: "string",
        },
        assist: {
          type: "string",
        },
        text: {
          type: "string",
        },
      },
      required: ["type", "id", "assist", "text"],
      unevaluatedProperties: false,
      description:
        "Computes an assist's candidates for `text`; answered by CandidateList or Rejected.",
    },
    RequestClosed: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "request_closed",
        },
        request: {
          type: "string",
        },
        answer: {
          $ref: "#/$defs/RequestAnswer",
        },
      },
      required: ["type", "request", "answer"],
      unevaluatedProperties: false,
      description: "A request the driver opened is closed.",
    },
    InvokeRequest: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "invoke",
        },
        action: {
          type: "string",
        },
        args: {},
        writerEpoch: {
          type: "integer",
          description:
            "The writer epoch the screen last saw; a write without it, or under another, is refused.",
        },
      },
      required: ["op", "action"],
      unevaluatedProperties: false,
      description: "Runs a declared action.",
    },
    SnapshotRequest: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "snapshot",
        },
      },
      required: ["op"],
      unevaluatedProperties: false,
      description: "Resubscribes from a new snapshot, after a gap.",
    },
    Rejected: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "rejected",
        },
        code: {
          type: "string",
        },
        message: {
          type: "string",
        },
      },
      required: ["outcome", "code"],
      unevaluatedProperties: false,
    },
    Unknown: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "unknown",
        },
        code: {
          type: "string",
        },
        message: {
          type: "string",
        },
      },
      required: ["outcome", "code"],
      unevaluatedProperties: false,
      description:
        "Whether the operation took effect is not known; it is never retried on its own.",
    },
    InvokeAccepted: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "accepted",
        },
        appliedSeq: {
          type: "integer",
        },
        detail: {},
      },
      required: ["outcome"],
      unevaluatedProperties: false,
      description: "The operation was taken; its effects follow as events.",
    },
    InvokeDone: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "done",
        },
        appliedSeq: {
          type: "integer",
        },
        detail: {},
      },
      required: ["outcome"],
      unevaluatedProperties: false,
      description: "The operation finished, with every change at or before `appliedSeq`.",
    },
    State: {
      type: "object",
      properties: {
        session: {
          $ref: "#/$defs/SessionInfo",
        },
        run: {
          $ref: "#/$defs/RunInfo",
        },
        items: {
          type: "array",
          items: {
            $ref: "#/$defs/Item",
          },
        },
        queue: {
          $ref: "#/$defs/QueueInfo",
        },
        requests: {
          type: "array",
          items: {
            $ref: "#/$defs/RequestInfo",
          },
        },
        assists: {
          type: "array",
          items: {
            $ref: "#/$defs/AssistInfo",
          },
        },
        drafts: {
          $ref: "#/$defs/RecordDraft",
        },
        actions: {
          type: "array",
          items: {
            $ref: "#/$defs/ActionInfo",
          },
        },
        keys: {
          $ref: "#/$defs/RecordArrayString",
          description: "The chords of each action after the key configuration was applied.",
        },
        kinds: {
          $ref: "#/$defs/RecordString",
          description:
            "Item kind, or `kind/variant`, to the screen renderer that presents it. A kind without an\nentry, or naming a renderer the screen lacks, is shown as its `text`.",
        },
      },
      required: [
        "session",
        "run",
        "items",
        "queue",
        "requests",
        "assists",
        "drafts",
        "actions",
        "keys",
        "kinds",
      ],
      unevaluatedProperties: false,
    },
    Changes: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            $ref: "#/$defs/Item",
          },
        },
        order: {
          type: "array",
          items: {
            type: "string",
          },
        },
        session: {
          $ref: "#/$defs/SessionInfo",
        },
        run: {
          $ref: "#/$defs/RunInfo",
        },
        queue: {
          $ref: "#/$defs/QueueInfo",
        },
        requests: {
          type: "array",
          items: {
            $ref: "#/$defs/RequestInfo",
          },
        },
        assists: {
          type: "array",
          items: {
            $ref: "#/$defs/AssistInfo",
          },
        },
        drafts: {
          $ref: "#/$defs/RecordDraft",
        },
        actions: {
          type: "array",
          items: {
            $ref: "#/$defs/ActionInfo",
          },
        },
        keys: {
          $ref: "#/$defs/RecordArrayString",
        },
        kinds: {
          $ref: "#/$defs/RecordString",
        },
      },
      unevaluatedProperties: false,
      description:
        "One state change. `items` upserts complete items by id; `order`, when present, is the\ncomplete new order of item ids, and items absent from it are removed. Every other present\nsection replaces the previous value whole.",
    },
    Launch: {
      type: "object",
      properties: {
        executable: {
          type: "string",
        },
        argv: {
          type: "array",
          items: {
            type: "string",
          },
        },
        env: {
          $ref: "#/$defs/RecordString",
        },
      },
      required: ["executable", "argv", "env"],
      unevaluatedProperties: false,
    },
    SessionInfo: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        cwd: {
          type: "string",
        },
        model: {
          anyOf: [
            {
              type: "string",
            },
            {
              type: "null",
            },
          ],
        },
        thinking: {
          anyOf: [
            {
              type: "string",
            },
            {
              type: "null",
            },
          ],
        },
      },
      required: ["id", "cwd", "model", "thinking"],
      unevaluatedProperties: false,
    },
    Entry: {
      anyOf: [
        {
          $ref: "#/$defs/UserEntry",
        },
        {
          $ref: "#/$defs/AssistantEntry",
        },
        {
          $ref: "#/$defs/ToolEntry",
        },
        {
          $ref: "#/$defs/CompactionEntry",
        },
        {
          $ref: "#/$defs/RetryEntry",
        },
        {
          $ref: "#/$defs/CustomEntry",
        },
        {
          $ref: "#/$defs/ConfigEntry",
        },
        {
          $ref: "#/$defs/NoticeEntry",
        },
      ],
      description: "What happened in the driver's session, in keel's vocabulary.",
    },
    RunInfo: {
      type: "object",
      properties: {
        phase: {
          anyOf: [
            {
              type: "string",
              const: "idle",
            },
            {
              type: "string",
              const: "running",
            },
            {
              type: "string",
              const: "pausing",
            },
            {
              type: "string",
              const: "paused",
            },
            {
              type: "string",
              const: "stopping",
            },
          ],
        },
        compacting: {
          type: "boolean",
        },
        retrying: {
          type: "boolean",
        },
      },
      required: ["phase", "compacting", "retrying"],
      unevaluatedProperties: false,
      description:
        "keel's run control, not Pi's: a paused run is still active in Pi. `pausing` means a pause\nwas asked for and the run has not reached a point where it can wait yet.",
    },
    QueueInfo: {
      type: "object",
      properties: {
        steering: {
          type: "array",
          items: {
            type: "string",
          },
        },
        followUp: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["steering", "followUp"],
      unevaluatedProperties: false,
    },
    Operation: {
      anyOf: [
        {
          $ref: "#/$defs/DeclareActions",
        },
        {
          $ref: "#/$defs/Present",
        },
        {
          $ref: "#/$defs/DeclareAssist",
        },
        {
          $ref: "#/$defs/Withdraw",
        },
        {
          $ref: "#/$defs/ListAssists",
        },
        {
          $ref: "#/$defs/SetDraft",
        },
        {
          $ref: "#/$defs/AppendDraft",
        },
        {
          $ref: "#/$defs/OpenRequest",
        },
        {
          $ref: "#/$defs/CancelRequest",
        },
        {
          $ref: "#/$defs/CancelRequests",
        },
      ],
    },
    DriverResult: {
      anyOf: [
        {
          $ref: "#/$defs/ActionDone",
        },
        {
          $ref: "#/$defs/ActionAccepted",
        },
        {
          $ref: "#/$defs/Rejected",
        },
        {
          $ref: "#/$defs/Unknown",
        },
        {
          $ref: "#/$defs/Submitted",
        },
        {
          $ref: "#/$defs/CandidateList",
        },
      ],
    },
    OperationValue: {
      type: "object",
      properties: {
        registration: {
          type: "string",
        },
        revision: {
          type: "integer",
        },
        request: {
          type: "string",
        },
        assists: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      unevaluatedProperties: false,
    },
    RequestAnswer: {
      anyOf: [
        {
          $ref: "#/$defs/Answered",
        },
        {
          $ref: "#/$defs/Cancelled",
        },
      ],
    },
    Item: {
      anyOf: [
        {
          $ref: "#/$defs/UserItem",
        },
        {
          $ref: "#/$defs/ResponseItem",
        },
        {
          $ref: "#/$defs/ThinkingItem",
        },
        {
          $ref: "#/$defs/ProseItem",
        },
        {
          $ref: "#/$defs/CodeItem",
        },
        {
          $ref: "#/$defs/ToolItem",
        },
        {
          $ref: "#/$defs/CompactionItem",
        },
        {
          $ref: "#/$defs/RetryItem",
        },
        {
          $ref: "#/$defs/CustomItem",
        },
        {
          $ref: "#/$defs/ConfigItem",
        },
        {
          $ref: "#/$defs/NoticeItem",
        },
      ],
      description:
        "A timeline item: its renderer data by kind, and plain text any screen can show.",
    },
    RequestInfo: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        kind: {
          $ref: "#/$defs/RequestKind",
        },
        title: {
          type: "string",
        },
        message: {
          type: "string",
        },
        options: {
          type: "array",
          items: {
            type: "string",
          },
        },
        destination: {
          type: "string",
          description:
            "The draft destination that holds the request's supplement; absent when it takes none.",
        },
      },
      required: ["id", "kind", "title", "options"],
      unevaluatedProperties: false,
    },
    AssistInfo: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        title: {
          type: "string",
        },
        destination: {
          type: "string",
          description: "The draft destination the assist's candidates follow.",
        },
        revision: {
          type: "integer",
          description: "The draft revision the candidates were computed from; -1 before the first.",
        },
        candidates: {
          type: "array",
          items: {
            $ref: "#/$defs/Candidate",
          },
        },
      },
      required: ["id", "title", "destination", "revision", "candidates"],
      unevaluatedProperties: false,
    },
    RecordDraft: {
      type: "object",
      properties: {},
      unevaluatedProperties: {
        $ref: "#/$defs/Draft",
      },
    },
    ActionInfo: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        class: {
          $ref: "#/$defs/ActionClass",
        },
        title: {
          type: "string",
        },
        local: {
          type: "boolean",
          description: "The screen runs it from its own code; the model only declares it.",
        },
      },
      required: ["id", "class", "local"],
      unevaluatedProperties: false,
    },
    RecordArrayString: {
      type: "object",
      properties: {},
      unevaluatedProperties: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    RecordString: {
      type: "object",
      properties: {},
      unevaluatedProperties: {
        type: "string",
      },
    },
    UserEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "user",
        },
        text: {
          type: "string",
        },
        images: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: ["id", "version", "kind", "text", "images"],
      unevaluatedProperties: false,
    },
    AssistantEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "assistant",
        },
        parts: {
          type: "array",
          items: {
            $ref: "#/$defs/Part",
          },
        },
        streaming: {
          type: "boolean",
        },
        stopReason: {
          type: "string",
        },
        errorMessage: {
          type: "string",
        },
      },
      required: ["id", "version", "kind", "parts", "streaming"],
      unevaluatedProperties: false,
    },
    ToolEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "tool",
        },
        callId: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The tool entry whose call made this one.",
        },
        name: {
          type: "string",
        },
        args: {
          $ref: "#/$defs/ToolArguments",
        },
        state: {
          $ref: "#/$defs/ToolState",
        },
        result: {
          $ref: "#/$defs/ToolResultData",
        },
        extra: {
          $ref: "#/$defs/RecordUnknown",
          description: "The decorators' results, present while any decorates the tool.",
        },
      },
      required: ["id", "version", "kind", "callId", "name", "args", "state"],
      unevaluatedProperties: false,
    },
    CompactionEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "compaction",
        },
        state: {
          anyOf: [
            {
              type: "string",
              const: "running",
            },
            {
              type: "string",
              const: "completed",
            },
            {
              type: "string",
              const: "failed",
            },
            {
              type: "string",
              const: "aborted",
            },
          ],
        },
        reason: {
          type: "string",
        },
        summary: {
          type: "string",
        },
        tokensBefore: {
          type: "number",
        },
        errorMessage: {
          type: "string",
        },
      },
      required: ["id", "version", "kind", "state"],
      unevaluatedProperties: false,
    },
    RetryEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "retry",
        },
        category: {
          anyOf: [
            {
              type: "string",
              const: "response",
            },
            {
              type: "string",
              const: "summary",
            },
          ],
        },
        state: {
          anyOf: [
            {
              type: "string",
              const: "waiting",
            },
            {
              type: "string",
              const: "retrying",
            },
            {
              type: "string",
              const: "succeeded",
            },
            {
              type: "string",
              const: "failed",
            },
            {
              type: "string",
              const: "ended",
            },
          ],
        },
        attempts: {
          type: "array",
          items: {
            $ref: "#/$defs/RetryAttempt",
          },
        },
        finalError: {
          type: "string",
        },
      },
      required: ["id", "version", "kind", "category", "state", "attempts"],
      unevaluatedProperties: false,
    },
    CustomEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "custom",
        },
        customType: {
          type: "string",
        },
        text: {
          type: "string",
        },
        details: {},
      },
      required: ["id", "version", "kind", "customType", "text"],
      unevaluatedProperties: false,
    },
    ConfigEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "config",
        },
        setting: {
          anyOf: [
            {
              type: "string",
              const: "model",
            },
            {
              type: "string",
              const: "thinking",
            },
          ],
        },
        from: {
          type: "string",
        },
        to: {
          type: "string",
        },
      },
      required: ["id", "version", "kind", "setting", "from", "to"],
      unevaluatedProperties: false,
    },
    NoticeEntry: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique among the driver's entries.",
        },
        version: {
          type: "integer",
          description:
            "The driver's count of this entry's changes; not the model's state sequence.",
        },
        kind: {
          type: "string",
          const: "notice",
        },
        level: {
          $ref: "#/$defs/NoticeLevel",
        },
        text: {
          type: "string",
        },
      },
      required: ["id", "version", "kind", "level", "text"],
      unevaluatedProperties: false,
    },
    DeclareActions: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "declare_actions",
        },
        actions: {
          type: "array",
          items: {
            $ref: "#/$defs/ActionDeclaration",
          },
        },
      },
      required: ["op", "actions"],
      unevaluatedProperties: false,
      description: "Declares actions together; all are refused when one is invalid or taken.",
    },
    Present: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "present",
        },
        kind: {
          type: "string",
        },
        renderer: {
          type: "string",
        },
      },
      required: ["op", "kind", "renderer"],
      unevaluatedProperties: false,
      description:
        "Shows items of `kind` (or `kind/variant`) with the screen renderer named `renderer`.",
    },
    DeclareAssist: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "declare_assist",
        },
        id: {
          type: "string",
        },
        title: {
          type: "string",
        },
      },
      required: ["op", "id", "title"],
      unevaluatedProperties: false,
      description: "An assist whose candidates the driver computes for its draft.",
    },
    Withdraw: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "withdraw",
        },
        registration: {
          type: "string",
        },
      },
      required: ["op", "registration"],
      unevaluatedProperties: false,
      description: "Withdraws what a registration declared.",
    },
    ListAssists: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "list_assists",
        },
      },
      required: ["op"],
      unevaluatedProperties: false,
    },
    SetDraft: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "set_draft",
        },
        destination: {
          type: "string",
        },
        text: {
          type: "string",
        },
      },
      required: ["op", "destination", "text"],
      unevaluatedProperties: false,
      description: "Replaces an open draft as the driver; no writer is checked.",
    },
    AppendDraft: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "append_draft",
        },
        destination: {
          type: "string",
        },
        text: {
          type: "string",
        },
      },
      required: ["op", "destination", "text"],
      unevaluatedProperties: false,
      description: "Adds text to the end of an open draft, after a blank line when it has text.",
    },
    OpenRequest: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "open_request",
        },
        kind: {
          $ref: "#/$defs/RequestKind",
        },
        title: {
          type: "string",
        },
        message: {
          type: "string",
        },
        options: {
          type: "array",
          items: {
            type: "string",
          },
        },
        supplement: {
          type: "boolean",
          description: "Whether the answer carries a supplement the screen types.",
        },
      },
      required: ["op", "kind", "title", "options", "supplement"],
      unevaluatedProperties: false,
    },
    CancelRequest: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "cancel_request",
        },
        request: {
          type: "string",
        },
      },
      required: ["op", "request"],
      unevaluatedProperties: false,
    },
    CancelRequests: {
      type: "object",
      properties: {
        op: {
          type: "string",
          const: "cancel_requests",
        },
      },
      required: ["op"],
      unevaluatedProperties: false,
      description: "Cancels every open request the driver opened.",
    },
    ActionDone: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "done",
        },
        detail: {},
      },
      required: ["outcome"],
      unevaluatedProperties: false,
    },
    ActionAccepted: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "accepted",
        },
        detail: {},
      },
      required: ["outcome"],
      unevaluatedProperties: false,
    },
    Submitted: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "submitted",
        },
        disposition: {
          anyOf: [
            {
              type: "string",
              const: "started",
            },
            {
              type: "string",
              const: "queued",
            },
            {
              type: "string",
              const: "handled",
            },
          ],
        },
      },
      required: ["outcome", "disposition"],
      unevaluatedProperties: false,
      description:
        "Pi accepted the prompt: it started a run, queued it, or an extension command handled it.",
    },
    CandidateList: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          const: "candidates",
        },
        candidates: {
          type: "array",
          items: {
            $ref: "#/$defs/Candidate",
          },
        },
      },
      required: ["outcome", "candidates"],
      unevaluatedProperties: false,
    },
    Answered: {
      type: "object",
      properties: {
        status: {
          type: "string",
          const: "answered",
        },
        value: {
          anyOf: [
            {
              type: "string",
            },
            {
              type: "boolean",
            },
          ],
          description:
            "The chosen option of a choice, or whether a confirm's first option was chosen.",
        },
        supplement: {
          type: "string",
          description: "Present when the request took a supplement.",
        },
      },
      required: ["status", "value"],
      unevaluatedProperties: false,
    },
    Cancelled: {
      type: "object",
      properties: {
        status: {
          type: "string",
          const: "cancelled",
        },
      },
      required: ["status"],
      unevaluatedProperties: false,
    },
    UserItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "user",
        },
        data: {
          $ref: "#/$defs/UserData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    ResponseItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "response",
        },
        data: {
          $ref: "#/$defs/ResponseData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    ThinkingItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "thinking",
        },
        data: {
          $ref: "#/$defs/ThinkingData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    ProseItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "prose",
        },
        data: {
          $ref: "#/$defs/ProseData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    CodeItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "code",
        },
        data: {
          $ref: "#/$defs/CodeData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    ToolItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "tool",
        },
        data: {
          $ref: "#/$defs/ToolData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    CompactionItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "compaction",
        },
        data: {
          $ref: "#/$defs/CompactionData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    RetryItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "retry",
        },
        data: {
          $ref: "#/$defs/RetryData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    CustomItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "custom",
        },
        data: {
          $ref: "#/$defs/CustomData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    ConfigItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "config",
        },
        data: {
          $ref: "#/$defs/ConfigData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    NoticeItem: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        version: {
          type: "integer",
          description: "Changes whenever anything else in the item does.",
        },
        variant: {
          type: "string",
        },
        parentId: {
          type: "string",
          description: "The item this one is a part of; it comes after its parent in the order.",
        },
        text: {
          type: "string",
          description: "The item as plain text, for a screen without a renderer for its kind.",
        },
        source: {
          type: "string",
          description: "What the copy action writes; absent when the item holds no original text.",
        },
        tone: {
          $ref: "#/$defs/Tone",
        },
        kind: {
          type: "string",
          const: "notice",
        },
        data: {
          $ref: "#/$defs/NoticeData",
        },
      },
      required: ["id", "version", "text", "kind", "data"],
      unevaluatedProperties: false,
    },
    RequestKind: {
      anyOf: [
        {
          type: "string",
          const: "choice",
        },
        {
          type: "string",
          const: "confirm",
        },
      ],
    },
    Candidate: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        label: {
          type: "string",
        },
        detail: {
          type: "string",
        },
        current: {
          type: "boolean",
        },
        action: {
          $ref: "#/$defs/CandidateAction",
          description: "The action accepting the candidate runs, checked as that action.",
        },
      },
      required: ["id", "label", "action"],
      unevaluatedProperties: false,
    },
    Draft: {
      type: "object",
      properties: {
        text: {
          type: "string",
        },
        revision: {
          type: "integer",
          description: "Grows with every change of the text.",
        },
      },
      required: ["text", "revision"],
      unevaluatedProperties: false,
    },
    ActionClass: {
      anyOf: [
        {
          type: "string",
          const: "view",
        },
        {
          type: "string",
          const: "control",
        },
        {
          type: "string",
          const: "write",
        },
      ],
    },
    Part: {
      anyOf: [
        {
          $ref: "#/$defs/ThinkingPart",
        },
        {
          $ref: "#/$defs/TextPart",
        },
      ],
    },
    ToolArguments: {
      anyOf: [
        {
          $ref: "#/$defs/ArgumentsAvailable",
        },
        {
          $ref: "#/$defs/ArgumentsUnavailable",
        },
      ],
    },
    ToolState: {
      anyOf: [
        {
          type: "string",
          const: "pending",
        },
        {
          type: "string",
          const: "running",
        },
        {
          type: "string",
          const: "done",
        },
        {
          type: "string",
          const: "error",
        },
        {
          type: "string",
          const: "unfinished",
        },
      ],
    },
    ToolResultData: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The result's text blocks joined.",
        },
        images: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Descriptions of the result's images.",
        },
        details: {},
        partial: {
          type: "boolean",
          description: "A streamed update rather than the final result.",
        },
      },
      required: ["text", "images", "partial"],
      unevaluatedProperties: false,
    },
    RecordUnknown: {
      type: "object",
      properties: {},
      unevaluatedProperties: {},
    },
    RetryAttempt: {
      type: "object",
      properties: {
        attempt: {
          type: "number",
        },
        maxAttempts: {
          type: "number",
        },
        delayMs: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
      required: ["attempt", "maxAttempts", "delayMs", "error"],
      unevaluatedProperties: false,
    },
    NoticeLevel: {
      anyOf: [
        {
          type: "string",
          const: "info",
        },
        {
          type: "string",
          const: "warning",
        },
        {
          type: "string",
          const: "error",
        },
      ],
    },
    ActionDeclaration: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "`<layer>.<name>`; a layer that is a region (`editor`, `timeline`, `stage`) scopes its keys.",
        },
        class: {
          $ref: "#/$defs/ActionClass",
          description: "`write` when absent.",
        },
        title: {
          type: "string",
        },
        keys: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Default chords; global actions take none.",
        },
        runs: {
          anyOf: [
            {
              type: "string",
              const: "driver",
            },
            {
              type: "string",
              const: "screen",
            },
          ],
          description: "Where it runs: in the driver, or in the screen's own code.",
        },
      },
      required: ["id", "runs"],
      unevaluatedProperties: false,
    },
    Tone: {
      anyOf: [
        {
          type: "string",
          const: "user",
        },
        {
          type: "string",
          const: "dim",
        },
        {
          type: "string",
          const: "accent",
        },
        {
          type: "string",
          const: "warning",
        },
        {
          type: "string",
          const: "error",
        },
      ],
    },
    UserData: {
      type: "object",
      properties: {
        text: {
          type: "string",
        },
        images: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Attachment descriptions; images themselves are not sent.",
        },
      },
      required: ["text", "images"],
      unevaluatedProperties: false,
    },
    ResponseData: {
      type: "object",
      properties: {
        thinking: {
          type: "string",
          description: "Thinking text joined, for a collapsed preview.",
        },
        hasThinking: {
          type: "boolean",
        },
        thinkingWithheld: {
          type: "boolean",
          description: "Every thinking block was withheld; there is nothing to preview.",
        },
        body: {
          type: "string",
          description: "The prose and code as the model wrote them.",
        },
        streaming: {
          type: "boolean",
        },
        stopReason: {
          type: "string",
          description: "Pi's stop reason, such as stop, length, toolUse, error, or aborted.",
        },
        errorMessage: {
          type: "string",
        },
      },
      required: ["thinking", "hasThinking", "thinkingWithheld", "body", "streaming"],
      unevaluatedProperties: false,
    },
    ThinkingData: {
      type: "object",
      properties: {
        text: {
          type: "string",
        },
        withheld: {
          type: "boolean",
        },
      },
      required: ["text", "withheld"],
      unevaluatedProperties: false,
    },
    ProseData: {
      type: "object",
      properties: {
        text: {
          type: "string",
        },
        streaming: {
          type: "boolean",
        },
      },
      required: ["text", "streaming"],
      unevaluatedProperties: false,
    },
    CodeData: {
      type: "object",
      properties: {
        language: {
          type: "string",
        },
        body: {
          type: "string",
        },
        sourceText: {
          type: "string",
          description: "The raw fenced block, fences included.",
        },
        open: {
          type: "boolean",
          description: "No closing fence yet, as while a reply streams.",
        },
      },
      required: ["language", "body", "sourceText", "open"],
      unevaluatedProperties: false,
    },
    ToolData: {
      type: "object",
      properties: {
        callId: {
          type: "string",
        },
        name: {
          type: "string",
        },
        args: {
          $ref: "#/$defs/ToolArguments",
        },
        state: {
          $ref: "#/$defs/ToolState",
        },
        result: {
          $ref: "#/$defs/ToolResultData",
          description: "Absent when no result arrived; not an empty result.",
        },
        calls: {
          type: "array",
          items: {
            $ref: "#/$defs/NestedCallSummary",
          },
          description: "Calls this tool made, and calls those made, in the order they started.",
        },
        extra: {
          $ref: "#/$defs/RecordUnknown",
          description:
            "What the extensions decorating this tool added, by their names; opaque to the model.",
        },
      },
      required: ["callId", "name", "args", "state", "calls"],
      unevaluatedProperties: false,
    },
    CompactionData: {
      type: "object",
      properties: {
        state: {
          anyOf: [
            {
              type: "string",
              const: "running",
            },
            {
              type: "string",
              const: "completed",
            },
            {
              type: "string",
              const: "failed",
            },
            {
              type: "string",
              const: "aborted",
            },
          ],
        },
        reason: {
          type: "string",
        },
        summary: {
          type: "string",
        },
        tokensBefore: {
          type: "number",
        },
        errorMessage: {
          type: "string",
        },
      },
      required: ["state"],
      unevaluatedProperties: false,
    },
    RetryData: {
      type: "object",
      properties: {
        category: {
          anyOf: [
            {
              type: "string",
              const: "response",
            },
            {
              type: "string",
              const: "summary",
            },
          ],
        },
        state: {
          anyOf: [
            {
              type: "string",
              const: "waiting",
            },
            {
              type: "string",
              const: "retrying",
            },
            {
              type: "string",
              const: "succeeded",
            },
            {
              type: "string",
              const: "failed",
            },
            {
              type: "string",
              const: "ended",
            },
          ],
        },
        attempts: {
          type: "array",
          items: {
            $ref: "#/$defs/RetryAttempt",
          },
        },
        finalError: {
          type: "string",
        },
      },
      required: ["category", "state", "attempts"],
      unevaluatedProperties: false,
    },
    CustomData: {
      type: "object",
      properties: {
        customType: {
          type: "string",
        },
        text: {
          type: "string",
        },
        details: {},
      },
      required: ["customType", "text"],
      unevaluatedProperties: false,
    },
    ConfigData: {
      type: "object",
      properties: {
        setting: {
          anyOf: [
            {
              type: "string",
              const: "model",
            },
            {
              type: "string",
              const: "thinking",
            },
          ],
        },
        from: {
          type: "string",
        },
        to: {
          type: "string",
        },
      },
      required: ["setting", "from", "to"],
      unevaluatedProperties: false,
    },
    NoticeData: {
      type: "object",
      properties: {
        level: {
          $ref: "#/$defs/NoticeLevel",
        },
        text: {
          type: "string",
        },
      },
      required: ["level", "text"],
      unevaluatedProperties: false,
    },
    CandidateAction: {
      type: "object",
      properties: {
        id: {
          type: "string",
        },
        args: {},
      },
      required: ["id"],
      unevaluatedProperties: false,
    },
    ThinkingPart: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "thinking",
        },
        text: {
          type: "string",
        },
        withheld: {
          type: "boolean",
        },
      },
      required: ["type", "text", "withheld"],
      unevaluatedProperties: false,
    },
    TextPart: {
      type: "object",
      properties: {
        type: {
          type: "string",
          const: "text",
        },
        text: {
          type: "string",
        },
      },
      required: ["type", "text"],
      unevaluatedProperties: false,
    },
    ArgumentsAvailable: {
      type: "object",
      properties: {
        available: {
          type: "boolean",
          const: true,
        },
        value: {},
      },
      required: ["available", "value"],
      unevaluatedProperties: false,
    },
    ArgumentsUnavailable: {
      type: "object",
      properties: {
        available: {
          type: "boolean",
          const: false,
        },
      },
      required: ["available"],
      unevaluatedProperties: false,
    },
    NestedCallSummary: {
      type: "object",
      properties: {
        name: {
          type: "string",
        },
        args: {
          $ref: "#/$defs/ToolArguments",
        },
        state: {
          $ref: "#/$defs/ToolState",
        },
      },
      required: ["name", "args", "state"],
      unevaluatedProperties: false,
    },
  },
} as const;
