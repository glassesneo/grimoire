import assert from "node:assert/strict";
import { test } from "node:test";
import { completePrefix } from "./paragraphs.ts";

const cut = (text: string) => text.slice(0, completePrefix(text));

void test("a paragraph is complete once the next one has begun, so the last one never is", () => {
  assert.equal(cut("First paragraph."), "");
  assert.equal(cut("First paragraph.\n\n"), "");
  assert.equal(cut("First paragraph.\n\nSecond is still stre"), "First paragraph.\n\n");
  assert.equal(cut("One.\n\nTwo, a longer one.\n\nThree"), "One.\n\nTwo, a longer one.\n\n");
});

void test("a next block whose first line could still become a list or heading completes nothing", () => {
  assert.equal(cut("Intro text.\n\n1"), "");
  assert.equal(cut("Intro text.\n\n- a"), "");
  assert.equal(cut("Intro text.\n\n- an item\n"), "Intro text.\n\n");
});

void test("a heading stays with the unit after it", () => {
  assert.equal(
    cut("## Title\n\nBody of the section.\n\nNext paragraph"),
    "## Title\n\nBody of the section.\n\n",
  );
  assert.equal(cut("## Title\n\nBody of the section"), "");
});

void test("list and table blocks separated by blank lines form one unit until other text begins", () => {
  const list = "- one\n\n- two\n\n";
  assert.equal(cut(list + "- three\n"), "");
  assert.equal(cut(list + "After the list."), list);
  const table = "| a | b |\n|---|---|\n\n| 1 | 2 |\n\n";
  assert.equal(cut(table + "| 3 | 4 |\n"), "");
  assert.equal(cut(table + "Done here."), table);
});

void test("blank lines inside a code fence do not end it, and an open fence completes nothing after it", () => {
  const code = "```js\nconst a = 1;\n\nconst b = 2;\n```\n\n";
  assert.equal(cut("Before.\n\n" + code.slice(0, 26)), "Before.\n\n");
  assert.equal(cut("Before.\n\n" + code + "After the code."), "Before.\n\n" + code);
});
