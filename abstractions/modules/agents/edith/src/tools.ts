// The tools EDITH brings itself, as one extension an access selects from by name. They touch
// files and processes only through the conversation's execution environment, which
// `toolEnvironment` places with another user, so the model reaches nothing of EDITH's own.
import { readFileSync, writeFileSync } from "node:fs";
import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";
import { RemoteExecutionEnv, sshConnection } from "@earendil-works/pi-env";

export const toolNames = ["read", "write", "edit", "bash"] as const;
export type ToolName = (typeof toolNames)[number];

export const toolsExtension: Extension = defineExtension({
  name: "tools",
  namespace: {
    name: "tools",
    description: "Files and commands in EDITH's workspace, which belongs to a user of its own.",
  },
  tools: [createReadTool(), createWriteTool(), createEditTool(), createBashTool()].map((tool) => ({
    ...tool,
    callers: ["tools"] as const,
  })),
});

export type ToolEnvironmentConfig = {
  // The user the tools run as, on this machine.
  readonly user: string;
  // Its home, the tools' working directory.
  readonly cwd: string;
  // EDITH's key for logging in as that user.
  readonly identityFile: string;
  // EDITH's own known-hosts file, rewritten at each start.
  readonly knownHostsFile: string;
  // This machine's host key, which sshd presents to the login.
  readonly hostKeyFile: string;
};

// A pi-env daemon reached over ssh to this machine as the tools' user. ssh runs without the
// person's configuration, so nothing of it, such as a forwarded agent, reaches the tools.
export function toolEnvironment(config: ToolEnvironmentConfig): ExecutionEnv {
  const hostKeyAlias = "edith-tools";
  const [type, key] = readFileSync(config.hostKeyFile, "utf8").trim().split(/\s+/);
  writeFileSync(config.knownHostsFile, `${hostKeyAlias} ${type} ${key}\n`, { mode: 0o600 });
  const { connection } = sshConnection({
    host: "localhost",
    user: config.user,
    identityFile: config.identityFile,
    knownHostsFile: config.knownHostsFile,
    hostKeyAlias,
    ssh: "/usr/bin/ssh",
    configFile: "/dev/null",
    onLog: (text) => console.error(`tools: ${text.trimEnd()}`),
  });
  return new RemoteExecutionEnv({ connection, id: hostKeyAlias, cwd: config.cwd });
}
