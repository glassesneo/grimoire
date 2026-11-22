// Opens EDITH from the JSON configuration named by EDITH_CONFIG, with what every way of running it
// shares: provider keys, MCP servers, code mode and the tools' environment. The resident service
// (`main.ts`) and `edith dev` differ in their storage, their credentials file and their clients.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edith, type Options } from "./core.ts";
import { FileCredentialStore } from "./credentials.ts";
import { connectServer, type Server, type ServerConfig } from "./mcp.ts";
import { type ToolEnvironmentConfig, toolEnvironment, toolsExtension } from "./tools.ts";

export type Config = {
  // The resident service's storage, credentials and socket.
  readonly storage: string;
  readonly socket: string;
  // Stored credentials, such as an OAuth login, by provider id; absent until one is placed there.
  readonly credentials: string;
  // `edith dev`'s directory: its credentials file and its named sessions.
  readonly devDirectory: string;
  // Files holding provider API keys, by the environment variable pi-ai reads each from.
  readonly providerKeys: Readonly<Record<string, string>>;
  readonly profiles: Options["profiles"];
  readonly namespaces: Options["namespaces"];
  // The MCP servers some profile names, by name.
  readonly mcpServers: Readonly<Record<string, ServerConfig>>;
  readonly discord: { readonly tokenFile: string; readonly allowedUsers: readonly string[] } | null;
  // Where the tools run; without it, no profile selects any.
  readonly toolEnvironment: ToolEnvironmentConfig | null;
};

export const secret = (path: string): string => readFileSync(path, "utf8").trim();

export function readConfig(): Config {
  const path = process.env["EDITH_CONFIG"];
  if (!path) throw new Error("EDITH_CONFIG is not set");
  return JSON.parse(readFileSync(path, "utf8")) as Config;
}

export type Started = {
  readonly edith: Edith;
  close(): Promise<void>;
};

export async function start(
  config: Config,
  paths: { readonly storage: string; readonly credentials: string },
  context: Context,
): Promise<Started> {
  for (const [variable, path] of Object.entries(config.providerKeys))
    process.env[variable] = secret(path);
  for (const path of [
    paths.storage,
    paths.credentials,
    config.toolEnvironment?.knownHostsFile ?? [],
  ].flat())
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  // A server that fails to start is left out, so its profiles run without its tools.
  const servers = (
    await Promise.allSettled(
      Object.entries(config.mcpServers).map(([name, server]) =>
        connectServer(name, server).catch((error: unknown) => {
          console.error(`mcp ${name}: not started`, error);
          throw error;
        }),
      ),
    )
  ).flatMap((started): Server[] => (started.status === "fulfilled" ? [started.value] : []));

  const sandbox = new CodemodeSandbox();
  const codemode = createCodemodeExtension({
    sandbox,
    // Scripts get no paid model calls of their own.
    models: false,
  });
  const env = config.toolEnvironment && toolEnvironment(config.toolEnvironment);

  const edith = await Edith.open(
    await openNodeSqliteStorage(paths.storage),
    {
      models: builtinModels({ credentials: new FileCredentialStore(paths.credentials) }),
      profiles: config.profiles,
      namespaces: config.namespaces,
      codemode,
      servers: servers.map((server) => server.extension),
      ...(env && { tools: toolsExtension, env: () => env }),
      onReport: (report) => console.error(`report: ${report.kind}`, report.error),
    },
    context,
  );

  return {
    edith,
    async close() {
      await edith.close(context);
      await sandbox.close();
      await Promise.allSettled(servers.map((server) => server.close()));
    },
  };
}
