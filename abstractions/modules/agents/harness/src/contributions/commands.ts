import type { SessionHost } from "../core/session";
import type { HarnessUI } from "../ui/harness-ui";

/** All SDK operations resolve the current session, including after replacement. */
export function setupCommands(ui: HarnessUI, host: SessionHost, notify: (text: string) => void) {
  const session = () => host.runtime.session;
  return [
    ui.commands.register({
      name: "model",
      description: "Choose the current session model",
      acceptsArguments: true,
      candidates: async () => {
        const current = session().model;
        const models = await session().modelRuntime.getAvailable();
        return [...models]
          .sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`))
          .map((model) => ({
            value: `${model.provider}/${model.id}`,
            label: `${model.name} (${model.provider}/${model.id})`,
            current: current?.provider === model.provider && current?.id === model.id,
          }));
      },
      execute: async (argument) => {
        if (!argument) throw new Error("A model is required");
        const separator = argument.indexOf("/");
        const provider = argument.slice(0, separator);
        const id = argument.slice(separator + 1);
        const current = session();
        const model = (await current.modelRuntime.getAvailable()).find(
          (model) => model.provider === provider && model.id === id,
        );
        if (separator < 1 || !model) throw new Error("The selected model is no longer available");
        await current.setModel(model);
      },
    }),
    ui.commands.register({
      name: "thinking",
      description: "Choose the current session thinking level",
      acceptsArguments: true,
      candidates: () =>
        session()
          .getAvailableThinkingLevels()
          .map((level) => ({
            value: level,
            label: level,
            current: session().thinkingLevel === level,
          })),
      execute: (argument) => {
        const current = session();
        const level = current.getAvailableThinkingLevels().find((level) => level === argument);
        if (level === undefined)
          throw new Error("The selected thinking level is no longer available");
        current.setThinkingLevel(level);
      },
    }),
    ui.commands.register({
      name: "new",
      description: "Start a new session",
      acceptsArguments: false,
      execute: async () => {
        if ((await host.newSession()).cancelled) notify("New session cancelled");
      },
    }),
    ui.commands.register({
      name: "compact",
      description: "Compact the current history",
      acceptsArguments: true,
      execute: async (argument) => {
        await session().compact(argument);
      },
    }),
    ui.commands.register({
      name: "reload",
      description: "Reload extensions and resources",
      acceptsArguments: false,
      execute: () => host.reload(),
    }),
  ];
}
