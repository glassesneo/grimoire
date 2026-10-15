// Incremental parsing must not change the selectable prose/code blocks as fences arrive.
import { expect, test } from "bun:test";
import { splitFencedBlocks, StreamingFences } from "./pi-content";

test("streamed fences match complete parsing at every prefix and after replacement", () => {
  const sources = [
    "before\n\n```ts\nconst x = 1;\n```\nafter\n~~~python\nprint(1)\n~~~~\n",
    "\n```` js\na\n```\nb\n````\n\ntext",
    "```\n```x\n```\n",
    "ordinary replacement\nwith no fence",
    "",
  ];
  for (const source of sources) {
    const stream = new StreamingFences();
    for (let end = 0; end <= source.length; end++) {
      const prefix = source.slice(0, end);
      expect(stream.split(prefix)).toEqual(splitFencedBlocks(prefix, { openFences: true }));
    }
    for (const replacement of sources) expect(stream.split(replacement)).toEqual(splitFencedBlocks(replacement, { openFences: true }));
  }
});
