// Fixed actor/socket failure fixtures, not a general scenario language.
import { writeFileSync } from "node:fs";
import { JsonLines } from "../../abstractions/modules/agents/shield/client/protocol";
const mode = process.argv[2];
const pidFile = process.env.FIXTURE_PID;
if (pidFile) writeFileSync(pidFile, String(process.pid));
process.on("SIGTERM", () => { if (!["ignore-term", "invalid-ignore"].includes(mode!)) process.exit(143); });
const send = (r: any) => process.stdout.write(JSON.stringify(r) + "\r\n");
const model = { provider: "fixture", id: "fixed" };
let active = false;
let dialogResolve: (() => void) | undefined;
const response = (r: any, data?: unknown) => send({ type: "response", id: r.id, command: r.type, success: true, data });
const emitText = async (body: string) => {
  active = true;
  send({ type: "agent_start" });
  send({ type: "message_start", message: { role: "user", content: "same", timestamp: 0 } });
  send({ type: "message_end", message: { role: "user", content: "same", timestamp: 0 } });
  send({ type: "message_start", message: { role: "assistant", content: [], timestamp: 0 } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: body } });
  send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: body }], stopReason: "stop" } });
  send({ type: "agent_end", messages: [] });
  await Bun.sleep(100);
  send({ type: "agent_settled", aborted: false });
  active = false;
};
async function command(r: any) {
  switch (r.type) {
    case "get_entries": response(r, { entries: [], leafId: null }); break;
    case "get_available_models": response(r, { models: [model] }); break;
    case "get_state": response(r, { model, isStreaming: active, isCompacting: false, pendingMessageCount: 0, thinkingLevel: "off", sessionId: "fixture" }); break;
    case "get_messages": response(r, { messages: [] }); break;
    case "prompt":
      if (mode === "invalid-ignore") { process.stdout.write("{broken\n"); break; }
      if (r.message === "exit") process.exit(17);
      if (r.message === "preflight") {
        send({ type: "extension_ui_request", id: "preflight-dialog", method: "input", title: "Preflight" });
        await new Promise<void>(resolve => { dialogResolve = resolve; });
        await Bun.sleep(200);
        response(r, { disposition: "started" });
        await emitText("preflight resolved");
      } else if (r.message === "flood") {
        response(r, { disposition: "handled" });
        for (let i = 0; i < 256; i++) send({ type: "extension_ui_request", id: `notice-${i}`, method: "notify", message: "f".repeat(128 * 1024) });
      } else if (r.message === "stall") {
        response(r, { disposition: "handled" });
        await new Promise(() => {});
      } else { response(r, { disposition: "started" }); await emitText(r.message === "large" ? "x".repeat(20 * 1024 * 1024) : "同じ\u2028文\u2029"); }
      break;
    case "extension_ui_response": dialogResolve?.(); dialogResolve = undefined; break;
    case "clear_queue": response(r, { steering: [], followUp: [] }); break;
    case "abort": active = false; send({ type: "agent_settled", aborted: true }); response(r); break;
    default: response(r);
  }
}
if (mode === "startup-hang") await new Promise(() => {});
const decoder = new JsonLines();
for await (const bytes of Bun.stdin.stream()) {
  const records = decoder.feed(bytes);
  for (const record of records) {
    const r = record as any;
    // Pi dispatches concurrently, including async preflight.
    if (r.type === "prompt" && r.message === "stall") { await command(r); }
    else void command(r);
  }
}
process.exit(0);
