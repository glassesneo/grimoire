/**
 * Operations on every queued instruction at once, from the editor: send them
 * all again as steering, or move them all into the prompt draft. Both are
 * writes; see the driver's control for what they keep and redo.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";

export default function queue(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const k = keel(ctx);
    await k.actions.register([
      {
        id: "editor.queue_steer_all",
        title: "Send every queued instruction again as steering",
        keys: ["alt+s"],
        run: () => k.queue.steerAll(),
      },
      {
        id: "editor.queue_edit_all",
        title: "Move every queued instruction into the prompt, replacing it",
        keys: ["alt+e"],
        run: () => k.queue.editAll(),
      },
    ]);
  });
}
