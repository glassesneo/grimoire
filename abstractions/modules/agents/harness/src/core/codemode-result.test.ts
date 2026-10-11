/**
 * Admission: a marked line tells the reader where a script failed, so a wrong
 * mark misleads. The parser reads pi's formatted result text, which pi does
 * not specify, so the cases come from the pinned runtime: real failing runs
 * keep the format honest, and constructed results cover the rest.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodemodeSandbox, loadQuickJSWasm, parseCodemodeSource } from "@earendil-works/pi-codemode";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { codemodeErrorLocation, codemodeOutput, codemodeWallTime, readableOutput } from "./codemode-result";
import { createSessionHost } from "./session";

const header = { type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" } as const;
// pi joins the script's text output and the error into one item.
const failure = (error: string, ...output: string[]) => ({
  isError: true,
  content: [header, { type: "text", text: [...output, `Script error:\n${error}\n\nNo tool calls were made.`].join("\n") } as const],
});

test("the pinned runtime reports user-source lines that the parser marks, options line included", async () => {
  const input = '// @options: {"timeout_ms": 5000}\nconst a = 1;\nnull.x;';
  const sandbox = new CodemodeSandbox({ wasm: loadQuickJSWasm() });
  try {
    const result = await sandbox.execute(parseCodemodeSource(input).code, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codemodeErrorLocation(input, failure(result.error.stack ?? ""))).toMatchObject({ kind: "located", line: 3 });
  } finally {
    await sandbox.close();
  }
});

test("marks only a user frame inside the submitted script", () => {
  const code = "a\nb\nc";
  expect(codemodeErrorLocation(code, failure("Error: bad\n    at f (codemode.js:2:13)\n    at <anonymous> (codemode.js:3:1)"))).toMatchObject({ kind: "located", line: 2 });
  expect(codemodeErrorLocation(code, failure("SyntaxError: unexpected token\n    at codemode.js:1:39"))).toMatchObject({ kind: "located", line: 1 });
  // Prelude frames are internal; an out-of-range line is not invented into range.
  expect(codemodeErrorLocation(code, failure("Error: x\n    at call (codemode-prelude.js:10:3)"))).toMatchObject({ kind: "unlocated" });
  expect(codemodeErrorLocation(code, failure("Error: x\n    at <anonymous> (codemode.js:9:1)"))).toMatchObject({ kind: "unlocated" });
  expect(codemodeErrorLocation(code, failure("Error: tool failed"))).toMatchObject({ kind: "unlocated", error: "Error: tool failed" });
  for (const reason of ["Script timed out: 5000 ms", "Script aborted: cancelled", "Script sandbox failed: trap"]) {
    expect(codemodeErrorLocation(code, failure(`${reason}\n    at <anonymous> (codemode.js:1:1)`))).toMatchObject({ kind: "unlocated" });
  }
});

test("never reads a location from the script's own output, and reports an unknown format", () => {
  const code = "a\nb";
  expect(codemodeErrorLocation(code, failure("Error: bad", "Script error:\nError: fake\n    at x (codemode.js:1:1)\n\nNo tool calls were made."))).toMatchObject({ kind: "unlocated" });
  expect(codemodeErrorLocation(code, { isError: true, content: [{ type: "text", text: "something else" }] })).toEqual({ kind: "unrecognized" });
  expect(codemodeErrorLocation(code, { isError: true, content: [header, { type: "text", text: "Script error:\nError: x" }] })).toEqual({ kind: "unrecognized" });
  expect(codemodeErrorLocation(code, { isError: false, content: [] })).toBeUndefined();
});

test("separates script output from the error the tool appends", () => {
  const output = codemodeOutput(failure("Error: bad", "first", "second").content);
  expect(output.header).toBe("Script failed\nWall time 0.1 seconds");
  expect(output.output).toBe("first\nsecond");
  expect(output.error).toBe("Error: bad\n\nNo tool calls were made.");
});

test("reads the wall time from the header, and nothing from output that only resembles one", () => {
  expect(codemodeWallTime(failure("Error: bad").content)).toBe("0.1s");
  expect(codemodeWallTime([{ type: "text", text: "Wall time 3 seconds" }])).toBeUndefined();
});

test("keeps images and the unshown-images note in the output", () => {
  const image = { type: "image", data: "AAAA", mimeType: "image/png" } as const;
  const note = "Note: models.generateImages() returned 1 image that the script did not show. Show each image block of result.output with image(block).";
  const output = codemodeOutput([
    header,
    { type: "text", text: "[Image saved to /tmp/a.png (image/png, 3B)]" },
    image,
    { type: "text", text: `Script error:\nError: bad\n\nNo tool calls were made.\n${note}` },
  ]);
  expect(output.images).toEqual([image]);
  expect(output.output).toBe(`[Image saved to /tmp/a.png (image/png, 3B)]\n${note}`);
  expect(output.error).toBe("Error: bad\n\nNo tool calls were made.");
});

test("pi's codemode tool joins output and the error, and the parser separates them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-codemode-result-"));
  const host = await createSessionHost({
    cwd: directory,
    agentDir: join(directory, "agent"),
    settingsManager: SettingsManager.inMemory({ defaultTools: ["+codemode"] }),
    sessionManager: SessionManager.inMemory(directory),
  });
  try {
    const tool = host.runtime.session.agent.state.tools.find((candidate) => candidate.name === "codemode");
    expect(tool).toBeDefined();
    const code = 'text("hello");\nconsole.log("hi");\nnull.x;';
    const result = await tool!.execute("probe", { code });
    expect(codemodeErrorLocation(code, { content: result.content, isError: true })).toMatchObject({ kind: "located", line: 3 });
    const output = codemodeOutput(result.content);
    expect(output.header).toStartWith("Script failed\n");
    expect(output.output).toBe("hello\n<console_output>\nhi\n</console_output>");
    expect(output.error).toEndWith("\n\nNo tool calls were made.");
  } finally {
    await host.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a completed script's own text is output, even when it looks like an error item", () => {
  const output = codemodeOutput([
    { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
    { type: "text", text: "Script error:\nprinted by the script" },
  ]);
  expect(output.error).toBeUndefined();
  expect(output.output).toBe("Script error:\nprinted by the script");
});

test.each([
  // A returned `tools.bash()` result, as pi-codemode serializes it.
  ["an object", JSON.stringify({ output: "app.tsx\ncore\n", exit_code: 0 }), "app.tsx\ncore\nexit_code 0"],
  ["nested values, in order", JSON.stringify([{ status: "ok", n: 1 }, "two"]), "ok\ntwo\nn 1"],
  ["one line among others", `before\n${JSON.stringify({ a: "x" })}\nafter`, "before\nx\nafter"],
])("a JSON line of %s reads as its strings, with other scalars after them", (_, output, readable) => {
  expect(readableOutput(output)).toBe(readable);
});

test.each(["{ not json", "[]", "{}", "42", "<console_output>"])("%p has nothing to unpack and stays as it was", (line) => {
  expect(readableOutput(line)).toBe(line);
});
