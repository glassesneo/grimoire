/**
 * Tool calls with their arguments and results: a header with the call's
 * summary and state, the result or error under it, and every field when
 * expanded; the bash tool shows its command and output.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";

export default function tools(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const { items } = keel(ctx);
    await items.present("tool", "tool.generic");
    await items.present("tool/bash", "tool.bash");
  });
}
