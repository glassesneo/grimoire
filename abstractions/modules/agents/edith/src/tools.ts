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
  readonly user: string;
  readonly cwd: string;
  readonly identityFile: string;
  readonly knownHostsFile: string;
  readonly hostKeyFile: string;
};

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
