import type { Context } from "@earendil-works/chord/context";
import {
  defineDoc,
  defineExtension,
  defineSignal,
  defineTask,
  GenerationTask,
  hook,
  hookTask,
  ToolTask,
  type ConversationId,
  type Harness,
  type HarnessInspection,
  type SignalKey,
  type ToolTaskInput,
} from "@earendil-works/pi-durable";

export type Pause = { paused: boolean; epoch: number };

export const PauseDoc = defineDoc<Pause>({
  kind: "edith.pause",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ paused: false, epoch: 0 }),
  checkpointWhen: () => true,
});

type Resume = "resume" | "interject";

const Resumed = defineSignal({
  name: "edith.resumed",
  version: 2,
  schema: { type: "string", enum: ["resume", "interject"] },
  migrate: () => "resume",
});

export const interjectedNote =
  "Not run: the user paused you before this call and then wrote to you; their message follows. Make the call again only if it is still needed after reading it.";

const resumeKey = (pause: Pause): SignalKey<unknown> => Resumed.key(`pause-${pause.epoch}`);

const parked = (pause: Pause | undefined) =>
  pause?.paused ? { signals: [resumeKey(pause)] } : undefined;

const Hold = defineTask<Record<string, never>, { phase: "hold" }, Record<string, never>>({
  name: "edith.hold",
  version: 1,
  initial: () => ({ phase: "hold" }),
  phases: {
    async hold(_task, runtime, context) {
      const pause = await runtime.snapshot(PauseDoc, runtime.conversationId, context);
      const sleep = parked(pause);
      await runtime.commit(
        () =>
          sleep
            ? { status: "sleeping", checkpoint: { phase: "hold" }, ...sleep }
            : { status: "terminal", outcome: { status: "completed", result: {} } },
        context,
      );
    },
  },
  async abort(_task, runtime, context) {
    await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
  },
});

export const controlExtension = defineExtension({
  name: "edith:control",
  tasks: [Hold],
  hooks: [
    hook(ToolTask, {
      async beforeTool(call, api, context) {
        if (call.parent) return undefined;
        const pause = await api.snapshot(PauseDoc, api.conversationId, context);
        const sleep = parked(pause);
        if (sleep) return { sleep };
        if (!pause || pause.epoch === 0) return undefined;
        const woke = await api.readSignal(Resumed, `pause-${pause.epoch}`, context);
        return woke && "value" in woke && woke.value === "interject"
          ? { block: interjectedNote }
          : undefined;
      },
    }),
    hook(GenerationTask, {
      async afterTools(_assistant, _results, api, context) {
        const pause = await api.snapshot(PauseDoc, api.conversationId, context);
        return pause?.paused ? { tasks: [hookTask(Hold, {})] } : undefined;
      },
    }),
  ],
});

export async function wake(
  harness: Harness,
  conversation: ConversationId,
  pause: Pause,
  how: Resume,
  context: Context,
): Promise<void> {
  const inspection = await harness.inspect(context);
  const steps = inspection.tasks.filter(
    (task) =>
      task.record.conversationId === conversation &&
      (task.record.kind === Hold.definition.name || task.record.kind === ToolTask.definition.name),
  );
  await Promise.all(
    steps.map((task) =>
      harness.signal(task.record.id, Resumed, `pause-${pause.epoch}`, how as never, context),
    ),
  );
}

export type Held =
  | { readonly kind: "tool"; readonly callId: string; readonly assistant: number }
  | { readonly kind: "request" };

export function heldStep(
  inspection: HarnessInspection,
  conversation: ConversationId,
): Held | undefined {
  for (const task of inspection.tasks) {
    if (task.record.conversationId !== conversation || task.state.kind !== "sleeping") continue;
    if (task.record.kind === Hold.definition.name) return { kind: "request" };
    const input = task.record.input as Partial<ToolTaskInput> | null;
    if (task.record.kind === ToolTask.definition.name && input?.kind === "model")
      return { kind: "tool", callId: input.callId ?? "", assistant: input.assistant ?? 0 };
  }
  return undefined;
}
