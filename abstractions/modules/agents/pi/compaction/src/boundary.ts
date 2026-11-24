import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  convertToLlm,
  type CompactionEntry,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { recoveryPrefix, recoveryText, type ReplayItem } from "./responses.ts";

type Replay = { identity: string; tools: string; replay: ReplayItem[] };
type Checkpoint = Replay & ({ version: 1 } | { version: 2; recovery: AgentMessage[] });

export function checkpointRecord(replay: Replay, messages: AgentMessage[]) {
  // Pi counts summary text as prompt tokens when provider usage is unavailable.
  return {
    summary: `OpenAI Responses checkpoint (${randomUUID()})`,
    details: {
      responsesCheckpoint: {
        ...replay,
        version: 2,
        recovery: convertToLlm(messages),
      } satisfies Checkpoint,
    },
  };
}

export const retiredType = "responses-checkpoint-retired";
export const fallbackType = "responses-fallback";

export function savedFallback(ctx: ExtensionContext): boolean {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast((item) => item.type === "custom" && item.customType === fallbackType);
  return (entry as { data?: { blocked?: unknown } } | undefined)?.data?.blocked === true;
}

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
  if (!Array.isArray(checkpoint?.replay)) return;
  const messages =
    checkpoint.version === 2
      ? checkpoint.recovery
      : checkpoint.version === 1 && entry.summary.startsWith(recoveryPrefix)
        ? (JSON.parse(entry.summary.slice(recoveryPrefix.length)) as AgentMessage[])
        : undefined;
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
