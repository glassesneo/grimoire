/**
 * What the screen asks the hub to start: the keel runtime, in this directory,
 * reading the configuration directory, with this screen's environment. Pi's
 * session file goes to SHIELD's sessions directory for the cwd. A running
 * agent keeps the environment it started with; attaching does not change it.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateDirectory, sessionsDirectory } from "../../client/paths";

export function launchOptions(cwd: string, configDir: string) {
  const executable = process.env.KEEL_RUNTIME;
  if (!executable) throw new Error("the keel runtime is missing; use the packaged keel");
  privateDirectory(configDir);
  const sessions = join(sessionsDirectory(), createHash("sha256").update(cwd).digest("hex"));
  privateDirectory(sessions);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const path = process.env.PATH || "/usr/bin:/bin";
  const tools = process.env.SHIELD_TOOLS_PATH;
  return {
    configDir,
    launch: {
      executable,
      argv: ["--session-dir", sessions],
      env: {
        ...inherited,
        HOME: homedir(),
        PATH: tools ? `${tools}:${path}` : path,
        // Pi and its extensions find the agent directory through this variable.
        PI_CODING_AGENT_DIR: configDir,
        PI_TELEMETRY: "off",
      },
    },
  };
}
