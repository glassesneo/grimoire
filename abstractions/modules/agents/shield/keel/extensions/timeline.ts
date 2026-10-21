/**
 * Moving through the timeline: the cursor, disclosure, scrolling, and copying
 * an item's original text. The screen carries these out; this extension
 * declares them and their keys, so they exist only while it is loaded.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";

const actions: Record<string, string[]> = {
  "timeline.cursor_down": ["j", "down"],
  "timeline.cursor_up": ["k", "up"],
  "timeline.toggle": ["return", "kpenter", "space"],
  "timeline.expand": ["l", "right"],
  "timeline.collapse": ["h", "left"],
  "timeline.copy": ["y"],
  "timeline.page_down": ["ctrl+f"],
  "timeline.page_up": ["ctrl+b"],
  "timeline.half_down": ["ctrl+d"],
  "timeline.half_up": ["ctrl+u"],
  "timeline.focus_editor": ["escape"],
};

export default function timeline(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await keel(ctx).actions.register(
      Object.entries(actions).map(([id, keys]) => ({ id, class: "view" as const, keys })),
    );
  });
}
