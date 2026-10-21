/** The extensions keel ships, by the name extensions.json lists them under. */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Bundled } from "../driver/driver";
import codemode from "./codemode";
import commands from "./commands";
import markdown from "./markdown";
import model from "./model";
import queue from "./queue";
import timeline from "./timeline";
import tools from "./tools";

/** A third-party Pi extension shipped with keel, loaded from its own files. */
function packaged(name: string, file: string): Bundled {
  const root = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
  return { path: join(root, file) };
}

export function bundledExtensions(): Record<string, Bundled> {
  return {
    codemode,
    commands,
    markdown,
    model,
    queue,
    timeline,
    tools,
    commandcode: packaged("@commandcode/pi-commandcode-provider", "index.ts"),
  };
}
