/**
 * The launch descriptor quin sends on attach. Pi's session files, its only
 * persistent history, are kept per working directory under the state directory.
 * Every agent has codemode in `only` mode. A mock agent gets its own config, HOME and
 * sessions, the faux provider, and no resource discovery, external providers, or
 * built-in tools.
 */
import { readFileSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  configDirectory,
  privateDirectory,
  sessionsDirectory,
  stateDirectory,
} from "../client/paths";
import type { SessionRequest } from "./startup";

export function options(
  mock: boolean,
  explicitModel?: string,
  cwd = realpathSync(process.cwd()),
  runtime: { extension?: string; tools?: string; builtinTools?: boolean } = {},
  session: SessionRequest = { kind: "new", id: randomUUID() },
  savedModel?: string,
) {
  const config = mock ? join(stateDirectory(), "mock/pi") : configDirectory();
  let model = explicitModel || savedModel;
  if (mock) {
    if (model && model !== "shield-faux/fixed")
      throw new Error("--mock requires shield-faux/fixed");
    model = "shield-faux/fixed";
  } else if (!model) {
    try {
      const settings = JSON.parse(readFileSync(join(config, "settings.json"), "utf8"));
      if (typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string")
        model = `${settings.defaultProvider}/${settings.defaultModel}`;
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    // The package wrapper supplies the Nix module's default last.
    model ||= process.env.SHIELD_DEFAULT_MODEL || undefined;
  }
  if (model && !/^[^/]+\/.+/.test(model)) throw new Error("--model requires provider/id");
  // Model absence is sent through attach: an existing root can still be opened;
  // the hub refuses creation and explains model_required. The model chooses only
  // a new root's model, since any client can change it later.
  privateDirectory(config);
  const sessions = join(sessionsDirectory(mock), createHash("sha256").update(cwd).digest("hex"));
  privateDirectory(sessions);
  const executable = process.env.SHIELD_PI;
  const extension = runtime.extension ?? process.env[mock ? "SHIELD_FAUX" : "SHIELD_COMMANDCODE"];
  const codemode = process.env.SHIELD_CODEMODE;
  if (!executable || !extension || !codemode)
    throw new Error("Pi runtime is missing; use packaged quin");
  const argv = [
    "--mode",
    "rpc",
    "--no-approve",
    "--session-dir",
    sessions,
    "--extension",
    extension,
    "--extension",
    codemode,
  ];
  if (model) argv.push("--model", model);
  argv.push("--tools", runtime.tools ?? (mock ? "shield_fixture,codemode" : "+codemode"));
  if (!(runtime.builtinTools ?? !mock)) argv.push("--no-builtin-tools");
  const inherited = mock
    ? {}
    : Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
  const path = process.env.PATH || "/usr/bin:/bin";
  const prefix = !mock && process.env.SHIELD_TOOLS_PATH;
  const env: Record<string, string> = {
    ...inherited,
    HOME: mock ? join(stateDirectory(), "mock/home") : homedir(),
    PATH: prefix ? `${prefix}:${path}` : path,
    LANG: (!mock && process.env.LANG) || "en_US.UTF-8",
    PI_CODING_AGENT_DIR: config,
    PI_TELEMETRY: "off",
  };
  if (mock) {
    privateDirectory(env.HOME!);
    Object.assign(env, { PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" });
    argv.push(
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
    );
  }
  return { mode: mock ? "mock" : "live", model, session, launch: { executable, argv, env } };
}
