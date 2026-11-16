// Pi's side of Responses compaction: checkpoints and fallback state as Pi session entries.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  convertToLlm,
  type CompactionEntry,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { recoveryPrefix, recoveryText, type Checkpoint } from "./responses.ts";

// A retired checkpoint no longer matches the model or tools; it only restores readable history.
export const retiredType = "responses-checkpoint-retired";
// Standard-compaction fallback lasts until the next human input, across session reloads.
export const fallbackType = "responses-fallback";

export function savedFallback(ctx: ExtensionContext): boolean {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast((item) => item.type === "custom" && item.customType === fallbackType);
  return (entry as { data?: { blocked?: unknown } } | undefined)?.data?.blocked === true;
}

// Only the latest active compaction owns the projection; never revive an older checkpoint.
export function saved(ctx: ExtensionContext):
  | {
      entry: CompactionEntry;
      checkpoint: Checkpoint;
      restore: AgentMessage[];
      replayable: boolean;
    }
  | undefined {
  const branch = ctx.sessionManager.getBranch();
  const index = branch.findLastIndex((item) => item.type === "compaction");
  const entry = branch[index];
  if (entry?.type !== "compaction") return;
  const replayable = !branch
    .slice(index + 1)
    .some((item) => item.type === "custom" && item.customType === retiredType);
  const checkpoint = (entry.details as { responsesCheckpoint?: Checkpoint } | undefined)
    ?.responsesCheckpoint;
  if (
    checkpoint?.version !== 1 ||
    !Array.isArray(checkpoint.replay) ||
    !entry.summary.startsWith(recoveryPrefix)
  )
    return;
  const messages = JSON.parse(entry.summary.slice(recoveryPrefix.length)) as AgentMessage[];
  if (Array.isArray(messages)) return { entry, checkpoint, restore: messages, replayable };
}

export type Saved = ReturnType<typeof saved>;

export function restore(messages: readonly AgentMessage[], checkpoint: Saved): AgentMessage[] {
  return messages.flatMap((message) =>
    message.role === "compactionSummary" && message.summary === checkpoint?.entry.summary
      ? checkpoint.restore
      : [message],
  );
}

export function readable(messages: AgentMessage[]): string {
  return recoveryText(convertToLlm(messages));
}
