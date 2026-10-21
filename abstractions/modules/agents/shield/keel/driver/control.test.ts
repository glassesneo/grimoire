// Pausing, stopping, and the queue operations against Pi 1.1.0's real run
// loop (the P0 compatibility checks): each case holds or drives a run at a
// chosen point with the faux provider and checks what Pi did.
import { afterEach, expect, test } from "bun:test";
import { type FauxResponseStep, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { keel } from "../api";
import { call, type Harness, harness, prompts, responded, tools } from "./test-support";

let current: Harness | undefined;
afterEach(async () => {
  await current?.dispose();
  current = undefined;
});
const start = async (options: Parameters<typeof harness>[0]) => (current = await harness(options));
const phase = (h: Harness) => h.run().phase;
/** Whether the tool call `name` ended in one of `states`. */
const ended = (h: Harness, name: string, states: string[]) =>
  tools(h, name).some((tool) => states.includes(tool.state));
const send = (h: Harness, text: string) => h.submit(text);
const sleep = Bun.sleep;

/** The model's requests, by the last user or tool text each one ends with. */
function recording(steps: FauxResponseStep[], seen: string[]): FauxResponseStep[] {
  return steps.map((step) => (context) => {
    const last = context.messages.at(-1) as any;
    const text =
      typeof last?.content === "string"
        ? last.content
        : (last?.content ?? []).map((b: any) => b.text ?? "").join("");
    seen.push(`${last?.role}:${text}`);
    return typeof step === "function"
      ? step(
          context,
          undefined,
          { callCount: 0, deferredFetchCount: 0, cancelledDeferred: [] },
          undefined as never,
        )
      : step;
  });
}

test("a pause asked for while a tool runs lets it finish and holds the run before the next request", async () => {
  const seen: string[] = [];
  const h = await start({
    responses: recording([call("wait", "w1"), fauxAssistantMessage("after")], seen),
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  expect(await h.action("global.pause")).toMatchObject({ outcome: "done" });
  expect(phase(h)).toBe("pausing");
  h.release();
  await h.until(() => phase(h) === "paused");
  await sleep(50);
  // The tool finished and its result is in; the model was not asked again.
  expect(ended(h, "wait", ["done"])).toBe(true);
  expect(seen).toEqual(["user:go"]);
  expect(h.driver.session.isIdle).toBe(false);
  expect(await h.action("global.resume")).toMatchObject({ outcome: "done" });
  await h.until(() => phase(h) === "idle" && responded(h, "after"));
  expect(seen).toEqual(["user:go", "toolResult:waited w1"]);
});

test("a pause asked for while the model responds lets the response finish and holds before its tool starts", async () => {
  const h = await start({
    responses: [
      async () => {
        await sleep(100);
        return call("wait", "w1");
      },
      fauxAssistantMessage("after"),
    ],
  });
  await send(h, "go");
  await h.until(() => phase(h) === "running");
  await h.action("global.pause");
  await h.until(() => phase(h) === "paused");
  await sleep(50);
  expect(h.started).toEqual([]);
  // A sent prompt is queued as a follow-up and resumes the run.
  expect(await send(h, "more")).toEqual({ outcome: "submitted", disposition: "queued" });
  await h.until(() => h.started.length === 1);
  expect(phase(h)).toBe("running");
  h.release();
  await h.until(() => phase(h) === "idle");
});

test("a pause does not hold the calls a running tool makes", async () => {
  const nested: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "script",
      label: "Script",
      description: "Calls wait twice",
      parameters: Type.Object({}),
      async execute(_id, _args, _signal, _update, ctx) {
        await ctx.executeTool("wait", {});
        await ctx.executeTool("wait", {});
        return { content: [{ type: "text", text: "script done" }], details: {} };
      },
    });
  };
  const h = await start({
    bundled: { nested },
    extensions: ["nested"],
    responses: [call("script", "s1"), fauxAssistantMessage("after")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await h.action("global.pause");
  h.release();
  // The script's second call starts although a pause was asked for.
  await h.until(() => h.started.length === 2);
  h.release();
  await h.until(() => phase(h) === "paused");
  expect(tools(h, "script").some((tool) => tool.result?.text === "script done")).toBe(true);
  await h.action("global.resume");
  await h.until(() => phase(h) === "idle" && responded(h, "after"));
});

test("a pause asked for while a tool waits for an answer holds once the answered tool finishes", async () => {
  const answers: unknown[] = [];
  const asking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "ask",
      label: "Ask",
      description: "Asks the user",
      parameters: Type.Object({}),
      async execute(_id, _args, _signal, _update, ctx) {
        const answer = await keel(ctx).requests.choice({ title: "Pick", options: ["a", "b"] });
        answers.push(answer);
        return { content: [{ type: "text", text: JSON.stringify(answer) }], details: {} };
      },
    });
  };
  const h = await start({
    bundled: { asking },
    extensions: ["asking"],
    responses: [call("ask", "a1"), fauxAssistantMessage("after")],
  });
  await send(h, "go");
  await h.until(() => h.requests.size === 1);
  await h.action("global.pause");
  expect(phase(h)).toBe("pausing");
  const [request] = [...h.requests.values()];
  h.answer(request!.id, { status: "answered", value: "b", supplement: "because" });
  await h.until(() => answers.length === 1);
  expect(answers).toEqual([{ status: "answered", value: "b", supplement: "because" }]);
  // The request was not cancelled for the pause, and answering it did not cancel the pause.
  await h.until(() => phase(h) === "paused");
  await sleep(50);
  expect(responded(h, "after")).toBe(false);
  await h.action("global.resume");
  await h.until(() => phase(h) === "idle" && responded(h, "after"));
});

test("answering a request while the run is paused resumes it", async () => {
  const asking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_start", async (_event, ctx) => {
      const k = keel(ctx);
      await k.actions.register([
        {
          id: "test.ask",
          class: "control",
          run: () => void k.requests.confirm({ title: "Go on?" }),
        },
      ]);
    });
  };
  const h = await start({
    bundled: { asking },
    extensions: ["asking"],
    responses: [call("wait", "w1"), fauxAssistantMessage("after")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await h.action("global.pause");
  h.release();
  await h.until(() => phase(h) === "paused");
  await h.action("test.ask");
  await h.until(() => h.requests.size === 1);
  expect(phase(h)).toBe("paused");
  const [request] = [...h.requests.values()];
  h.answer(request!.id, { status: "answered", value: true, supplement: "" });
  await h.until(() => phase(h) === "idle" && responded(h, "after"));
});

test("a prompt sent while a pause is still pending keeps the pause", async () => {
  const h = await start({
    responses: [call("wait", "w1"), fauxAssistantMessage("after"), fauxAssistantMessage("more")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await h.action("global.pause");
  expect(await send(h, "more please")).toEqual({ outcome: "submitted", disposition: "queued" });
  expect(phase(h)).toBe("pausing");
  h.release();
  await h.until(() => phase(h) === "paused");
  expect(h.queue().followUp).toEqual(["more please"]);
  await h.action("global.resume");
  await h.until(() => phase(h) === "idle" && responded(h, "more"));
});

test("stop ends the run even while an extension command holds the input", async () => {
  const blocking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerCommand("wait-idle", { handler: async (_args, ctx) => ctx.waitForIdle() });
  };
  const h = await start({
    bundled: { blocking },
    extensions: ["blocking"],
    responses: [call("wait", "w1"), fauxAssistantMessage("never")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await h.action("global.pause");
  h.release();
  await h.until(() => phase(h) === "paused");
  // The command waits for a run that waits for a resume.
  void h.submit("/wait-idle");
  await sleep(50);
  await h.action("global.stop");
  await h.until(() => phase(h) === "idle" && h.driver.session.isIdle);
  expect(responded(h, "never")).toBe(false);
});

test("a sent prompt does not close or answer an open request", async () => {
  const asking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "ask",
      label: "Ask",
      description: "Asks the user",
      parameters: Type.Object({}),
      async execute(_id, _args, _signal, _update, ctx) {
        const answer = await keel(ctx).requests.confirm({ title: "Sure?" });
        return { content: [{ type: "text", text: JSON.stringify(answer) }], details: {} };
      },
    });
  };
  const h = await start({
    bundled: { asking },
    extensions: ["asking"],
    responses: [call("ask", "a1"), fauxAssistantMessage("after"), fauxAssistantMessage("followed")],
  });
  await send(h, "go");
  await h.until(() => h.requests.size === 1);
  expect(await send(h, "and then")).toEqual({ outcome: "submitted", disposition: "queued" });
  await sleep(50);
  // Sending asked the model to close nothing.
  expect(h.operations("cancel_request")).toEqual([]);
  expect(h.operations("cancel_requests")).toEqual([]);
  expect(h.requests.size).toBe(1);
  const [request] = [...h.requests.values()];
  h.answer(request!.id, { status: "answered", value: true, supplement: "" });
  await h.until(() => phase(h) === "idle" && responded(h, "followed"));
  expect(tools(h, "ask").some((tool) => tool.result?.text.includes('"value":true'))).toBe(true);
});

test("a pause holds an automatic retry before it asks the model again", async () => {
  const seen: string[] = [];
  const h = await start({
    settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 50 } },
    responses: recording(
      [
        fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "overloaded_error: Overloaded",
        }),
        fauxAssistantMessage("recovered"),
      ],
      seen,
    ),
  });
  await send(h, "go");
  await h.until(() => h.run().retrying);
  await h.action("global.pause");
  await h.until(() => phase(h) === "paused");
  await sleep(150);
  expect(seen).toEqual(["user:go"]);
  await h.action("global.resume");
  await h.until(() => phase(h) === "idle" && responded(h, "recovered"));
  expect(seen).toHaveLength(2);
});

test("a pause asked for during compaction between turns holds the next request", async () => {
  const seen: string[] = [];
  let compacting = false;
  const h = await start({
    model: { contextWindow: 4000, maxTokens: 100 },
    settings: { compaction: { enabled: true, reserveTokens: 3900, keepRecentTokens: 1 } },
    responses: recording(
      [
        call("wait", "w1"),
        async () => {
          compacting = true;
          await sleep(200);
          return fauxAssistantMessage("summary of the history");
        },
        fauxAssistantMessage("after"),
      ],
      seen,
    ),
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  h.release();
  await h.until(() => compacting);
  await h.action("global.pause");
  await h.until(() => phase(h) === "paused");
  await sleep(50);
  // The model was asked for the summary, and not yet for the next response.
  expect(seen).toHaveLength(2);
  expect(seen[1]).toContain("checkpoint");
  expect(
    h.entries().some((entry) => entry.kind === "compaction" && entry.state === "completed"),
  ).toBe(true);
  await h.action("global.resume");
  await h.until(() => phase(h) === "idle" && responded(h, "after"));
});

test("stop releases a paused run, clears the queue and requests, and keeps the driver", async () => {
  const asking: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("session_start", (_event, ctx) => {
      pi.registerCommand("ask-later", {
        handler: async () => {
          void keel(ctx).requests.choice({ title: "Later", options: ["x"] });
        },
      });
    });
  };
  const seen: string[] = [];
  const h = await start({
    bundled: { asking },
    extensions: ["asking"],
    responses: recording([call("wait", "w1"), fauxAssistantMessage("again")], seen),
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await send(h, "queued one");
  await send(h, "/ask-later");
  await h.until(() => h.queue().followUp.length === 1 && h.requests.size === 1);
  await h.action("global.pause");
  h.release();
  await h.until(() => phase(h) === "paused");
  expect(await h.action("global.stop", undefined, false)).toMatchObject({ outcome: "accepted" });
  await h.until(() => phase(h) === "idle" && h.driver.session.isIdle);
  expect(h.queue()).toEqual({ steering: [], followUp: [] });
  expect(h.requests.size).toBe(0);
  expect(seen).toEqual(["user:go"]);
  // The session still works.
  await send(h, "again");
  await h.until(() => phase(h) === "idle" && responded(h, "again"));
});

test("stop aborts a tool that is running", async () => {
  const h = await start({ responses: [call("wait", "w1"), fauxAssistantMessage("never")] });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await h.action("global.stop");
  await h.until(() => phase(h) === "idle" && h.driver.session.isIdle);
  expect(responded(h, "never")).toBe(false);
  expect(ended(h, "wait", ["error", "unfinished"])).toBe(true);
});

/** An extension that queues a custom message while the run continues. */
const queueing: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.registerCommand("note", {
    handler: async () => {
      pi.sendMessage(
        { customType: "note", content: "extension note", display: true },
        { deliverAs: "followUp" },
      );
    },
  });
};

test("taking every queued instruction into the prompt leaves extension messages queued", async () => {
  const seen: string[] = [];
  const h = await start({
    bundled: { queueing },
    extensions: ["queueing", "queue"],
    responses: recording(
      [call("wait", "w1"), fauxAssistantMessage("after"), fauxAssistantMessage("noted")],
      seen,
    ),
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await send(h, "first");
  await send(h, "/note");
  await send(h, "second");
  await h.until(() => h.queue().followUp.length === 2);
  expect(await h.action("editor.queue_edit_all")).toMatchObject({
    outcome: "done",
    detail: { taken: 2 },
  });
  // The prompt draft is replaced, not added to.
  expect(h.operations("set_draft")).toEqual([
    { op: "set_draft", destination: "prompt", text: "first\n\nsecond" },
  ]);
  expect(h.operations("append_draft")).toEqual([]);
  expect(h.queue()).toEqual({ steering: [], followUp: [] });
  h.release();
  await h.until(() => phase(h) === "idle" && responded(h, "noted"));
  // The instructions were not sent; the extension's message was.
  expect(seen.some((s) => s.includes("first"))).toBe(false);
  expect(
    h.entries().some((entry) => entry.kind === "custom" && entry.text === "extension note"),
  ).toBe(true);
});

test("sending every queued instruction again as steering delivers each once, before the next request", async () => {
  const seen: string[] = [];
  const h = await start({
    extensions: ["queue"],
    responses: recording(
      [call("wait", "w1"), fauxAssistantMessage("after"), fauxAssistantMessage("late")],
      seen,
    ),
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await send(h, "first");
  await send(h, "second");
  await h.until(() => h.queue().followUp.length === 2);
  expect(await h.action("editor.queue_steer_all")).toMatchObject({
    outcome: "done",
    detail: { resent: 2 },
  });
  expect(h.queue()).toEqual({ steering: ["first", "second"], followUp: [] });
  h.release();
  await h.until(() => phase(h) === "idle");
  // Steering reaches the model before its next request, one instruction a
  // request in Pi's default steering mode, each once.
  expect(seen).toEqual(["user:go", "user:first", "user:second"]);
  expect(prompts(h).filter((t) => t === "first" || t === "second")).toEqual(["first", "second"]);
});

test("sending again runs Pi's input handlers again, so a transformation applies twice", async () => {
  const transform: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.on("input", (event) => ({ action: "transform" as const, text: `T(${event.text})` }));
  };
  const h = await start({
    bundled: { transform },
    extensions: ["transform", "queue"],
    responses: [call("wait", "w1"), fauxAssistantMessage("after"), fauxAssistantMessage("late")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await send(h, "first");
  await h.until(() => h.queue().followUp.length === 1);
  expect(h.queue().followUp).toEqual(["T(first)"]);
  await h.action("editor.queue_steer_all");
  expect(h.queue().steering).toEqual(["T(T(first))"]);
  h.release();
  await h.until(() => phase(h) === "idle");
});

test("an instruction Pi refuses to take again is kept, its image included", async () => {
  const withImage: ExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerCommand("with-image", {
      handler: async () => {
        pi.sendUserMessage(
          [
            { type: "text", text: "pictured" },
            { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          ],
          { deliverAs: "followUp" },
        );
      },
    });
  };
  const h = await start({
    bundled: { "with-image": withImage },
    extensions: ["with-image", "queue"],
    responses: [call("wait", "w1"), fauxAssistantMessage("after"), fauxAssistantMessage("later")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await send(h, "first");
  await send(h, "plain");
  await send(h, "/with-image");
  await h.until(() => h.queue().followUp.length === 3);
  // Pi refuses the second instruction sent again, as it would a prompt it cannot take.
  const session = h.driver.session;
  const prompt = session.prompt.bind(session);
  session.prompt = (text, options) =>
    text === "plain" ? Promise.reject(new Error("refused")) : prompt(text, options);
  expect(await h.action("editor.queue_steer_all")).toMatchObject({ outcome: "rejected" });
  session.prompt = prompt;
  // The text instruction waits in the prompt draft; the pictured one waits to be delivered.
  // Added to the end of the prompt draft, never replacing what the screen typed.
  expect(h.operations("append_draft")).toEqual([
    { op: "append_draft", destination: "prompt", text: "plain" },
  ]);
  expect(h.operations("set_draft")).toEqual([]);
  expect(
    h
      .entries()
      .some(
        (entry) =>
          entry.kind === "notice" && entry.text.includes("with images could not be sent again"),
      ),
  ).toBe(true);
  h.release();
  await h.until(() => phase(h) === "idle" && responded(h, "later"));
  const delivered = JSON.stringify(session.messages);
  expect(delivered).toContain('"text":"first"');
  expect(delivered).toContain('"mimeType":"image/png"');
});

test("a held run keeps its queue for the queue operations", async () => {
  const h = await start({
    extensions: ["queue"],
    responses: [call("wait", "w1"), fauxAssistantMessage("after")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  await h.action("global.pause");
  await send(h, "queued");
  // The prompt resumed the run; pause again and hold it at the boundary.
  await h.action("global.pause");
  h.release();
  await h.until(() => phase(h) === "paused");
  expect(h.queue().followUp).toEqual(["queued"]);
  expect(await h.action("editor.queue_edit_all")).toMatchObject({ detail: { taken: 1 } });
  await h.action("global.resume");
  await h.until(() => phase(h) === "idle" && responded(h, "after"));
  expect(prompts(h)).not.toContain("queued");
});

test("compaction is refused while a run is active", async () => {
  const h = await start({
    extensions: ["model"],
    responses: [call("wait", "w1"), fauxAssistantMessage("after")],
  });
  await send(h, "go");
  await h.until(() => h.started.length === 1);
  expect(await h.action("global.compact", {}, false)).toMatchObject({ code: "not_idle" });
  h.release();
  await h.until(() => phase(h) === "idle");
});
