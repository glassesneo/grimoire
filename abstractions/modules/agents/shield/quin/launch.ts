import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { configDirectory, privateDirectory, stateDirectory } from "../client/paths";

export function options(mock: boolean, explicitModel?: string, cwd = realpathSync(process.cwd())) {
  const config = mock ? join(stateDirectory(), "mock/pi") : configDirectory();
  let model = explicitModel;
  if (mock) {
    if (model && model !== "shield-faux/fixed") throw new Error("--mock requires shield-faux/fixed");
    model = "shield-faux/fixed";
  } else if (!model) {
    try {
      const settings = JSON.parse(readFileSync(join(config, "settings.json"), "utf8"));
      if (typeof settings.defaultProvider === "string" && typeof settings.defaultModel === "string") model = `${settings.defaultProvider}/${settings.defaultModel}`;
    } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    // The package wrapper supplies the Nix module's default last.
    model ||= process.env.SHIELD_DEFAULT_MODEL || undefined;
  }
  if (model && !/^[^/]+\/.+/.test(model)) throw new Error("--model requires provider/id");
  // Model absence is sent through attach: an existing root can still be opened;
  // the hub refuses creation and explains model_required. A default model is not
  // checked against an existing root; an explicit (or mock) one is.
  const modelSource = explicitModel || mock ? "explicit" : "default";
  privateDirectory(config);
  const sessions = join(stateDirectory(), mock ? "mock/sessions" : "sessions", createHash("sha256").update(cwd).digest("hex"));
  privateDirectory(sessions);
  const executable = process.env.SHIELD_PI;
  const extension = process.env[mock ? "SHIELD_FAUX" : "SHIELD_COMMANDCODE"];
  if (!executable || !extension) throw new Error("Pi runtime is missing; use packaged quin");
  const argv = ["--mode", "rpc", "--no-approve", "--session-dir", sessions, "--extension", extension];
  if (model) argv.push("--model", model);
  const env: Record<string, string> = {
    HOME: mock ? join(stateDirectory(), "mock/home") : homedir(),
    PATH: process.env.PATH || "/usr/bin:/bin", LANG: "en_US.UTF-8",
    PI_CODING_AGENT_DIR: config,
    PI_TELEMETRY: "off",
  };
  if (mock) {
    privateDirectory(env.HOME!);
    Object.assign(env, { PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" });
    argv.push("--no-extensions", "--no-builtin-tools", "--tools", "shield_fixture", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files");
  }
  return { mode: mock ? "mock" : "live", model, modelSource, launch: { executable, argv, env } };
}
