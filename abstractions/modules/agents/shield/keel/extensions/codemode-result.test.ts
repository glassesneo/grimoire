// A marked line tells the reader where a script failed, so a wrong mark misleads. These
// cases are constructed in the format of pi 1.1.0's codemode results; real failing runs
// through the keel runtime are checked by shield's inline process case.
import { expect, test } from "bun:test";
import {
  codemodeErrorLocation,
  codemodeOutput,
  codemodeWallTime,
  readableOutput,
} from "./codemode-result";

const text = (value: string) => ({ type: "text" as const, text: value });
const failed = (error: string, output = "") => [
  text("Script failed\nWall time 0.4 seconds\nOutput:\n"),
  text(
    `${output}${output ? "\n" : ""}Script error:\n${error}\n\nTool calls made before the failure (they are not undone): read (ok)`,
  ),
];

test("a failure's frame names the submitted line, and only an existing one", () => {
  const code = "const a = 1;\nnull.missing;\nreturn a;";
  const content = failed(
    "TypeError: cannot read property 'missing' of null\n    at <anonymous> (codemode.js:2:1)",
  );
  expect(codemodeErrorLocation(code, { content, isError: true })).toEqual({
    kind: "located",
    line: 2,
  });
  const beyond = failed("Error: x\n    at f (codemode.js:9:3)");
  expect(codemodeErrorLocation(code, { content: beyond, isError: true })?.kind).toBe("unlocated");
  expect(codemodeErrorLocation(code, { content: [text("anything")], isError: true })).toEqual({
    kind: "unrecognized",
  });
  expect(codemodeErrorLocation(code, { content, isError: false })).toBeUndefined();
});

test("timeouts and aborts are failures without a line", () => {
  const content = failed("Script timed out: after 30 seconds");
  expect(codemodeErrorLocation("x", { content, isError: true })).toEqual({ kind: "unlocated" });
});

test("the output is split from the appended error, and the wall time is read from the header", () => {
  const content = failed("Error: boom\n    at codemode.js:1:1", "printed before");
  const output = codemodeOutput(content);
  expect(output.header).toBe("Script failed\nWall time 0.4 seconds");
  expect(output.output).toBe("printed before");
  expect(output.error).toStartWith("Error: boom");
  expect(codemodeWallTime(content)).toBe("0.4s");
  // A completed script that prints the same words has no error.
  const completed = codemodeOutput([
    text("Script completed\nWall time 1 seconds\nOutput:\n"),
    text("Script error:\nnot really\n\nNo tool calls were made."),
  ]);
  expect(completed.error).toBeUndefined();
});

test("JSON lines read as the strings inside them", () => {
  expect(readableOutput('{"output":"line\\n","exit_code":0}\nplain')).toBe(
    "line\nexit_code 0\nplain",
  );
  expect(readableOutput("[not json")).toBe("[not json");
});
