/**
 * Admission: a marked line tells the reader where a script failed, so a wrong
 * mark misleads. The parser reads pi's formatted result text, which pi does
 * not specify, so the cases come from the pinned runtime: one real failing run
 * keeps the format honest, and constructed results cover the rest.
 */
import { expect, test } from "bun:test";
import { CodemodeSandbox, loadQuickJSWasm, parseCodemodeSource } from "@earendil-works/pi-codemode";
import type { TextContent } from "@earendil-works/pi-ai";
import { codemodeErrorLocation, codemodeOutput } from "./codemode-result";

const header = { type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" } as const;
const failure = (error: string, ...output: string[]) => ({
  isError: true,
  content: [
    header,
    ...output.map((text): TextContent => ({ type: "text", text })),
    { type: "text", text: `Script error:\n${error}\n\nNo tool calls were made.` } as const,
  ],
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

test("a completed script's own text is output, even when it looks like an error item", () => {
  const output = codemodeOutput([
    { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
    { type: "text", text: "Script error:\nprinted by the script" },
  ]);
  expect(output.error).toBeUndefined();
  expect(output.output).toBe("Script error:\nprinted by the script");
});
