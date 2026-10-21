// Fixed actor/socket failure fixtures speaking the keel driver's side of the keel contract,
// not a general scenario language. It declares `fake.*` actions and then reports itself
// ready. Actions: `emit` adds a notice entry with its argument as text; `large` adds one of
// 20 MiB; `flood` changes one entry of 128 KiB 256 times, one record each; `mixed` writes one valid
// record and one invalid record together; `invalid` writes a broken frame; `stall` stops
// reading stdin; `exit` exits 17; any other answers with the connection the model named.
import { writeFileSync } from "node:fs";
import { JsonLines } from "../../client/protocol";
const mode = process.argv[2];
const pidFile = process.env.FIXTURE_PID;
if (pidFile) writeFileSync(pidFile, String(process.pid));
process.on("SIGTERM", () => {
  if (!["ignore-term", "invalid-ignore"].includes(mode!)) process.exit(143);
});
const send = (r: unknown) => process.stdout.write(JSON.stringify(r) + "\r\n");
let next = 0;
const entry = (text: string, id = `notice-${next++}`) => ({
  type: "entries",
  entries: [{ kind: "notice", id, version: 0, level: "info", text }],
});
const result = (id: string, value: unknown) => send({ type: "result", id, result: value });
let stalled = false;
async function handle(r: any) {
  if (r.type !== "run_action") return;
  const action = r.action.slice("fake.".length);
  if (mode === "invalid-ignore" || action === "invalid")
    return void process.stdout.write("{broken\n");
  switch (action) {
    case "exit":
      process.exit(17);
    case "large":
      send(entry("x".repeat(20 * 1024 * 1024)));
      break;
    case "flood":
      // One entry changed each time, so the state stays small while the events add up.
      for (let i = 0; i < 256; i++) send(entry(`${i} ${"f".repeat(128 * 1024)}`, "flood"));
      break;
    case "mixed":
      process.stdout.write(
        JSON.stringify(entry("valid")) + "\n" + JSON.stringify({ type: "nonsense" }) + "\n",
      );
      return;
    case "stall":
      stalled = true;
      result(r.id, { outcome: "done" });
      await new Promise(() => {});
      return;
    case "emit":
      send(entry(String(r.args ?? "emitted")));
      break;
  }
  result(r.id, { outcome: "done", detail: r.connection });
}
if (mode === "startup-hang") await new Promise(() => {});
const actions = ["same", "look", "emit", "large", "flood", "mixed", "invalid", "stall", "exit"];
send({
  type: "operation",
  id: "declare",
  operation: {
    op: "declare_actions",
    actions: [
      { id: "fake.write", runs: "driver" },
      ...actions.map((name) => ({ id: `fake.${name}`, class: "control", runs: "driver" })),
    ],
  },
});
send({
  type: "ready",
  session: { id: `fake-${process.pid}`, cwd: process.cwd(), model: null, thinking: null },
});
const decoder = new JsonLines();
for await (const bytes of Bun.stdin.stream()) {
  for (const record of decoder.feed(bytes)) {
    if (stalled) await new Promise(() => {});
    await handle(record);
  }
}
process.exit(0);
