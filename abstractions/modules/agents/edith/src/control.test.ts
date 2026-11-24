import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { interjectedNote } from "./control.ts";
import { type Access, Edith, type Namespace, Refused, stoppedNote } from "./core.ts";

const context = BACKGROUND_CONTEXT;
const directory = mkdtempSync(join(tmpdir(), "edith-control-"));
const sandbox = new CodemodeSandbox();
after(async () => {
  await sandbox.close();
  rmSync(directory, { recursive: true, force: true });
});

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(
  file: string,
  options: {
    respond?: (call: number) => Promise<void> | void;
    search?: () => Promise<void> | void;
    access?: Record<string, Access> & { restricted: Access };
    namespaces?: Record<string, Namespace>;
  } = {},
) {
  const counts = { requests: 0, searches: 0 };
  const seen: string[] = [];
  const faux = fauxProvider({ provider: "faux", models: [{ id: "a" }] });
  faux.setResponses(
    Array.from(
      { length: 50 },
      () => async (transcript: { messages: readonly { role: string }[] }) => {
        counts.requests += 1;
        seen.push(JSON.stringify(transcript.messages));
        await options.respond?.(counts.requests);
        const last = transcript.messages.at(-1);
        if (JSON.stringify(transcript.messages[0]).includes("Write a title"))
          return fauxAssistantMessage("Searching the web");
        if (last?.role === "user")
          return fauxAssistantMessage(
            [fauxToolCall("codemode", { code: "return await tools.mcp__web__search({});" })],
            { stopReason: "toolUse" },
          );
        return fauxAssistantMessage(
          `done:${transcript.messages.filter((message) => message.role === "user").length}`,
        );
      },
    ),
  );
  const models = createModels();
  models.setProvider(faux.provider);
  const web = defineExtension({
    name: "mcp:web",
    tools: [
      defineTool({
        name: "mcp__web__search",
        description: "search",
        parameters: { type: "object", properties: {} },
        callers: ["tools"],
        execute: async () => {
          counts.searches += 1;
          await options.search?.();
          return { output: [{ type: "text", text: "found" }] };
        },
      }),
    ],
  });
  const web_ = { tools: [], mcpServers: ["web"], maxTurns: null } satisfies Access;
  const open = async () =>
    Edith.open(
      await openNodeSqliteStorage(join(directory, file)),
      {
        models,
        access: options.access ?? { restricted: web_ },
        personas: { edith: { model: { provider: "faux", modelId: "a" }, thinkingLevel: "off" } },
        namespaces: options.namespaces ?? {},
        codemode: createCodemodeExtension({ sandbox, models: false }),
        servers: [web],
      },
      context,
    );
  return { counts, seen, open };
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

const toolResults = async (edith: Edith, address: string) => {
  const conversation = await edith.conversation(address, context);
  const page = await conversation.entries({}, 100, undefined, context);
  return page.items.filter((entry) => entry.kind === "pi.tool-result").length;
};

void test("a paused conversation runs no tool the model asks for until resumed, and input while nothing runs ends the pause", async () => {
  const answered = deferred();
  const { counts, open } = setup("pause-tool.sqlite", {
    respond: (call) => (call === 1 ? answered.promise : undefined),
  });
  const edith = await open();
  const submission = await edith.submit("cli", { content: "go" }, context);
  await settle(100);
  assert.equal((await edith.pause("cli", context)).paused, true);
  answered.resolve();
  await settle(500);
  assert.deepEqual([counts.searches, await toolResults(edith, "cli")], [0, 0]);
  const parked = (await edith.harness.inspect(context)).tasks.filter(
    (task) => task.state.kind === "sleeping",
  );
  assert.equal(parked.length, 1);
  assert.equal(parked[0]?.state.kind === "sleeping" && parked[0].state.until, undefined);
  const held = await edith.whenHeld("cli", 10, context);
  const conversation = await edith.conversation("cli", context);
  const asking = (await conversation.entries({}, 10, undefined, context)).items.find(
    (entry) => entry.kind === "pi.assistant",
  );
  const call =
    asking?.model?.[0]?.role === "assistant"
      ? asking.model[0].content.find((part) => part.type === "toolCall")
      : undefined;
  assert.deepEqual(held, { kind: "tool", callId: call?.id, assistant: asking?.id });
  await edith.resume("cli", context);
  const answer = await edith.answer(submission, context);
  assert.deepEqual(answer, {
    status: "done",
    text: "done:1",
    entry: (answer as { entry: number }).entry,
  });
  assert.equal(counts.searches, 1);

  await edith.pause("cli", context);
  assert.equal((await edith.ask("cli", "again", context)).status, "done");
  assert.equal((await edith.status("cli", context)).paused, false);
  await edith.close(context);
});

void test("a run paused during a round of tools makes no next request until resumed", async () => {
  let edith: Edith | undefined;
  const { counts, open } = setup("pause-round.sqlite", {
    search: async () => {
      await edith?.pause("cli", context);
    },
  });
  edith = await open();
  const submission = await edith.submit("cli", { content: "go" }, context);
  await settle(800);
  assert.deepEqual([counts.searches, counts.requests], [1, 1]);
  assert.equal(await toolResults(edith, "cli"), 1);
  assert.equal((await edith.whenHeld("cli", 10, context))?.kind, "request");
  await edith.resume("cli", context);
  const answer = await edith.answer(submission, context);
  assert.equal(answer.status === "done" && answer.text, "done:1");
  assert.equal(counts.requests, 2);
  assert.equal(await edith.whenHeld("cli", 10, context), undefined);
  await edith.close(context);
});

void test("a message to a run held before a tool call resumes it without that call, and the model reads the message next", async () => {
  const answered = deferred();
  const { counts, seen, open } = setup("interject.sqlite", {
    respond: (call) => (call === 1 ? answered.promise : undefined),
  });
  const edith = await open();
  const first = await edith.submit("cli", { content: "go" }, context);
  await settle(100);
  await edith.pause("cli", context);
  answered.resolve();
  await settle(500);
  assert.equal((await edith.whenHeld("cli", 10, context))?.kind, "tool");
  const interjection = await edith.submit("cli", { content: "never mind" }, context);
  assert.equal((await edith.status("cli", context)).paused, false);
  const answers = await Promise.all([
    edith.answer(first, context),
    edith.answer(interjection, context),
  ]);
  assert.deepEqual(
    answers.map((answer) => answer.status),
    ["done", "done"],
  );
  const next = seen[1] ?? "";
  assert.ok(next.includes(interjectedNote), next);
  assert.ok(next.indexOf(interjectedNote) < next.indexOf("never mind"), next);
  assert.equal(counts.searches, 1, "only the call the model made after reading the message");
  await edith.close(context);
});

void test("stopping ends the run and its pause, and withdraws input not yet given to the model", async () => {
  const { counts, seen, open } = setup("stop.sqlite");
  const edith = await open();
  const first = await edith.submit("cli", { content: "go" }, context);
  const queued = await edith.submit("cli", { content: "then this" }, context);
  await edith.pause("cli", context);
  await settle(300);
  const stopped = await edith.stop("cli", context);
  assert.equal(stopped.paused, false);
  const answers = await Promise.all([edith.answer(first, context), edith.answer(queued, context)]);
  assert.deepEqual(
    answers.map((answer) => answer.status),
    ["stopped", "stopped"],
  );
  assert.equal(counts.searches, 0);
  const conversation = await edith.conversation("cli", context);
  const newest = (await conversation.entries({}, 1, undefined, context)).items[0];
  assert.equal(newest?.kind, "edith.stopped");
  assert.equal((await edith.ask("cli", "after", context)).status, "done");
  assert.ok(seen.at(-1)?.includes(stoppedNote));
  await edith.close(context);
});

void test("a reset starts a new conversation that keeps the address's choices, and the old one can be switched back to", async () => {
  const { open } = setup("reset.sqlite");
  const edith = await open();
  await edith.configure("cli", { thinkingLevel: "high" }, context);
  const answer = await edith.ask("cli", "first", context);
  assert.equal(answer.status === "done" && answer.text, "done:1");
  const { previous, current } = await edith.reset("cli", context);
  assert.notEqual(previous, current);
  assert.equal((await edith.status("cli", context)).thinkingLevel, "high");
  const fresh = await edith.ask("cli", "second", context);
  assert.equal(fresh.status === "done" && fresh.text, "done:1");
  let sessions = await edith.sessions("cli", context);
  for (let tries = 0; tries < 50 && sessions[1]?.preview !== "Searching the web"; tries++) {
    await settle(20);
    sessions = await edith.sessions("cli", context);
  }
  assert.deepEqual(
    sessions.map((session) => [
      session.conversation,
      session.current,
      session.preview,
      session.allowed,
    ]),
    [
      [current, true, "second", true],
      [previous, false, "Searching the web", true],
    ],
  );
  await edith.switchTo("cli", previous, context);
  const back = await edith.ask("cli", "third", context);
  assert.equal(back.status === "done" && back.text, "done:2");
  assert.deepEqual(
    (await edith.sessions("cli", context)).map((session) => session.conversation),
    [previous, current],
  );
  await assert.rejects(edith.switchTo("cli", 999_999, context), Refused);
  await edith.close(context);
});

void test("a session that ran with more than its namespace's ceiling allows can be neither continued nor switched back to", async () => {
  const web = { tools: [], mcpServers: ["web"], maxTurns: null } satisfies Access;
  const none = { tools: [], mcpServers: [], maxTurns: null } satisfies Access;
  const configured = (ceiling: string) => ({
    access: { web, restricted: none },
    namespaces: { discord: { access: "restricted", ceiling, persona: "edith" } },
  });
  const before = await setup("labels.sqlite", configured("web")).open();
  await before.configure("discord:1", { access: "web" }, context);
  assert.equal((await before.ask("discord:1", "search", context)).status, "done");
  await before.configure("discord:1", { access: "restricted" }, context);
  await before.close(context);

  const after_ = await setup("labels.sqlite", configured("restricted")).open();
  await assert.rejects(after_.submit("discord:1", { content: "more" }, context), Refused);
  const { previous } = await after_.reset("discord:1", context);
  assert.equal((await after_.ask("discord:1", "fresh", context)).status, "done");
  assert.deepEqual(
    (await after_.sessions("discord:1", context)).map((session) => session.allowed),
    [true, false],
  );
  await assert.rejects(after_.switchTo("discord:1", previous, context), Refused);
  await after_.close(context);
});
