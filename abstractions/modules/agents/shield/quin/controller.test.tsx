// User-visible key/focus contracts cannot be checked by TypeScript or package builds.
import { test, expect } from "bun:test";
import { testRender } from "@opentui/solid";
import type { HubClient, Envelope } from "../client/protocol";
import { Controller } from "./controller";
import { emptyView } from "./view";
import { Screen } from "./screen";

const STATS = { tokens: { input: 12_345, output: 678, cacheRead: 2000, cacheWrite: 0 }, cost: 0.0421, contextUsage: { tokens: 50_000, contextWindow: 200_000, percent: 25 } };
function fixture() {
  const requests: any[] = [];
  let closes = 0;
  let statsReads = 0;
  // Statusline reads are counted apart, so the operation lists below stay exact.
  const client = { onRecord: () => {}, onDisconnect: () => {}, close: () => closes++, engine: async (_: string, payload: any) => {
    if (payload.record?.type === "get_session_stats") { statsReads++; return { success: true, payload: { data: STATS } }; }
    requests.push(payload); return { success: true };
  } } as unknown as HubClient;
  const c = new Controller(client);
  const snapshot = { v: 1, type: "snapshot", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 0, payload: { view: emptyView(), lifecycle: "ready", mode: "mock" } } as Envelope;
  c.record(snapshot);
  const key = (name: string, ctrl = false, now = 1000) => c.key({ name, ctrl, preventDefault() {} }, now);
  return { c, key, requests, closes: () => closes, statsReads: () => statsReads };
}
test("Ctrl+C is timed twice, idle clears input, and another operation disarms", () => {
  const f = fixture(); f.c.setText("draft"); f.key("c", true); expect(f.c.text).toBe(""); expect(f.closes()).toBe(0);
  f.c.adapter.view.run.active = true;
  f.key("c", true); expect(f.requests).toEqual([]); expect(f.c.armedUntil).toBe(2000);
  f.key("x", false, 1200); expect(f.c.armedUntil).toBe(0);
  f.key("c", true, 1300); f.c.tick(2400); expect(f.c.armedUntil).toBe(0);
  f.key("c", true, 2500); f.key("c", true, 2600); expect(f.requests).toEqual([{ op: "interrupt" }]);
  f.c.record({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 1, payload: { op: "event", record: { type: "agent_settled" }, observedAt: 3000 } });
  expect(f.c.armedUntil).toBe(0);
});
test("dialog closes restore focus; Esc is local cancellation and detach never replies", async () => {
  const f = fixture(); f.c.focus = "timeline";
  f.c.record({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 1, payload: { op: "event", record: { type: "extension_ui_request", id: "d", method: "input", title: "Input" }, observedAt: 1000 } });
  expect(String(f.c.focus)).toBe("editor"); f.c.setText("answer"); f.key("escape");
  expect(f.requests).toEqual([{ op: "dialog_reply", id: "d", cancelled: true }]);
  f.c.record({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 2, payload: { op: "event", record: { type: "dialog_closed", id: "d" }, observedAt: 1000 } });
  expect(f.c.focus).toBe("timeline");
  for (const region of ["editor", "timeline", "stage"] as const) {
    const g = fixture(); g.c.focus = region; g.c.dialogId = "d"; g.key("q", true);
    expect(g.closes()).toBe(1); expect(g.requests).toEqual([]);
  }
});
test("a preflight dialog can reply while its parent prompt response remains pending", async () => {
  const requests: any[] = [];
  let resolvePrompt!: (value: any) => void;
  const prompt = new Promise(resolve => { resolvePrompt = resolve; });
  const client = {
    onRecord: () => {}, onDisconnect: () => {}, close: () => {},
    engine: async (_agent: string, payload: any) => {
      if (payload.record?.type === "get_session_stats") return { success: true };
      requests.push(payload);
      if (payload.op === "rpc") return prompt;
      return { success: true };
    },
  } as unknown as HubClient;
  const c = new Controller(client);
  c.record({ v: 1, type: "snapshot", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 0, payload: { view: emptyView(), lifecycle: "ready", mode: "mock" } } as Envelope);
  c.setText("prompt");
  const pending = c.submit();
  await Bun.sleep(0);
  expect(c.promptSending).toBe(true);
  c.record({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 1, payload: { op: "event", record: { type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?" }, observedAt: 1000 } });
  await c.submit();
  expect(requests).toEqual([
    { op: "rpc", record: { type: "prompt", message: "prompt" } },
    { op: "dialog_reply", id: "d", confirmed: true },
  ]);
  resolvePrompt({ success: true });
  await pending;
  expect(c.promptSending).toBe(false);
});
test("native text plus Enter in one input batch submits the complete buffer", async () => {
  const f = fixture();
  const setup = await testRender(() => <Screen controller={f.c} />, { width: 80, height: 24 });
  try {
    await setup.flush();
    setup.renderer.stdin.emit("data", Buffer.from("hello\r"));
    await setup.flush();
    expect(f.requests[0]).toEqual({ op: "rpc", record: { type: "prompt", message: "hello" } });
    expect(f.c.text).toBe("");
  } finally { setup.renderer.destroy(); }
});
test("renderer shows mock, run, tool state, queue, dialog, and interrupt confirmation", async () => {
  const f = fixture();
  f.c.adapter.view.timeline.entries = [{ id: "tool", kind: "tool", version: 0, name: "fixture", state: "running", args: { available: false } }];
  f.c.adapter.view.queue.followUp = ["queued input"];
  f.c.adapter.view.run.active = true;
  const setup = await testRender(() => <Screen controller={f.c} />, { width: 80, height: 24 });
  try {
    await setup.flush(); const first = setup.captureCharFrame();
    expect(first).toContain("MOCK"); expect(first).toContain("fixture [running]"); expect(first).toContain("queued input"); expect(first).toContain("Working");
    f.key("c", true, Date.now()); await setup.flush(); expect(setup.captureCharFrame()).toContain("Ctrl+C");
    f.c.record({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 1, payload: { op: "event", record: { type: "extension_ui_request", id: "d", method: "confirm", title: "Continue?", message: "A confirmation" }, observedAt: Date.now() } });
    await setup.flush(); expect(setup.captureCharFrame()).toContain("Continue?"); expect(f.c.focus).toBe("stage");
  } finally { setup.renderer.destroy(); }
  expect(f.requests).toEqual([]);
});
test("scroll chords belong to the timeline; the editor keeps them", () => {
  const f = fixture(); const scrolls: string[] = []; f.c.scroll = amount => scrolls.push(amount);
  const press = (name: string) => { let prevented = false; f.c.key({ name, ctrl: true, preventDefault() { prevented = true; } }); return prevented; };
  for (const name of ["f", "b", "d", "u"]) expect(press(name)).toBe(false);
  expect(scrolls).toEqual([]);
  f.c.focus = "timeline";
  for (const name of ["f", "b", "d", "u"]) expect(press(name)).toBe(true);
  expect(scrolls).toEqual(["page-down", "page-up", "half-down", "half-up"]);
});
test("keypad Enter submits like Enter", async () => {
  const f = fixture(); f.c.setText("from keypad"); f.key("kpenter"); await Bun.sleep(0);
  expect(f.requests).toEqual([{ op: "rpc", record: { type: "prompt", message: "from keypad" } }]);
});
test("statusline shows context and totals, refreshed when a message ends", async () => {
  const f = fixture(); await Bun.sleep(0);
  expect(f.statsReads()).toBe(1);
  f.c.record({ v: 1, type: "event", "agent-id": "a", engine: "pi", "hub-instance": "h", seq: 1, payload: { op: "event", record: { type: "message_end", message: { role: "user", content: "hi" } }, observedAt: 1000 } });
  await Bun.sleep(0);
  expect(f.statsReads()).toBe(2);
  const setup = await testRender(() => <Screen controller={f.c} />, { width: 120, height: 24 });
  try {
    await setup.flush(); const frame = setup.captureCharFrame();
    expect(frame).toContain("ctx 25% of 200k"); expect(frame).toContain("↑12k ↓678 R2.0k $0.042");
    expect(frame).not.toContain("[editor]");
  } finally { setup.renderer.destroy(); }
});
