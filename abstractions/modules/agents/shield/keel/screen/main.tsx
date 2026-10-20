/** The keel screen: attaches to this directory's agent through the SHIELD hub. */
import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { HubClient } from "../../client/protocol";
import { configDirectory, socketPath } from "../../client/paths";
import { Connection } from "./connection";
import { launchOptions } from "./launch";
import { Screen, setupScreen } from "./screen";

const HELP = `keel [--config-dir DIR] [--socket /absolute/hub.sock]
Attaches to the keel agent of this directory, starting one if there is none; start SHIELD first with shield start.
The first screen to attach writes; later screens view until they take the write. Closing the screen leaves the agent running.
The configuration directory (default $XDG_CONFIG_HOME/keel) holds Pi's settings.json, models.json and auth.json,
and keel's extensions.json ({"extensions": [...]}: bundled names such as commands, model, timeline, markdown,
tools, codemode, queue, commandcode; any other entry, such as mine.ts, is a file path) and keybindings.json
(action id to a key or a list of keys).
Global actions have no default keys; region actions do, such as Ctrl+C twice to stop and Ctrl+Q to close.`;

async function main() {
  const { values } = parseArgs({
    options: {
      version: { type: "boolean" },
      help: { type: "boolean" },
      socket: { type: "string" },
      "config-dir": { type: "string" },
    },
  });
  if (values.version) {
    console.log(`keel 0.1.0 (Pi ${process.env.KEEL_PI_VERSION ?? "unknown"})`);
    return;
  }
  if (values.help) {
    console.log(HELP);
    return;
  }
  const cwd = realpathSync(process.cwd());
  const configDir = resolve(values["config-dir"] ?? configDirectory());
  const options = launchOptions(cwd, configDir);
  const client = new HubClient(socketPath(values.socket), "keel");
  try {
    await client.connected;
  } catch (error: any) {
    client.close();
    throw new Error(
      `Cannot connect to SHIELD (${error.code}); run shield start with the same --socket.`,
    );
  }
  const connection = new Connection(client);
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const screen = setupScreen(connection, { renderer });
  connection.onDetach = () => renderer.destroy();
  renderer.on("destroy", () => connection.detach());
  await render(() => <Screen screen={screen} cwd={cwd} />, renderer);
  try {
    await connection.attach({
      cwd,
      harness: "keel",
      selection: { kind: "cwd", key: randomUUID() },
      options,
    });
  } catch (error) {
    // Nothing on the screen can be used without the agent: close it and say why.
    connection.detach();
    throw new Error(`attach failed: ${(error as Error).message}`);
  }
}

main().catch((error) => {
  console.error(`keel: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
