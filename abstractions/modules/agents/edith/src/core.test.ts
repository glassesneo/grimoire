import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { type Access, Edith, type Options, type Persona, Refused, within } from "./core.ts";
import { toolsExtension } from "./tools.ts";

const context = BACKGROUND_CONTEXT;
const directory = mkdtempSync(join(tmpdir(), "edith-core-"));
after(() => rmSync(directory, { recursive: true, force: true }));

function models() {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "a" }, { id: "b" }, { id: "c" }] });
  faux.setResponses(
    Array.from(
      { length: 100 },
      () =>
        (
          transcript: { messages: readonly { role: string }[] },
          _o: unknown,
          _s: unknown,
          model: { id: string },
        ) =>
          fauxAssistantMessage(
            `${model.id}:${transcript.messages.filter((m) => m.role === "user").length}`,
          ),
    ),
  );
  const registry = createModels();
  registry.setProvider(faux.provider);
  return registry;
}

const persona = (modelId: string): Persona => ({
  model: { provider: "faux", modelId },
  thinkingLevel: "off",
});

const access = (extra: Partial<Access> = {}): Access => ({
  tools: [],
  mcpServers: [],
  maxTurns: null,
  ...extra,
});

async function open(
  file: string,
  personas: Options["personas"],
  extra: Partial<Options> = {},
): Promise<Edith> {
  return Edith.open(
    await openNodeSqliteStorage(join(directory, file)),
    {
      models: models(),
      access: { full: access(), restricted: access() },
      personas,
      namespaces: { cli: { access: "full", ceiling: "full", persona: "deep" } },
      ...extra,
    },
    context,
  );
}

const ask = async (edith: Edith, address: string) => {
  const answer = await edith.ask(address, "hello", context);
  assert.equal(answer.status, "done", JSON.stringify(answer));
  return answer.status === "done" ? answer.text : "";
};

const same = { deep: persona("a"), edith: persona("a") };

void test("an address keeps one conversation and addresses do not share one", async () => {
  const edith = await open("addresses.sqlite", same);
  assert.equal(await ask(edith, "discord:1"), "a:1");
  assert.equal(await ask(edith, "discord:1"), "a:2");
  assert.equal(await ask(edith, "discord:2"), "a:1");
  assert.equal(await ask(edith, "cli"), "a:1");
  await edith.close(context);
});

void test("a namespace follows its persona, an unlisted one `edith`, until an override, and again once it is cleared", async () => {
  const edith = await open("personas.sqlite", { deep: persona("a"), edith: persona("b") });
  assert.equal(await ask(edith, "cli"), "a:1");
  assert.equal(await ask(edith, "discord:1"), "b:1");
  const set = await edith.configure(
    "discord:1",
    { model: { provider: "faux", modelId: "c" } },
    context,
  );
  assert.deepEqual(set.model, { provider: "faux", modelId: "c" });
  assert.equal(await ask(edith, "discord:1"), "c:2");
  assert.equal(await ask(edith, "discord:2"), "b:1");
  await edith.configure("discord:1", { model: null }, context);
  assert.equal(await ask(edith, "discord:1"), "b:3");
  await edith.close(context);
});

void test("a conversation's chosen persona replaces its namespace's, only among configured ones, until it is cleared", async () => {
  const edith = await open("chosen.sqlite", { deep: persona("a"), edith: persona("b") });
  assert.equal(await ask(edith, "discord:1"), "b:1");
  const chosen = await edith.configure("discord:1", { persona: "deep" }, context);
  assert.equal(chosen.persona, "deep");
  assert.equal(await ask(edith, "discord:1"), "a:2");
  assert.equal(await ask(edith, "discord:2"), "b:1");
  await assert.rejects(edith.configure("discord:1", { persona: "missing" }, context), Refused);
  assert.equal((await edith.status("discord:1", context)).persona, "deep");
  await edith.configure("discord:1", { persona: null }, context);
  assert.equal(await ask(edith, "discord:1"), "b:3");
  await edith.close(context);
});

void test("an access lies within another when its tools and servers are among the other's and its turn limit is no higher", () => {
  const ceiling = access({ tools: ["read", "write"], mcpServers: ["web"], maxTurns: 10 });
  assert.ok(within(access({ tools: ["read"], maxTurns: 10 }), ceiling));
  assert.ok(within(ceiling, ceiling));
  assert.ok(!within(access({ tools: ["bash"], maxTurns: 1 }), ceiling));
  assert.ok(!within(access({ mcpServers: ["news"], maxTurns: 1 }), ceiling));
  assert.ok(!within(access({ maxTurns: 11 }), ceiling));
  assert.ok(!within(access(), ceiling), "no turn limit exceeds any");
  assert.ok(within(access({ maxTurns: 99 }), access()));
});

void test("a conversation may choose only an access within its namespace's ceiling, and falls back once the ceiling drops it, while a session that ran above it takes no more input", async () => {
  const sets = {
    full: access({ tools: ["read", "write"], mcpServers: ["web"] }),
    web: access({ mcpServers: ["web"], maxTurns: 10 }),
    chat: access({ maxTurns: 5 }),
    restricted: access({ maxTurns: 5 }),
  };
  const options = (ceiling: string) => ({
    access: sets,
    namespaces: {
      cli: { access: "full", ceiling: "full", persona: "deep" },
      discord: { access: "chat", ceiling, persona: "edith" },
    },
  });
  const edith = await open("ceiling.sqlite", same, options("web"));
  assert.deepEqual(edith.accessChoices("cli"), ["full", "web", "chat", "restricted"]);
  assert.deepEqual(edith.accessChoices("discord"), ["web", "chat", "restricted"]);
  assert.deepEqual(edith.accessChoices("other"), ["chat", "restricted"]);
  assert.equal((await edith.status("discord:1", context)).access, "chat");
  await assert.rejects(edith.configure("discord:1", { access: "full" }, context), Refused);
  await assert.rejects(edith.configure("discord:1", { access: "missing" }, context), Refused);
  const chosen = await edith.configure("discord:1", { access: "web" }, context);
  assert.deepEqual([chosen.access, chosen.mcpServers], ["web", ["web"]]);
  assert.equal(await ask(edith, "discord:1"), "a:1");
  await edith.close(context);

  const lowered = await open("ceiling.sqlite", same, options("chat"));
  const status = await lowered.status("discord:1", context);
  assert.deepEqual([status.access, status.overrides.access], ["chat", "web"]);
  await assert.rejects(lowered.ask("discord:1", "hello", context), Refused);
  assert.equal(await ask(lowered, "discord:2"), "a:1");
  await lowered.close(context);
});

void test("after a restart, addresses, history and overrides persist and a changed persona reaches the rest", async () => {
  const before = await open("restart.sqlite", {
    extra: persona("a"),
    deep: persona("a"),
    edith: persona("a"),
  });
  assert.equal(await ask(before, "discord:1"), "a:1");
  assert.equal(await ask(before, "discord:2"), "a:1");
  await before.configure("discord:2", { model: { provider: "faux", modelId: "c" } }, context);
  await before.configure("discord:3", { persona: "deep" }, context);
  await before.configure("cli", { persona: "extra" }, context);
  await before.close(context);

  const after = await open("restart.sqlite", { deep: persona("a"), edith: persona("b") });
  assert.equal(await ask(after, "discord:1"), "b:2");
  assert.equal(await ask(after, "discord:2"), "c:2");
  assert.equal(await ask(after, "discord:3"), "a:1");
  await after.close(context);

  const removed = await open("restart.sqlite", { deep: persona("c"), edith: persona("b") });
  assert.equal(await ask(removed, "cli"), "c:1");
  assert.equal((await removed.status("cli", context)).persona, "deep");
  await removed.close(context);
});

void test("concurrent first inputs to a new address share one conversation", async () => {
  const edith = await open("concurrent.sqlite", same);
  await Promise.all([ask(edith, "discord:9"), ask(edith, "discord:9")]);
  assert.equal(await ask(edith, "discord:9"), "a:3");
  await edith.close(context);
});

void test("an access's servers are callable only through code mode, and changed servers or turn limits reach existing conversations", async () => {
  const server = (name: string) =>
    defineExtension({
      name: `mcp:${name}`,
      tools: [
        defineTool({
          name: `mcp__${name}__search`,
          description: "search",
          parameters: { type: "object", properties: {} },
          callers: ["tools"],
          execute: () => Promise.resolve({ output: [{ type: "text", text: "found" }] }),
        }),
      ],
    });
  const sandbox = new CodemodeSandbox();
  const extra = {
    codemode: createCodemodeExtension({ sandbox, models: false }),
    servers: [server("web"), server("news")],
  };
  const equipment = async (edith: Edith, address: string) => {
    const agent = await (await edith.conversation(address, context)).agent(context);
    return {
      offered: agent.tools.map((tool) => tool.name),
      callable: agent.callable.map((tool) => tool.name),
      maxTurns: agent.maxTurns,
    };
  };

  const before = await open("tools.sqlite", same, {
    ...extra,
    access: { full: access({ mcpServers: ["web"] }), restricted: access({ maxTurns: 3 }) },
  });
  await ask(before, "cli");
  await ask(before, "discord:1");
  assert.deepEqual(await equipment(before, "cli"), {
    offered: ["codemode"],
    callable: ["mcp__web__search"],
    maxTurns: undefined,
  });
  assert.deepEqual(await equipment(before, "discord:1"), {
    offered: [],
    callable: [],
    maxTurns: 3,
  });
  await before.close(context);

  const after = await open("tools.sqlite", same, {
    ...extra,
    access: { full: access({ mcpServers: ["web", "news"] }), restricted: access() },
  });
  await ask(after, "cli");
  await ask(after, "discord:1");
  assert.deepEqual((await equipment(after, "cli")).callable, [
    "mcp__web__search",
    "mcp__news__search",
  ]);
  assert.equal((await equipment(after, "discord:1")).maxTurns, undefined);
  await after.close(context);
  await sandbox.close();
});

void test("an access's tools are callable only through code mode, by name, beside its servers, and added tools reach existing conversations", async () => {
  const sandbox = new CodemodeSandbox();
  const web = defineExtension({
    name: "mcp:web",
    tools: [
      defineTool({
        name: "mcp__web__search",
        description: "search",
        parameters: { type: "object", properties: {} },
        callers: ["tools"],
        execute: () => Promise.resolve({ output: [{ type: "text", text: "found" }] }),
      }),
    ],
  });
  const extra = {
    codemode: createCodemodeExtension({ sandbox, models: false }),
    servers: [web],
    tools: toolsExtension,
  };
  const equipment = async (edith: Edith, address: string) => {
    const agent = await (await edith.conversation(address, context)).agent(context);
    return {
      offered: agent.tools.map((tool) => tool.name),
      callable: agent.callable.map((tool) => tool.name).sort(),
    };
  };

  const before = await open("own-tools.sqlite", same, {
    ...extra,
    access: {
      full: access({ tools: ["read"], mcpServers: ["web"] }),
      restricted: access({ tools: ["read"] }),
    },
  });
  await ask(before, "cli");
  await ask(before, "discord:1");
  assert.deepEqual(await equipment(before, "cli"), {
    offered: ["codemode"],
    callable: ["mcp__web__search", "read"],
  });
  assert.deepEqual(await equipment(before, "discord:1"), {
    offered: ["codemode"],
    callable: ["read"],
  });
  await before.close(context);

  const after = await open("own-tools.sqlite", same, {
    ...extra,
    access: {
      full: access({ tools: ["read", "write"], mcpServers: ["web"] }),
      restricted: access({ tools: ["read", "bash"] }),
    },
  });
  await ask(after, "cli");
  await ask(after, "discord:1");
  assert.deepEqual((await equipment(after, "cli")).callable, ["mcp__web__search", "read", "write"]);
  assert.deepEqual((await equipment(after, "discord:1")).callable, ["bash", "read"]);
  await after.close(context);
  await sandbox.close();
});
