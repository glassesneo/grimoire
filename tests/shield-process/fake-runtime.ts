// Fixed actor/socket failure fixtures speaking the keel runtime's wire, not a general scenario
// language. Actions: `emit` publishes an event; `large` grows the state by 20 MiB; `flood`
// publishes 256 events of 128 KiB; `mixed` writes one valid event and one invalid record
// together; `invalid` writes a broken frame; `stall` stops reading stdin; `exit` exits 17.
import { writeFileSync } from "node:fs";
import { JsonLines } from "../../abstractions/modules/agents/shield/client/protocol";
const mode = process.argv[2];
const pidFile = process.env.FIXTURE_PID;
if (pidFile) writeFileSync(pidFile, String(process.pid));
process.on("SIGTERM", () => {
  if (!["ignore-term", "invalid-ignore"].includes(mode!)) process.exit(143);
});
const send = (r: unknown) => process.stdout.write(JSON.stringify(r) + "\r\n");
const instance = `fake-${process.pid}`;
let seq = 0;
const texts: string[] = [];
let writer: string | null = null;
const event = (text: string) => {
  texts.push(text);
  send({ type: "event", event: { runtimeInstance: instance, seq: ++seq, changes: { texts } } });
};
const result = (id: string, value: unknown) => send({ type: "result", id, result: value });
let stalled = false;
async function handle(r: any) {
  if (r.type === "writer") {
    writer = r.connection;
    return;
  }
  if (r.type === "snapshot_request") {
    send({
      type: "snapshot",
      id: r.id,
      snapshot: { runtimeInstance: instance, seq, state: { texts } },
    });
    return;
  }
  if (r.type !== "invoke") return;
  const action = r.invoke.action;
  if (action === "write" && r.connection !== writer)
    return result(r.id, { outcome: "rejected", code: "not_writer" });
  if (mode === "invalid-ignore" || action === "invalid")
    return void process.stdout.write("{broken\n");
  switch (action) {
    case "exit":
      process.exit(17);
    case "large":
      event("x".repeat(20 * 1024 * 1024));
      break;
    case "flood":
      // Each event replaces one section, so the flood is 32 MiB in all.
      for (let i = 0; i < 256; i++)
        send({
          type: "event",
          event: {
            runtimeInstance: instance,
            seq: ++seq,
            changes: { flood: "f".repeat(128 * 1024) },
          },
        });
      break;
    case "mixed":
      process.stdout.write(
        JSON.stringify({
          type: "event",
          event: { runtimeInstance: instance, seq: ++seq, changes: {} },
        }) +
          "\n" +
          JSON.stringify({ type: "nonsense" }) +
          "\n",
      );
      return;
    case "stall":
      stalled = true;
      result(r.id, { outcome: "done" });
      await new Promise(() => {});
      return;
    default:
      event(String(r.invoke.args ?? action));
  }
  result(r.id, { outcome: "done", appliedSeq: seq, detail: r.connection });
}
if (mode === "startup-hang") await new Promise(() => {});
send({ type: "ready", runtimeInstance: instance });
const decoder = new JsonLines();
for await (const bytes of Bun.stdin.stream()) {
  for (const record of decoder.feed(bytes)) {
    if (stalled) await new Promise(() => {});
    await handle(record);
  }
}
process.exit(0);
