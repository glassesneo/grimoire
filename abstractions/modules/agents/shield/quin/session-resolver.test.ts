// Resolver mistakes can select another conversation or read outside SHIELD. Exercise the public helper boundary with synthetic history.
import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const helper = join(import.meta.dir, "../runtime/session-resolver.mjs");
const packaged = process.env.SHIELD_SESSION_RESOLVER;
test("resolver resolves IDs, prefixes and paths without mutations and rejects ambiguity/escape/corruption", () => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "quin-resolver-")));
  const root = join(temp, "sessions");
  mkdirSync(join(root, "cwd-a"), { recursive: true });
  mkdirSync(join(root, "cwd-b"));
  const id = "11111111-1111-4111-8111-111111111111";
  const second = "11111111-1111-4111-8111-222222222222";
  const file = join(root, "cwd-a/a.jsonl");
  const content = (id: string) =>
    [
      { type: "session", version: 3, id, timestamp: "2026-10-16T00:00:00.000Z", cwd: temp },
      { type: "model_change", id: "m1", parentId: null, provider: "saved", modelId: "first" },
      { type: "model_change", id: "m2", parentId: "m1", provider: "saved", modelId: "latest" },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
  writeFileSync(file, content(id));
  const env = {
    ...process.env,
    HOME: temp,
    XDG_CONFIG_HOME: join(temp, "config"),
    XDG_STATE_HOME: join(temp, "state"),
  };
  const run = (specifier: string) => {
    try {
      return JSON.parse(
        packaged
          ? execFileSync(packaged, [root, specifier, temp], {
              env,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            })
          : execFileSync(process.execPath, [helper, root, specifier, temp], {
              env,
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
            }),
      );
    } catch (error: any) {
      throw new Error(error.stderr?.toString() || error.message);
    }
  };
  try {
    expect(run(id)).toEqual({ path: file, id, cwd: temp, model: "saved/latest" });
    expect(run("1111").id).toBe(id);
    expect(run("sessions/cwd-a/a.jsonl").path).toBe(file);
    expect(readFileSync(file, "utf8")).toBe(content(id));
    writeFileSync(join(root, "cwd-b/b.jsonl"), content(second));
    expect(run(id).id).toBe(id);
    expect(() => run("1111")).toThrow("ambiguous");
    const exact = join(root, "cwd-b/exact.jsonl");
    writeFileSync(exact, content("1111"));
    expect(run("1111").id).toBe("1111");
    rmSync(exact);
    expect(() => run("nonexistent")).toThrow("not_found");
    writeFileSync(join(root, "cwd-b/duplicate.jsonl"), content(id));
    expect(() => run(id)).toThrow("ambiguous");
    const outside = join(temp, "outside.jsonl");
    writeFileSync(outside, content(id));
    expect(() => run(outside)).toThrow("outside_root");
    symlinkSync(outside, join(root, "cwd-a/link.jsonl"));
    expect(() => run(join(root, "cwd-a/link.jsonl"))).toThrow("outside_root");
    const bad = join(root, "cwd-a/bad.jsonl");
    writeFileSync(bad, '{"type":"session","id":"invalid"}');
    expect(() => run(bad)).toThrow("invalid_header");
    rmSync(root, { recursive: true, force: true });
    expect(() => run(id)).toThrow("not_found");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 30_000);
