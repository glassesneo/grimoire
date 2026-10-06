import "./core/runtime-setup";
import { writeSync } from "node:fs";
import { getAgentDir, initTheme, type SessionManager } from "@earendil-works/pi-coding-agent";
import { render } from "@opentui/solid";
import { createSessionHost } from "./core/session";
import { resumeHint } from "./core/resume";
import { createSettingsManager } from "./core/settings";
import { notice } from "./core/session-entries";
import { Screen } from "./ui/screen";

export async function run(options: {
  configPath: string | undefined;
  sessionManager?: SessionManager;
}): Promise<void> {
  initTheme();
  const host = await createSessionHost({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    settingsManager: createSettingsManager(options.configPath),
    sessionManager: options.sessionManager,
  });

  const startupNotices = [
    ...host.runtime.diagnostics.map((diagnostic) => notice(diagnostic.type, diagnostic.message)),
    ...(host.runtime.modelFallbackMessage
      ? [notice("warning", host.runtime.modelFallbackMessage)]
      : []),
  ];

  // The quit action restores the terminal before the process exits, so the hint
  // lands below the shell prompt instead of inside the full-screen UI.
  process.once("exit", () => {
    const hint = resumeHint(host.runtime.session.sessionManager);
    if (hint && process.stdout.isTTY) writeSync(1, `${hint}\n`);
  });

  await render(() => <Screen host={host} startupNotices={startupNotices} />, {
    // Ctrl+C is the quit action, which disposes the session before exiting.
    exitOnCtrlC: false,
  });
}
