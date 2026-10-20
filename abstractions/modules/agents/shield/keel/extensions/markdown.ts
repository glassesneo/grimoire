/**
 * Responses as Markdown: the response, its thinking and prose as rendered
 * Markdown, and fenced code with syntax highlighting.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";

export default function markdown(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const { items } = keel(ctx);
    for (const kind of ["response", "thinking", "prose", "code"])
      items.present(kind, `markdown.${kind}`);
  });
}
