/**
 * Example pi extension using `ctx.ui.harness`, the harness's data-only client
 * (src/ui/harness-client.ts). It shows calls of its tool with the compiled
 * bash presentation and keeps a status line segment. Under ordinary pi the
 * client is absent and the extension does nothing extra; nothing here renders
 * UI itself. The harness does not load this file; tests load it as an
 * extension.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HarnessUIClient, StatuslineHandle } from "../ui/harness-client";

export default function harnessClientExample(pi: ExtensionAPI): void {
  let status: StatuslineHandle<string> | undefined;

  pi.registerTool({
    name: "example_shell",
    label: "Example shell",
    description: "Echoes a command instead of running it",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } as never,
    async execute(_id, args: { command: string }) {
      return { content: [{ type: "text", text: `would run: ${args.command}` }], details: {} };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const harness = (ctx.ui as { harness?: HarnessUIClient }).harness;
    if (harness?.version !== 1) return;
    // The snapshot already has the shape the bash presentation reads.
    harness.timeline.bindTool("example_shell", "tool:bash");
    status = harness.statusline.setText({ position: "bottom", key: "example", text: "example: idle" });
  });
  pi.on("agent_start", () => status?.update("example: working"));
  pi.on("agent_settled", () => status?.update("example: idle"));
}
