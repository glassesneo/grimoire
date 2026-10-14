import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { readFileSync, realpathSync } from "node:fs";
import { HubClient } from "../client/protocol";
import { socketPath } from "../client/paths";
import { options } from "./launch";
import { Controller } from "./controller";
import { Screen, setupScreen } from "./screen";
import type { Keymap } from "./ui/keys";

/** The keymap the package wrapper names; see ui/keys.ts. */
function keymap(): Keymap | undefined {
  const path = process.env.SHIELD_KEYMAP;
  if (!path) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`keymap ${path} must be an object of action ids`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) { console.log("quin 0.1.0 (Pi 1.1.0)"); return; }
  if (args.includes("--help")) { console.log(`quin [--mock] [--model provider/id] [--socket /absolute/hub.sock]\nAttaches to the agent of this directory, creating it if needed; start SHIELD first with shield start.\nBy default Ctrl+Q detaches and Ctrl+C twice interrupts (shield.keys rebinds them).\nPi runs with codemode only: the model writes scripts that call the other tools.\nA new agent's model: --model, then $XDG_CONFIG_HOME/shield/pi/settings.json (defaultProvider/defaultModel), then ${process.env.SHIELD_DEFAULT_MODEL || "none"}.\nAn explicit --model or --mock must match an existing agent. Pi reads credentials such as a ChatGPT login from $XDG_CONFIG_HOME/shield/pi/auth.json.\n--mock uses an isolated agent with a fixed provider; try /fixture-tool, /fixture-codemode, /fixture-dialog, or /fixture-timeout.`); return; }
  let model: string | undefined, socket: string | undefined, mock = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mock") mock = true;
    else if (["--model", "--socket"].includes(args[i]!)) {
      const value = args[++i]; if (!value) throw new Error(`missing ${args[i - 1]} value`);
      if (args[i - 1] === "--model") model = value; else socket = value;
    } else throw new Error(`unknown option: ${args[i]}`);
  }
  const client = new HubClient(socketPath(socket));
  try { await client.connected; } catch (e: any) { client.close(); throw new Error(`Cannot connect to SHIELD (${e.code}); run shield start with the same --socket.`); }
  const controller = new Controller(client);
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  let screen;
  try { screen = setupScreen(controller, { keymap: keymap(), renderer }); }
  catch (e) { renderer.destroy(); client.close(); throw e; }
  controller.onDetach = () => renderer.destroy();
  renderer.on("destroy", () => { controller.detach(); });
  render(() => <Screen screen={screen} onTitle={title => renderer.setTerminalTitle(title)} />, renderer);
  try {
    const cwd = realpathSync(process.cwd());
    const r = await client.hub("attach", { cwd, harness: "quin", options: options(mock, model, cwd) });
    if (!r.success) throw new Error(r.error?.code === "model_required" ? "Model required: use --model provider/id or shield/pi/settings.json defaultProvider/defaultModel." : `${r.error?.code}; mode mismatch: use another cwd or --socket`);
  } catch (e: any) { controller.adapter.lifecycle = "failed"; controller.fail(`Startup failed: ${e.message}`); }
}
main().catch(e => { console.error(`quin: ${e.message}`); process.exitCode = 1; });
