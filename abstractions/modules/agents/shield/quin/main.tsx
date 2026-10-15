import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { HubClient } from "../client/protocol";
import { socketPath } from "../client/paths";
import { options } from "./launch";
import { Controller } from "./controller";
import { Screen, setupScreen } from "./screen";
import { checkKeymap } from "./contributions/default";
import type { Keymap } from "./ui/keys";

/** The keymap the package wrapper names; see ui/keys.ts. */
function keymap(): Keymap | undefined {
  const path = process.env.SHIELD_KEYMAP;
  if (!path) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      version: { type: "boolean" },
      help: { type: "boolean" },
      "check-keymap": { type: "boolean" },
      mock: { type: "boolean", default: false },
      model: { type: "string" },
      socket: { type: "string" },
    },
  });
  if (args.version) {
    console.log(`quin 0.1.0 (Pi ${process.env.SHIELD_PI_VERSION ?? "unknown"})`);
    return;
  }
  // The package build runs this, so a configured keymap quin rejects fails the build.
  if (args["check-keymap"]) {
    checkKeymap(keymap());
    return;
  }
  if (args.help) {
    console.log(
      `quin [--mock] [--model provider/id] [--socket /absolute/hub.sock]\nAttaches to the agent of this directory, creating it if needed; start SHIELD first with shield start.\nBy default Ctrl+Q detaches and Ctrl+C twice interrupts (shield.keys rebinds them).\nPi runs with codemode only: the model writes scripts that call the other tools.\nA new agent's model: --model, then $XDG_CONFIG_HOME/shield/pi/settings.json (defaultProvider/defaultModel), then ${process.env.SHIELD_DEFAULT_MODEL || "none"}.\n--model only chooses a new agent's model; open the command palette (: in the timeline, Ctrl+G in the editor) for /model, /thinking, or /compact. Pi reads credentials such as a ChatGPT login from $XDG_CONFIG_HOME/shield/pi/auth.json.\n--mock uses an isolated agent with a fixed provider; try /fixture-tool, /fixture-codemode, /fixture-dialog, or /fixture-timeout.`,
    );
    return;
  }
  const { model, socket, mock } = args;
  const keys = keymap();
  checkKeymap(keys);
  const client = new HubClient(socketPath(socket), "pi");
  try {
    await client.connected;
  } catch (e: any) {
    client.close();
    throw new Error(
      `Cannot connect to SHIELD (${e.code}); run shield start with the same --socket.`,
    );
  }
  const controller = new Controller(client);
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  let screen;
  try {
    screen = setupScreen(controller, { keymap: keys, renderer });
  } catch (e) {
    renderer.destroy();
    client.close();
    throw e;
  }
  controller.onDetach = () => renderer.destroy();
  renderer.on("destroy", () => {
    controller.detach();
  });
  render(
    () => <Screen screen={screen} onTitle={(title) => renderer.setTerminalTitle(title)} />,
    renderer,
  );
  try {
    const cwd = realpathSync(process.cwd());
    const r = await client.hub("attach", {
      cwd,
      harness: "quin",
      options: options(mock, model, cwd),
    });
    if (!r.success) throw new Error(attachFailure(r.error?.code, mock));
  } catch (e: any) {
    controller.adapter.lifecycle = "failed";
    controller.fail(`Startup failed: ${e.message}; detach and run quin again`);
  }
}

/** What a refused attach means for the user. */
function attachFailure(code: string | undefined, mock: boolean): string {
  switch (code) {
    case "model_required":
      return "Model required: use --model provider/id or shield/pi/settings.json defaultProvider/defaultModel.";
    case "mode_mismatch":
      return `this directory's agent is ${mock ? "live" : "mock"}; use another cwd or --socket`;
    case "harness_engine_mismatch":
      return "this directory's agent belongs to another harness or engine; use another cwd or --socket";
    case "hub_stopping":
      return "SHIELD is shutting down; start it again";
    case undefined:
      return "the hub refused the attach without a reason";
    default:
      return code;
  }
}
main().catch((e) => {
  console.error(`quin: ${e.message}`);
  process.exitCode = 1;
});
