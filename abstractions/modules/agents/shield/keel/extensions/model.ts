/**
 * Choosing the model and thinking level, and compacting the history. Each is
 * a control action any screen may run, offered through an assist whose
 * candidates follow its draft; a command input reaches the same assists by
 * name. Compaction runs only while nothing runs.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";
import { isRecord, modelName } from "../protocol/format";
import type { Candidate } from "../protocol/wire";

function argument(args: unknown, field: string): string | undefined {
  const value = isRecord(args) ? args[field] : undefined;
  return typeof value === "string" ? value : undefined;
}

export default function model(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const k = keel(ctx);
    await k.actions.register([
      {
        id: "global.model_set",
        class: "control",
        title: "Choose the model",
        run: async ({ args }) => {
          const value = argument(args, "model") ?? "";
          const separator = value.indexOf("/");
          const found =
            separator > 0
              ? ctx.modelRegistry.find(value.slice(0, separator), value.slice(separator + 1))
              : undefined;
          if (!found) throw new Error(`unknown model ${value}`);
          if (!(await pi.setModel(found))) throw new Error(`no credentials for ${value}`);
        },
      },
      {
        id: "global.thinking_set",
        class: "control",
        title: "Choose the thinking level",
        run: ({ args }) => {
          const level = argument(args, "level");
          if (!level || !k.session.thinkingLevels().includes(level))
            throw new Error(`unavailable thinking level ${level}`);
          pi.setThinkingLevel(level as Parameters<ExtensionAPI["setThinkingLevel"]>[0]);
        },
      },
      {
        id: "global.compact",
        class: "control",
        title: "Compact the history",
        run: ({ args }) => k.session.compact(argument(args, "instructions") || undefined),
      },
    ]);
    const matches = (text: string, ...fields: string[]) => {
      const query = text.trim().toLowerCase();
      return !query || fields.some((value) => value.toLowerCase().includes(query));
    };
    await k.assists.register({
      id: "model",
      title: "Model",
      candidates: (text) => {
        const current = ctx.model ? modelName(ctx.model) : undefined;
        return ctx.modelRegistry
          .getAvailable()
          .map((model) => ({ value: modelName(model), label: model.name ?? model.id }))
          .filter((model) => matches(text, model.value, model.label))
          .sort((a, b) => a.value.localeCompare(b.value))
          .map((model): Candidate => ({
            id: model.value,
            label: model.value,
            ...(model.label !== model.value ? { detail: model.label } : {}),
            ...(model.value === current ? { current: true } : {}),
            action: { id: "global.model_set", args: { model: model.value } },
          }));
      },
    });
    await k.assists.register({
      id: "thinking",
      title: "Thinking level",
      candidates: (text) =>
        k.session
          .thinkingLevels()
          .filter((level) => matches(text, level))
          .map((level): Candidate => ({
            id: level,
            label: level,
            ...(level === pi.getThinkingLevel() ? { current: true } : {}),
            action: { id: "global.thinking_set", args: { level } },
          })),
    });
    await k.assists.register({
      id: "compact",
      title: "Compact",
      candidates: (text) => [
        {
          id: "compact",
          label: text.trim() ? `compact: ${text.trim()}` : "compact",
          detail: "summarize the history; optional instructions follow the name",
          action: { id: "global.compact", args: { instructions: text.trim() } },
        },
      ],
    });
  });
}
