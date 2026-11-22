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
import { Edith, type Options, type Profile, UnknownProfile } from "./core.ts";
import { toolsExtension } from "./tools.ts";

const context = BACKGROUND_CONTEXT;
const directory = mkdtempSync(join(tmpdir(), "edith-core-"));
after(() => rmSync(directory, { recursive: true, force: true }));

// Answers with the model's id and how many user messages the conversation holds.
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

const profile = (modelId: string, extra: Partial<Profile> = {}): Profile => ({
  model: { provider: "faux", modelId },
  thinkingLevel: "off",
  tools: [],
  mcpServers: [],
  maxTurns: null,
  ...extra,
});

async function open(
  file: string,
  profiles: Options["profiles"],
  extra: Partial<Options> = {},
): Promise<Edith> {
  return Edith.open(
    await openNodeSqliteStorage(join(directory, file)),
    { models: models(), profiles, namespaces: { cli: "full" }, ...extra },
    context,
  );
}

const ask = async (edith: Edith, address: string) => {
  const answer = await edith.ask(address, "hello", context);
  assert.equal(answer.status, "done", JSON.stringify(answer));
  return answer.status === "done" ? answer.text : "";
};

void test("an address keeps one conversation and addresses do not share one", async () => {
  const edith = await open("addresses.sqlite", { restricted: profile("a") });
  assert.equal(await ask(edith, "discord:1"), "a:1");
  assert.equal(await ask(edith, "discord:1"), "a:2");
  assert.equal(await ask(edith, "discord:2"), "a:1");
  assert.equal(await ask(edith, "cli"), "a:1");
  await edith.close(context);
});

void test("a namespace follows its profile, an unlisted one `restricted`, until an override, and again once it is cleared", async () => {
  const edith = await open("profiles.sqlite", { full: profile("a"), restricted: profile("b") });
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

void test("a conversation's chosen profile replaces its namespace's, only among configured ones, until it is cleared", async () => {
  const edith = await open("chosen.sqlite", { full: profile("a"), restricted: profile("b") });
  assert.equal(await ask(edith, "discord:1"), "b:1");
  const chosen = await edith.configure("discord:1", { profile: "full" }, context);
  assert.equal(chosen.profile, "full");
  assert.equal(await ask(edith, "discord:1"), "a:2");
  assert.equal(await ask(edith, "discord:2"), "b:1");
  await assert.rejects(
    edith.configure("discord:1", { profile: "missing" }, context),
    UnknownProfile,
  );
  assert.equal((await edith.status("discord:1", context)).profile, "full");
  await edith.configure("discord:1", { profile: null }, context);
  assert.equal(await ask(edith, "discord:1"), "b:3");
  await edith.close(context);
});

void test("after a restart, addresses, history and overrides persist and a changed profile reaches the rest", async () => {
  const before = await open("restart.sqlite", {
    extra: profile("a"),
    full: profile("a"),
    restricted: profile("a"),
  });
  assert.equal(await ask(before, "discord:1"), "a:1");
  assert.equal(await ask(before, "discord:2"), "a:1");
  await before.configure("discord:2", { model: { provider: "faux", modelId: "c" } }, context);
  await before.configure("discord:3", { profile: "full" }, context);
  await before.configure("cli", { profile: "extra" }, context);
  await before.close(context);

  const after = await open("restart.sqlite", { full: profile("a"), restricted: profile("b") });
  assert.equal(await ask(after, "discord:1"), "b:2");
  assert.equal(await ask(after, "discord:2"), "c:2");
  assert.equal(await ask(after, "discord:3"), "a:1");
  await after.close(context);

  // A chosen profile the configuration no longer has falls back to the namespace's.
  const removed = await open("restart.sqlite", { full: profile("c"), restricted: profile("b") });
  assert.equal(await ask(removed, "cli"), "c:1");
  assert.equal((await removed.status("cli", context)).profile, "full");
  await removed.close(context);
});

void test("concurrent first inputs to a new address share one conversation", async () => {
  const edith = await open("concurrent.sqlite", { restricted: profile("a") });
  await Promise.all([ask(edith, "discord:9"), ask(edith, "discord:9")]);
  assert.equal(await ask(edith, "discord:9"), "a:3");
  await edith.close(context);
});

void test("a profile's servers are callable only through code mode, and changed servers or turn limits reach existing conversations", async () => {
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

  const before = await open(
    "tools.sqlite",
    { full: profile("a", { mcpServers: ["web"] }), restricted: profile("a", { maxTurns: 3 }) },
    extra,
  );
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

  const after = await open(
    "tools.sqlite",
    {
      full: profile("a", { mcpServers: ["web", "news"] }),
      restricted: profile("a"),
    },
    extra,
  );
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

void test("a profile's tools are callable only through code mode, by name, beside its servers, and changes reach existing conversations", async () => {
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

  const before = await open(
    "own-tools.sqlite",
    {
      full: profile("a", { tools: ["read", "write"], mcpServers: ["web"] }),
      restricted: profile("a", { tools: ["read"] }),
    },
    extra,
  );
  await ask(before, "cli");
  await ask(before, "discord:1");
  assert.deepEqual(await equipment(before, "cli"), {
    offered: ["codemode"],
    callable: ["mcp__web__search", "read", "write"],
  });
  assert.deepEqual(await equipment(before, "discord:1"), {
    offered: ["codemode"],
    callable: ["read"],
  });
  await before.close(context);

  const after = await open(
    "own-tools.sqlite",
    { full: profile("a", { mcpServers: ["web"] }), restricted: profile("a", { tools: ["bash"] }) },
    extra,
  );
  await ask(after, "cli");
  await ask(after, "discord:1");
  assert.deepEqual((await equipment(after, "cli")).callable, ["mcp__web__search"]);
  assert.deepEqual((await equipment(after, "discord:1")).callable, ["bash"]);
  await after.close(context);
  await sandbox.close();
});
