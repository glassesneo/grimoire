import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { sessionsDirectory } from "../client/paths";

export function cli(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "boolean" },
      help: { type: "boolean" },
      "check-keymap": { type: "boolean" },
      mock: { type: "boolean", default: false },
      model: { type: "string" },
      socket: { type: "string" },
      session: { type: "string" },
      fork: { type: "string" },
    },
  });
  if (values.session !== undefined && values.fork !== undefined)
    throw new Error("--session and --fork are mutually exclusive");
  if (values.session === "" || values.fork === "") throw new Error("session specifier is empty");
  return values;
}

export interface SavedSession {
  path: string;
  id: string;
  cwd: string;
  model?: string;
}
export interface SessionRequest {
  kind: "new" | "resume" | "fork";
  id: string;
  path?: string;
}

export function resolveSession(root: string, specifier: string, cwd: string): SavedSession {
  const executable = process.env.SHIELD_SESSION_RESOLVER;
  if (!executable) throw new Error("Session resolver is missing; use packaged quin");
  try {
    return JSON.parse(
      execFileSync(executable, [root, specifier, cwd], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error: any) {
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
}

export async function confirmFork(source: SavedSession, cwd: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error(
      "confirmation_required: another cwd's session requires an interactive terminal",
    );
  process.stderr.write(`Session cwd: ${source.cwd}\nFork saved contents into ${cwd}? [y/N] `);
  const input = createInterface({ input: process.stdin, terminal: false });
  try {
    for await (const line of input) return /^y(es)?$/i.test(line.trim());
    return false;
  } finally {
    input.close();
  }
}

/** Complete resolution and consent before connecting to the hub or creating the terminal UI. */
export async function startup(
  args: ReturnType<typeof cli>,
  cwd: string,
  resolve = resolveSession,
  confirm = confirmFork,
) {
  const specifier = args.session ?? args.fork;
  let session: SessionRequest = { kind: "new", id: randomUUID() };
  let savedModel: string | undefined;
  if (specifier !== undefined) {
    const saved = resolve(sessionsDirectory(args.mock), specifier, cwd);
    // A deleted old workspace is still a different cwd and can be forked.
    let savedCwd = saved.cwd;
    try {
      savedCwd = realpathSync(saved.cwd);
    } catch {}
    const different = savedCwd !== cwd;
    if (different && !(await confirm(saved, cwd)))
      throw new Error("cancelled: session fork declined");
    const fork = args.fork !== undefined || different;
    session = {
      kind: fork ? "fork" : "resume",
      id: fork ? randomUUID() : saved.id,
      path: saved.path,
    };
    savedModel = saved.model;
  }
  return {
    selection: { kind: specifier === undefined ? "cwd" : "identity", key: session.id },
    session,
    savedModel,
  };
}
