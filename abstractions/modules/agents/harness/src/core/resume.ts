import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * Opens the session `--session` names: a path to a session file, or an id or
 * id prefix. A session from another directory is forked into `cwd` once the
 * user confirms, so its history continues where the harness now runs.
 * Returns undefined when nothing matches or the user declines.
 */
export async function openSession(argument: string, cwd: string): Promise<SessionManager | undefined> {
  if (argument.includes("/") || argument.endsWith(".jsonl")) {
    const path = resolve(cwd, argument);
    if (!existsSync(path)) {
      console.error(`No session file at ${path}`);
      return undefined;
    }
    return SessionManager.open(path);
  }

  const local = await SessionManager.list(cwd);
  const localMatch = local.find((session) => session.id === argument) ?? local.find((session) => session.id.startsWith(argument));
  if (localMatch) return SessionManager.open(localMatch.path);

  const all = await SessionManager.listAll();
  const match = all.find((session) => session.id === argument) ?? all.find((session) => session.id.startsWith(argument));
  if (!match) {
    console.error(`No session found matching '${argument}'`);
    return undefined;
  }
  console.log(`Session ${match.id} was started in ${match.cwd}.`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question("Fork it into the current directory? [y/N] ");
  prompt.close();
  return /^y(es)?$/i.test(answer.trim()) ? SessionManager.forkFrom(match.path, cwd) : undefined;
}

/** pi's exit hint, for a session that has started writing its file. */
export function resumeHint(sessionManager: SessionManager): string | undefined {
  const file = sessionManager.getSessionFile();
  if (!sessionManager.isPersisted() || !file || !existsSync(file)) return undefined;
  return `To resume this session: harness --session ${sessionManager.getSessionId()}`;
}
