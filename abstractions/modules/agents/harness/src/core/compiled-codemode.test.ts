import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile, entrypoints } from "../../build";

// Builds and source tests do not resolve embedded worker entrypoints. Exercise
// the shipped entry with a loadout hook, without a model request or credentials.
test("the compiled harness executes codemode from an unrelated cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-compiled-codemode-"));
  try {
    // Built outside the package so a test run leaves no executable in the tree,
    // and apart from XDG_CONFIG_HOME/harness, where the run keeps its files.
    const executable = join(directory, "bin", "harness");
    const build = await compile(entrypoints, executable);
    expect(build.success, build.logs.join("\n")).toBe(true);
    const resultPath = join(directory, "result.json");
    const extensionPath = join(directory, "probe.js");
    await writeFile(
      extensionPath,
      `
      import { writeFileSync } from "node:fs";
      export default function (pi) {
        let started = false;
        pi.registerTool({
          name: "compiled_probe", label: "Probe", description: "Probe",
          parameters: { type: "object", properties: {} },
          prepareLoadout({ registered }) {
            if (started) return;
            started = true;
            const tool = registered.find(tool => tool.name === "codemode");
            tool.execute("compiled-probe", { code: "return 1" }).then(result => {
              writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));
              process.exit(result.isError ? 1 : 0);
            }).catch(error => {
              writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ error: String(error) }));
              process.exit(1);
            });
          },
          async execute() { return { content: [] }; }
        });
      }
    `,
    );
    const configPath = join(directory, "settings.json");
    await writeFile(
      configPath,
      JSON.stringify({
        extensions: [extensionPath],
        defaultTools: ["codemode", "compiled_probe", "read", "bash", "edit", "write"],
        codemode: { mode: "only" },
      }),
    );
    const run = Bun.spawnSync([executable, "--config", configPath], {
      cwd: directory,
      env: { ...process.env, XDG_CONFIG_HOME: directory },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      timeout: 30_000,
    });
    const result = await Bun.file(resultPath).json();
    expect(run.exitCode, JSON.stringify(result) + run.stderr.toString()).toBe(0);
    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual({ type: "text", text: "1" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
