// quin departs from the harness here: an expanded item that shows children is not selectable.
import { expect, test } from "bun:test";
import { ItemTypeRegistry, materializeItem, type ItemType } from "./controllers";

const type: ItemType<null> = { kind: "node", render: () => null, expandable: () => true, sourceText: () => undefined, actions: {} };
// a ─ b ─ c        d (no children)
//   └ e
const tree: [string, string | undefined][] = [["a", undefined], ["b", "a"], ["c", "b"], ["e", "a"], ["d", undefined]];
const parents = ["a", "b"];

function registry(expanded: Set<string>) {
  const timeline = new ItemTypeRegistry();
  timeline.registerType(type);
  timeline.replace(tree.map(([id, parentId]) => materializeItem({ id, version: 0, type, value: null, parentId })));
  for (const id of expanded) { timeline.setCursor(id); timeline.expand(); }
  return timeline;
}

/** Every disclosure of the tree's parents, reached by expanding from the top. */
const disclosures = [[], ["a"], ["a", "b"]].map((ids) => new Set(ids));

test("the cursor rests only on visible items that are collapsed or show no children", () => {
  for (const expanded of disclosures) {
    const timeline = registry(expanded);
    const expected = timeline.visibleItems().map((item) => item.id).filter((id) => !(expanded.has(id) && parents.includes(id)));
    expect(timeline.selectableItems().map((item) => item.id)).toEqual(expected);
    // Moving through the timeline visits exactly those items, in order.
    timeline.setCursor(expected[0]!);
    const visited = [timeline.cursor()];
    for (let step = 1; step < expected.length + 2; step++) { timeline.moveCursor(1); if (timeline.cursor() !== visited.at(-1)) visited.push(timeline.cursor()); }
    expect(visited).toEqual(expected);
    for (const id of parents.filter((id) => expanded.has(id))) expect(timeline.setCursor(id)).toBe(false);
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
  const timeline = new ItemTypeRegistry();
  timeline.registerType(type);
  const node = (id: string, parentId?: string) => materializeItem({ id, version: 0, type, value: null, parentId });
  timeline.replace([node("a")]);
  timeline.setCursor("a");
  timeline.expand();
  expect(timeline.cursor()).toBe("a");
  timeline.replace([node("a"), node("b", "a")]);
  expect(timeline.cursor()).toBe("b");
});
