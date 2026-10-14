import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { realpathSync } from "node:fs";
import { HubClient } from "../client/protocol";
import { socketPath } from "../client/paths";
import { options } from "./launch";
import { Controller } from "./controller";
import { Screen } from "./screen";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version")) { console.log("quin 0.1.0 (Pi 1.1.0)"); return; }
  if (args.includes("--help")) { console.log(`quin [--mock] [--model provider/id] [--socket /absolute/hub.sock]\nStart SHIELD separately: shield start. Ctrl+Q detaches; Ctrl+C twice interrupts.\nLive model default for a new agent: $XDG_CONFIG_HOME/shield/pi/settings.json (defaultProvider/defaultModel), then ${process.env.SHIELD_DEFAULT_MODEL || "none"}.`); return; }
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
  controller.onDetach = () => renderer.destroy();
  renderer.on("destroy", () => { controller.detach(); });
  render(() => <Screen controller={controller} />, renderer);
  try {
    const cwd = realpathSync(process.cwd());
    const r = await client.hub("attach", { cwd, harness: "quin", options: options(mock, model, cwd) });
    if (!r.success) throw new Error(r.error?.code === "model_required" ? "Model required: use --model provider/id or shield/pi/settings.json defaultProvider/defaultModel." : `${r.error?.code}; mode mismatch: use another cwd or --socket`);
  } catch (e: any) { controller.status = `Startup failed: ${e.message}`; controller.adapter.lifecycle = "failed"; controller.changed(); }
}
main().catch(e => { console.error(`quin: ${e.message}`); process.exitCode = 1; });
