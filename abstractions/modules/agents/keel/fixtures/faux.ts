// A test and development extension, loaded only when extensions.json lists its path: the
// shield-faux/fixed provider, whose commands /fixture-tool, /fixture-codemode, and
// /fixture-request replay fixed, harmless responses; /fixture-tools reports the declared
// tools and /fixture-environment the synthetic environment the process checks set. The real
// bash fixture the checks use is a separate extension.
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxThinking,
  fauxText,
  fauxToolCall,
  type FauxResponseStep,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { keel } from "../api";

export default function (pi: ExtensionAPI) {
  const faux = fauxProvider({
    provider: "shield-faux",
    models: [{ id: "fixed", reasoning: true }],
    tokensPerSecond: 24,
    tokenSize: { min: 2, max: 2 },
  });
  pi.registerProvider(faux.provider);
  let fixture: FauxResponseStep[] | undefined;
  pi.on("before_agent_start", () => {
    if (fixture) {
      faux.setResponses(fixture);
      fixture = undefined;
    } else {
      faux.setResponses([
        fauxAssistantMessage([
          fauxThinking("A fixed offline response."),
          fauxText(
            "keel fixture: this response keeps streaming while the screen is closed. Open keel again in the same directory to continue watching.",
          ),
        ]),
      ]);
    }
  });
  pi.registerTool({
    name: "shield_fixture",
    label: "Fixture",
    description: "Harmless fixed waiting fixture",
    parameters: Type.Object({}),
    async execute(_id, _args, signal) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1500);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
      return { content: [{ type: "text", text: "fixture complete" }], details: {} };
    },
  });
  pi.registerCommand("fixture-tool", {
    description: "Run a harmless mock tool",
    handler: async () => {
      fixture = [
        fauxAssistantMessage(fauxToolCall("shield_fixture", {}, { id: "fixture-call" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("Fixture finished."),
      ];
      pi.sendUserMessage("Run fixture", { deliverAs: "followUp" });
    },
  });
  // One script that completes and one that fails on its second line, each calling the fixture.
  pi.registerCommand("fixture-codemode", {
    description: "Run harmless codemode scripts",
    handler: async () => {
      const script = (id: string, code: string) =>
        fauxAssistantMessage(fauxToolCall("codemode", { code }, { id }), { stopReason: "toolUse" });
      fixture = [
        script(
          "fixture-script",
          "const result = await tools.shield_fixture({});\ntext(result);\nreturn { finished: true };",
        ),
        script("fixture-failure", "await tools.shield_fixture({});\nnull.missing;"),
        fauxAssistantMessage("Fixture scripts finished."),
      ];
      pi.sendUserMessage("Run codemode fixture", { deliverAs: "followUp" });
    },
  });
  // Answers with the tools the request declares, replayed from the transcript's system
  // messages, and how many tools named codemode are registered.
  pi.registerCommand("fixture-tools", {
    description: "Report the tools declared to the model",
    handler: async () => {
      fixture = [
        (context) => {
          const declared = new Set<string>();
          for (const message of context.messages) {
            if (message.role !== "system") continue;
            for (const tool of message.toolsRemoved ?? []) declared.delete(tool.name);
            for (const tool of message.toolsAdded ?? []) declared.add(tool.name);
          }
          const codemode = pi.getAllTools().filter((tool) => tool.name === "codemode").length;
          return fauxAssistantMessage(
            fauxText(JSON.stringify({ declared: [...declared].sort(), codemode })),
          );
        },
      ];
      pi.sendUserMessage("Report tools", { deliverAs: "followUp" });
    },
  });
  // Only synthetic fixture values are reported, never the process environment.
  pi.registerCommand("fixture-environment", {
    description: "Report isolated process-check environment and tool precedence",
    handler: async (_, ctx) => {
      const runtimeKey = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
      const probe = await pi.exec("shield-env-probe", []);
      fixture = [
        fauxAssistantMessage(
          JSON.stringify({
            creator: process.env.SHIELD_TEST_CREATOR ?? null,
            hubOnly: process.env.SHIELD_TEST_HUB_ONLY ?? null,
            creatorKey: process.env.CMD_API_KEY === "shield-test-creator-key",
            runtimeKey: runtimeKey === "shield-test-runtime-key",
            probe: probe.stdout.trim(),
          }),
        ),
      ];
      pi.sendUserMessage("Report fixture environment", { deliverAs: "followUp" });
    },
  });
  // A keel request the user answers, reported with its supplement. The command returns at
  // once: Pi accepts a command's prompt only when its handler returns.
  pi.registerCommand("fixture-request", {
    description: "Ask a keel choice request",
    handler: async (_, ctx) => {
      const k = keel(ctx);
      void k.requests
        .choice({ title: "Fixture choice", options: ["one", "two"] })
        .then((answer) => k.items.notice("info", JSON.stringify(answer)));
    },
  });
}
