import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "../../build";

// Source tests resolve OpenTUI's tree-sitter worker and parser assets from
// node_modules; the executable must carry them. Compile a headless probe with
// the harness's build options and run it from an unrelated directory without
// credentials, observing rendered code and actual highlights.
test("the compiled harness renders Markdown and highlights code from an unrelated cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-compiled-markdown-"));
  try {
    const outfile = join(directory, "probe");
    const build = await compile([resolve(import.meta.dir, "compiled-markdown.probe.tsx")], outfile);
    expect(build.success, build.logs.map((log) => log.message).join("\n")).toBe(true);
    const run = Bun.spawnSync([outfile], {
      cwd: directory,
      env: { PATH: process.env.PATH ?? "", HOME: directory, XDG_CONFIG_HOME: directory },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    });
    const output = run.stdout.toString().trim().split("\n").at(-1) ?? "";
    expect(run.exitCode, run.stderr.toString() + output).toBe(0);
    const result = JSON.parse(output) as { frame: string; highlights: number; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.highlights).toBeGreaterThan(0);
    expect(result.frame).toContain("Title");
    expect(result.frame).toContain("const probe: number = 1;");
    expect(result.frame).toContain("let other = 2;");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
