import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Discord } from "./discord.ts";
import { listen } from "./socket.ts";
import { readConfig, secret, start } from "./start.ts";

const config = readConfig();
const context = BACKGROUND_CONTEXT;
const started = await start(
  config,
  { storage: config.storage, credentials: config.credentials },
  context,
);
const { edith } = started;

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
  await started.close();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
