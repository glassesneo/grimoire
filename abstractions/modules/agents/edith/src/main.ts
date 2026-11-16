// Starts EDITH from the JSON configuration named by EDITH_CONFIG.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edith, type Options } from "./core.ts";
import { FileCredentialStore } from "./credentials.ts";
import { Discord } from "./discord.ts";
import { listen } from "./socket.ts";

type Config = {
  readonly storage: string;
  readonly socket: string;
  // Files holding provider API keys, by the environment variable pi-ai reads each from.
  readonly providerKeys: Readonly<Record<string, string>>;
  // Stored credentials, such as an OAuth login, by provider id; absent until one is placed there.
  readonly credentials: string;
  readonly profiles: Options["profiles"];
  readonly discord: { readonly tokenFile: string; readonly allowedUsers: readonly string[] } | null;
};

const configPath = process.env["EDITH_CONFIG"];
if (!configPath) throw new Error("EDITH_CONFIG is not set");
const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
const secret = (path: string) => readFileSync(path, "utf8").trim();

for (const [variable, path] of Object.entries(config.providerKeys))
  process.env[variable] = secret(path);

const context = BACKGROUND_CONTEXT;
for (const path of [config.storage, config.socket])
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

const edith = await Edith.open(
  await openNodeSqliteStorage(config.storage),
  {
    models: builtinModels({ credentials: new FileCredentialStore(config.credentials) }),
    profiles: config.profiles,
    onReport: (report) => console.error(`report: ${report.kind}`, report.error),
  },
  context,
);

const server = listen(edith, config.socket, context);
console.error(`listening on ${config.socket}`);

const discord =
  config.discord &&
  new Discord(
    edith,
    { token: secret(config.discord.tokenFile), allowedUsers: config.discord.allowedUsers },
    context,
  );
await discord?.connect();

async function shutdown(): Promise<void> {
  server.close();
  await discord?.destroy();
  await edith.close(context);
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
