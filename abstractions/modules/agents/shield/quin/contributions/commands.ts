/**
 * The palette's native commands, after the harness's: each runs one of Pi's
 * RPC commands through the hub, so a change reaches every attached client.
 */
import type { Controller } from "../controller";
import type { Registration } from "../ui/controllers";
import type { QuinUI } from "../ui/quin-ui";

export function setupCommands(ui: QuinUI, controller: Controller): Registration[] {
  const rpc = (record: Record<string, unknown>) => controller.rpc(record);
  return [
    ui.commands.register({
      name: "model", description: "Choose the agent's model", acceptsArguments: true,
      candidates: async () => {
        const current = controller.adapter.view.timeline.model;
        const models: { provider: string; id: string; name?: string }[] = (await rpc({ type: "get_available_models" }))?.models ?? [];
        return [...models].sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`)).map((model) => {
          const value = `${model.provider}/${model.id}`;
          return { value, label: `${model.name ?? model.id} (${value})`, current: value === current };
        });
      },
      execute: async (argument) => {
        const separator = argument?.indexOf("/") ?? -1;
        if (!argument || separator < 1) throw new Error("A model is required as provider/id");
        await rpc({ type: "set_model", provider: argument.slice(0, separator), modelId: argument.slice(separator + 1) });
      },
    }),
    ui.commands.register({
      name: "thinking", description: "Choose the agent's thinking level", acceptsArguments: true,
      candidates: async () => {
        const current = controller.adapter.view.timeline.thinking;
        const levels: string[] = (await rpc({ type: "get_available_thinking_levels" }))?.levels ?? [];
        return levels.map((level) => ({ value: level, label: level, current: level === current }));
      },
      execute: async (argument) => {
        if (!argument) throw new Error("A thinking level is required");
        await rpc({ type: "set_thinking_level", level: argument });
      },
    }),
    ui.commands.register({
      name: "compact", description: "Compact the agent's history", acceptsArguments: true,
      execute: async (argument) => { await rpc({ type: "compact", ...(argument ? { customInstructions: argument } : {}) }); },
    }),
  ];
}
