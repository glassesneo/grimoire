import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Credential } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "./credentials.ts";

const directory = mkdtempSync(join(tmpdir(), "edith-credentials-"));
after(() => rmSync(directory, { recursive: true, force: true }));

const oauth = (access: string): Credential =>
  ({ type: "oauth", access, refresh: `${access}-refresh`, expires: 0 }) as unknown as Credential;

void test("a copied auth.json seeds the store, and a refreshed credential survives a new process", async () => {
  const path = join(directory, "auth.json");
  writeFileSync(path, JSON.stringify({ openai: oauth("first") }), { mode: 0o600 });
  const store = new FileCredentialStore(path);
  assert.deepEqual(await store.read("openai"), oauth("first"));
  await store.modify("openai", (current) => {
    assert.deepEqual(current, oauth("first"));
    return Promise.resolve(oauth("second"));
  });
  assert.deepEqual(await new FileCredentialStore(path).read("openai"), oauth("second"));
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

void test("concurrent modifications see each other's writes", async () => {
  const path = join(directory, "concurrent.json");
  const store = new FileCredentialStore(path);
  const bump = () =>
    store.modify("counter", (current) => {
      const count = current ? Number((current as unknown as { access: string }).access) : 0;
      return new Promise((resolve) => setTimeout(() => resolve(oauth(String(count + 1))), 5));
    });
  await Promise.all([bump(), bump(), bump()]);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).counter, oauth("3"));
});
