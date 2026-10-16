// Wrong selection can resume another writer or fork without consent; types cannot enforce these CLI decisions.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, startup } from "./startup";
import { options } from "./launch";

const saved = {
  path: "/saved/file.jsonl",
  id: "11111111-1111-4111-8111-111111111111",
  cwd: "/old",
  model: "saved/model",
};
test("CLI rejects conflicting selectors, resumes identity, and forks only with required consent", async () => {
  expect(() => cli(["--session", "a", "--fork", "b"])).toThrow("mutually exclusive");
  const resolve = () => saved;
  const resumed = await startup(cli(["--session", "111"]), "/old", resolve, async () => {
    throw new Error("unexpected confirmation");
  });
  expect(resumed.selection).toEqual({ kind: "identity", key: saved.id });
  expect(resumed.session).toEqual({ kind: "resume", id: saved.id, path: saved.path });
  expect(resumed.savedModel).toBe("saved/model");
  for (const flag of ["--session", "--fork"]) {
    await expect(startup(cli([flag, "111"]), "/new", resolve, async () => false)).rejects.toThrow(
      "cancelled",
    );
    const forked = await startup(cli([flag, "111"]), "/new", resolve, async () => true);
    expect(forked.session.kind).toBe("fork");
    expect(forked.session.id).not.toBe(saved.id);
  }
  const forked = await startup(cli(["--fork", "111"]), "/old", resolve);
  expect(forked.session.kind).toBe("fork");
  const fresh = await startup(cli([]), "/new");
  expect(fresh.selection.kind).toBe("cwd");
  expect(fresh.selection.key).toBe(fresh.session.id);
  await expect(
    startup(cli(["--session", "missing"]), "/new", () => {
      throw new Error("not_found");
    }),
  ).rejects.toThrow("not_found");
});

// Launch is the owned boundary for model priority and creator env; real Pi compatibility is process-tested.
test("launch prioritizes explicit/saved/settings/fallback models and keeps mock environment isolated", () => {
  const before = { ...process.env };
  const root = mkdtempSync(join(tmpdir(), "quin-launch-"));
  try {
    Object.assign(process.env, {
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_STATE_HOME: join(root, "state"),
      SHIELD_PI: "/pi",
      SHIELD_COMMANDCODE: "/provider",
      SHIELD_FAUX: "/faux",
      SHIELD_CODEMODE: "/codemode",
      SHIELD_DEFAULT_MODEL: "fallback/model",
      SHIELD_TOOLS_PATH: "/dedicated/bin",
      PATH: "/creator/bin",
      LANG: "ja_JP.UTF-8",
      SHIELD_TEST_CREATOR: "synthetic",
    });
    const launch = (explicit?: string, savedModel?: string) =>
      options(false, explicit, root, {}, undefined, savedModel);
    expect(launch().model).toBe("fallback/model");
    mkdirSync(join(root, "config/shield/pi"), { recursive: true });
    writeFileSync(
      join(root, "config/shield/pi/settings.json"),
      JSON.stringify({ defaultProvider: "settings", defaultModel: "model" }),
    );
    expect(launch().model).toBe("settings/model");
    expect(launch(undefined, "saved/model").model).toBe("saved/model");
    const live = launch("explicit/model", "saved/model");
    expect(live.model).toBe("explicit/model");
    expect(live.launch.env.SHIELD_TEST_CREATOR).toBe("synthetic");
    expect(live.launch.env.PATH).toBe("/dedicated/bin:/creator/bin");
    expect(live.launch.env.LANG).toBe("ja_JP.UTF-8");
    delete process.env.SHIELD_TOOLS_PATH;
    expect(launch().launch.env.PATH).toBe("/creator/bin");
    const mock = options(true, undefined, root);
    expect(mock.model).toBe("shield-faux/fixed");
    expect(mock.launch.env.SHIELD_TEST_CREATOR).toBeUndefined();
    expect(mock.launch.env.PI_OFFLINE).toBe("1");
    expect(mock.launch.argv).toContain("--no-context-files");
  } finally {
    process.env = before;
    rmSync(root, { recursive: true, force: true });
  }
});
