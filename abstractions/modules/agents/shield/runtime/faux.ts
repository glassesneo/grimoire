// quin --mock's provider: /fixture-tool, /fixture-dialog, and /fixture-timeout replay fixed,
// harmless responses. The real bash fixture used by the checks is a separate extension.
import { fauxProvider, fauxAssistantMessage, fauxThinking, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  const faux = fauxProvider({ provider: "shield-faux", models: [{ id: "fixed", reasoning: true }], tokensPerSecond: 24, tokenSize: { min: 2, max: 2 } });
  pi.registerProvider(faux.provider);
  let toolFixture = false;
  pi.on("before_agent_start", () => {
    if (toolFixture) {
      toolFixture = false;
      faux.setResponses([fauxAssistantMessage(fauxToolCall("shield_fixture", {}, { id: "fixture-call" }), { stopReason: "toolUse" }), fauxAssistantMessage("Fixture finished.")]);
    } else {
      faux.setResponses([fauxAssistantMessage([fauxThinking("A fixed offline response."), fauxText("SHIELD mock: this response keeps streaming while quin is detached. Open quin again in the same directory to continue watching.")])]);
    }
  });
  pi.registerTool({ name: "shield_fixture", label: "Fixture", description: "Harmless fixed waiting fixture", parameters: Type.Object({}),
    async execute(_id, _args, signal) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1500);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
      });
      return { content: [{ type: "text", text: "fixture complete" }], details: {} };
    }
  });
  pi.registerCommand("fixture-tool", { description: "Run a harmless mock tool", handler: async (_, ctx) => {
    toolFixture = true;
    pi.sendUserMessage("Run fixture", { deliverAs: "followUp" });
  } });
  pi.registerCommand("fixture-timeout", { description: "A short standard dialog timeout", handler: async (_, ctx) => {
    await ctx.ui.select("Timed fixture", ["one"], { timeout: 250 });
  } });
  pi.registerCommand("fixture-dialog", { description: "Exercise standard RPC dialogs", handler: async (_, ctx) => {
    const choice = await ctx.ui.select("Fixture choice", ["one", "two"], { timeout: 15000 });
    const confirmed = await ctx.ui.confirm("Fixture confirm", "Continue?");
    const input = await ctx.ui.input("Fixture input", "text");
    const edited = await ctx.ui.editor("Fixture editor", "initial");
    ctx.ui.notify(JSON.stringify({ choice, confirmed, input, edited }), "info");
  } });
}
