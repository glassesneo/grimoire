import { expect, test } from "bun:test";
import { engine } from "@opentui/core";
import { TimelineTree, materializeItem, type ItemType } from "./controllers";
import { createItemActions } from "./item-actions";

const type: ItemType<null> = {
  kind: "node",
  render: () => null,
  expandable: () => true,
  sourceText: () => undefined,
};
// a ─ b ─ c        d (no children)
//   └ e
const tree: [string, string | undefined][] = [
  ["a", undefined],
  ["b", "a"],
  ["c", "b"],
  ["e", "a"],
  ["d", undefined],
];
const parents = ["a", "b"];

function registry(expanded: Set<string>) {
  const timeline = new TimelineTree();
  timeline.replace(
    tree.map(([id, parentId]) => materializeItem({ id, version: 0, type, value: null, parentId })),
  );
  for (const id of expanded) {
    timeline.setCursor(id);
    timeline.expand();
  }
  return timeline;
}

/** Every disclosure of the tree's parents, reached by expanding from the top. */
const disclosures = [[], ["a"], ["a", "b"]].map((ids) => new Set(ids));

test("the cursor rests only on visible items that are collapsed or show no children", () => {
  for (const expanded of disclosures) {
    const timeline = registry(expanded);
    const expected = timeline
      .visibleItems()
      .map((item) => item.id)
      .filter((id) => !(expanded.has(id) && parents.includes(id)));
    expect(timeline.selectableItems().map((item) => item.id)).toEqual(expected);
    // Moving through the timeline visits exactly those items, in order.
    timeline.setCursor(expected[0]!);
    const visited = [timeline.cursor()];
    for (let step = 1; step < expected.length + 2; step++) {
      timeline.moveCursor(1);
      if (timeline.cursor() !== visited.at(-1)) visited.push(timeline.cursor());
    }
    expect(visited).toEqual(expected);
    for (const id of parents.filter((id) => expanded.has(id)))
      expect(timeline.setCursor(id)).toBe(false);
  }
});

test("expanding moves the cursor into the item, and collapsing from inside returns it", () => {
  const timeline = registry(new Set());
  timeline.setCursor("a");
  timeline.expand();
  expect(timeline.cursor()).toBe("b");
  timeline.expand();
  expect(timeline.cursor()).toBe("c");
  // Each collapse closes the nearest expanded ancestor and selects it.
  timeline.collapse();
  expect(timeline.cursor()).toBe("b");
  timeline.collapse();
  expect(timeline.cursor()).toBe("a");
  expect(timeline.isExpanded("a")).toBe(false);
});

test("an expanded item that gains its first child hands the cursor to it", () => {
  const timeline = new TimelineTree();
  const node = (id: string, parentId?: string) =>
    materializeItem({ id, version: 0, type, value: null, parentId });
  timeline.replace([node("a")]);
  timeline.setCursor("a");
  timeline.expand();
  expect(timeline.cursor()).toBe("a");
  timeline.replace([node("a"), node("b", "a")]);
  expect(timeline.cursor()).toBe("b");
});

test("cursor navigation resumes following at the scroll end but anchors earlier items", async () => {
  const timeline = new TimelineTree();
  const nodes = Array.from({ length: 30 }, (_, i) =>
    materializeItem({ id: `x${i}`, version: 0, type, value: null }),
  );
  timeline.replace(nodes);
  const overlay = 3;
  let growth = 0;
  const box = {
    scrollTop: 0,
    height: 10,
    y: 0,
    get scrollHeight() {
      return nodes.length + growth + overlay;
    },
    getRenderable(id: string) {
      const index = nodes.findIndex((item) => item.id === id);
      return index === -1
        ? undefined
        : { y: index - box.scrollTop, height: index === nodes.length - 1 ? 1 + growth : 1 };
    },
  };
  const actions = createItemActions({
    timeline,
    scrollbox: () => box,
    overlayHeight: () => overlay,
  });
  try {
    actions.frame();
    timeline.setCursor("x29");
    actions.move(-10);
    engine.update(200);
    actions.frame();
    const reading = box.scrollTop;
    growth += 2;
    actions.frame();
    expect(box.scrollTop).toBe(reading);

    actions.move(10);
    engine.update(200);
    actions.frame();
    expect(box.scrollTop).toBe(box.scrollHeight - box.height);
    growth += 2;
    actions.frame();
    expect(box.scrollTop).toBe(box.scrollHeight - box.height);

    growth = 0;
    actions.frame();
    actions.move(1);
    growth += 2;
    actions.frame();
    expect(box.scrollTop).toBe(box.scrollHeight - box.height);
  } finally {
    await actions.dispose();
  }
});

test("expanding the last item scrolls the child the cursor moves to into view", () => {
  const timeline = new TimelineTree();
  const node = (id: string, parentId?: string) =>
    materializeItem({ id, version: 0, type, value: null, parentId });
  timeline.replace([
    ...Array.from({ length: 30 }, (_, i) => node(`x${i}`)),
    node("p"),
    node("p1", "p"),
    node("p2", "p"),
  ]);
  // One row per visible item, and blank rows below as tall as the overlay, as the view lays them out.
  const overlay = 3;
  const box = {
    scrollTop: 0,
    height: 10,
    y: 0,
    get scrollHeight() {
      return timeline.visibleItems().length + overlay;
    },
    getRenderable(id: string) {
      const index = timeline.visibleItems().findIndex((item) => item.id === id);
      return index === -1 ? undefined : { y: index - box.scrollTop, height: 1 };
    },
  };
  const actions = createItemActions({
    timeline,
    scrollbox: () => box,
    overlayHeight: () => overlay,
  });
  const shown = (id: string) => {
    const top = box.getRenderable(id)!.y;
    return top >= 0 && top < box.height - overlay;
  };
  actions.frame();
  timeline.setCursor("p");
  expect(shown("p")).toBe(true);
  actions.expand();
  actions.frame();
  expect(timeline.cursor()).toBe("p1");
  expect(shown("p1")).toBe(true);
  expect(shown("p")).toBe(true);
});
