import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edith, type Options } from "./core.ts";

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

async function open(file: string, profiles: Options["profiles"]): Promise<Edith> {
  return Edith.open(
    await openNodeSqliteStorage(join(directory, file)),
    { models: models(), profiles },
    context,
  );
}

const ask = async (edith: Edith, address: string) => {
  const answer = await edith.ask(address, "hello", context);
  assert.equal(answer.status, "done", JSON.stringify(answer));
  return answer.status === "done" ? answer.text : "";
};

void test("an address keeps one conversation and addresses do not share one", async () => {
  const edith = await open("addresses.sqlite", {
    default: { model: { provider: "faux", modelId: "a" } },
  });
  assert.equal(await ask(edith, "discord:1"), "a:1");
  assert.equal(await ask(edith, "discord:1"), "a:2");
  assert.equal(await ask(edith, "discord:2"), "a:1");
  assert.equal(await ask(edith, "cli"), "a:1");
  await edith.close(context);
});

void test("a namespace follows its profile until an override, and again once it is cleared", async () => {
  const edith = await open("profiles.sqlite", {
    default: { model: { provider: "faux", modelId: "a" } },
    discord: { model: { provider: "faux", modelId: "b" } },
  });
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

void test("after a restart, addresses, history and overrides persist and a changed profile reaches the rest", async () => {
  const before = await open("restart.sqlite", {
    default: { model: { provider: "faux", modelId: "a" } },
  });
  assert.equal(await ask(before, "discord:1"), "a:1");
  assert.equal(await ask(before, "discord:2"), "a:1");
  await before.configure("discord:2", { model: { provider: "faux", modelId: "c" } }, context);
  await before.close(context);

  const after = await open("restart.sqlite", {
    default: { model: { provider: "faux", modelId: "b" } },
  });
  assert.equal(await ask(after, "discord:1"), "b:2");
  assert.equal(await ask(after, "discord:2"), "c:2");
  await after.close(context);
});

void test("concurrent first inputs to a new address share one conversation", async () => {
  const edith = await open("concurrent.sqlite", {
    default: { model: { provider: "faux", modelId: "a" } },
  });
  await Promise.all([ask(edith, "discord:9"), ask(edith, "discord:9")]);
  assert.equal(await ask(edith, "discord:9"), "a:3");
  await edith.close(context);
});
