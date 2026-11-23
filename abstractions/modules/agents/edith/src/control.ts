// Pausing a conversation: while it is paused, no new step starts. What already runs outside EDITH,
// a model's response or a running tool, ends as it would; a tool call the model asked for waits
// before it runs, and after a round of tools the next model request waits, until the conversation
// is resumed or aborted. Both waits are parked tasks, so a pause outlives a restart. Each pause has
// its own resume signal key, since a key holds one value. The waits have no deadline, which would
// expire the key; instead a resume signals every live step of the conversation, also one about to
// park, whose later sleep on a key that already holds the value wakes at once.
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
  type SignalKey,
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

const Resumed = defineSignal({ name: "edith.resumed", version: 1, schema: { type: "boolean" } });

const resumeKey = (pause: Pause): SignalKey<unknown> => Resumed.key(`pause-${pause.epoch}`);

// What a parked step sleeps on while the conversation is paused.
const parked = (pause: Pause | undefined) =>
  pause?.paused ? { signals: [resumeKey(pause)] } : undefined;

// Holds a run between a round of tools and its next model request while paused.
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
      // A call a running script makes belongs to that running tool, which ends as it would.
      async beforeTool(call, api, context) {
        if (call.parent) return undefined;
        const sleep = parked(await api.snapshot(PauseDoc, api.conversationId, context));
        return sleep && { sleep };
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

// Wakes the conversation's parked steps with the pause's resume key, and gives it to those that
// may still park.
export async function wake(
  harness: Harness,
  conversation: ConversationId,
  pause: Pause,
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
      harness.signal(task.record.id, Resumed, `pause-${pause.epoch}`, true, context),
    ),
  );
}
