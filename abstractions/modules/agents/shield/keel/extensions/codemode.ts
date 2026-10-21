/**
 * Pi's codemode tool in `only` mode, where the model is given codemode alone
 * and reaches every other tool from its scripts, and its presentation: the
 * nested calls a script made, its output, and the line it failed on, read
 * from the result here so the screen only shows them. Pi registers the tool
 * inactive; loading this extension activates it.
 */
import { createCodemodeExtension, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";
import { imageLabel } from "../driver/content";
import {
  codemodeErrorLocation,
  codemodeOutput,
  codemodeWallTime,
  readableOutput,
} from "./codemode-result";

/** What the codemode renderer reads from `data.extra.codemode`. */
export interface CodemodeSummary {
  code?: string;
  wallTime?: string;
  header?: string;
  output: string;
  images: string[];
  error?: string;
  location?: { kind: "located"; line: number } | { kind: "unlocated" } | { kind: "unrecognized" };
}

const codemode = createCodemodeExtension({ mode: "only" });

export default async function codemodeExtension(pi: ExtensionAPI): Promise<void> {
  await codemode(pi);
  pi.on("session_start", async (_event, ctx) => {
    if (!pi.getActiveTools().includes("codemode"))
      pi.setActiveTools([...pi.getActiveTools(), "codemode"]);
    const { items } = keel(ctx);
    await items.present("tool/codemode", "tool.codemode");
    items.decorateTool("codemode", "codemode", (tool, content): CodemodeSummary => {
      const value = tool.args.available ? tool.args.value : undefined;
      const code =
        value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string"
          ? (value as { code: string }).code
          : undefined;
      const output = codemodeOutput(content);
      const location =
        code === undefined
          ? undefined
          : codemodeErrorLocation(code, { content, isError: tool.state === "error" });
      return {
        ...(code === undefined ? {} : { code }),
        ...(tool.result ? { wallTime: codemodeWallTime(content) } : {}),
        ...(output.header ? { header: output.header } : {}),
        output: readableOutput(output.output),
        images: output.images.map(imageLabel),
        ...(output.error ? { error: output.error } : {}),
        ...(location ? { location } : {}),
      };
    });
  });
}
