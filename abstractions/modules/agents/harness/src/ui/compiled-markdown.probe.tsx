// A headless probe compiled by compiled-markdown.test.ts with the harness's
// build options: it renders the timeline's Markdown and code renderables and
// asks the tree-sitter worker to highlight, then prints what it observed.
import { getTreeSitterClient } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { CodeBlock, Markdown } from "./timeline-types";

const setup = await testRender(
  () => (
    <box flexDirection="column">
      <Markdown text={"# Title\n\nSome **bold** prose.\n\n```ts\nconst probe: number = 1;\n```"} />
      <CodeBlock language="javascript" body="let other = 2;" />
    </box>
  ),
  { width: 50, height: 16 },
);
for (let frame = 0; frame < 10; frame++) {
  await Bun.sleep(50);
  await setup.flush();
  await setup.renderOnce();
}
const highlights = await getTreeSitterClient().highlightOnce(
  "const value: number = 1;",
  "typescript",
);
console.log(
  JSON.stringify({
    frame: setup.captureCharFrame(),
    highlights: highlights.highlights?.length ?? 0,
    error: highlights.error,
  }),
);
setup.renderer.destroy();
process.exit(0);
