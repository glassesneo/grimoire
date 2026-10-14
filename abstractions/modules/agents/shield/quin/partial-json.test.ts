// A streamed call's arguments are shown from every prefix of their JSON, so no prefix may throw or invent a value.
import { expect, test } from "bun:test";
import { parsePartialJson } from "./partial-json";

test("every prefix of an argument object parses to what has arrived so far", () => {
  const text = JSON.stringify({ code: 'const a = "x\\n";\nawait tools.read({ path: "a" });', n: 12, list: [1, { deep: true }], none: null });
  for (let end = 0; end <= text.length; end++) {
    const value = parsePartialJson(text.slice(0, end));
    if (end > 0) expect(typeof value).toBe("object");
  }
  expect(parsePartialJson(text)).toEqual(JSON.parse(text));
});

test("an open string keeps its text, and unfinished keys, literals, and separators are dropped", () => {
  expect(parsePartialJson('{"code": "let x')).toEqual({ code: "let x" });
  expect(parsePartialJson('{"code": "a\\')).toEqual({ code: "a" });
  expect(parsePartialJson('{"a": 1, "b')).toEqual({ a: 1 });
  expect(parsePartialJson('{"a": 1,')).toEqual({ a: 1 });
  expect(parsePartialJson('{"a": tr')).toEqual({});
  expect(parsePartialJson('{"a": [1, 2')).toEqual({ a: [1, 2] });
  expect(parsePartialJson("")).toBeUndefined();
});
