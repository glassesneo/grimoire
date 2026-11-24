type Kind = "heading" | "list" | "table" | "other";
type Block = { readonly start: number; readonly kind: Kind | undefined };

const fence = /^\s*(```|~~~)/;

function kindOf(line: string, whole: boolean): Kind | undefined {
  const text = line.trimStart();
  if (!whole && text.length < 4) return undefined;
  if (/^#{1,6}\s/.test(text)) return "heading";
  if (/^([-*+]|\d+[.)])\s/.test(text)) return "list";
  if (text.startsWith("|")) return "table";
  return "other";
}

function blocks(text: string): Block[] {
  const found: Block[] = [];
  let offset = 0;
  let inFence = false;
  let previousBlank = true;
  for (const line of text.split("\n")) {
    const whole = offset + line.length < text.length;
    const blank = line.trim() === "";
    if (!inFence && !blank && previousBlank)
      found.push({ start: offset, kind: kindOf(line, whole) });
    if (fence.test(line) && whole) inFence = !inFence;
    previousBlank = blank && !inFence;
    offset += line.length + 1;
  }
  return found;
}

const joins = (previous: Kind | undefined, next: Kind | undefined) =>
  previous === "heading" || ((previous === "list" || previous === "table") && next === previous);

export function completePrefix(text: string): number {
  const found = blocks(text);
  let end = 0;
  for (let index = 1; index < found.length; index++) {
    const previous = found[index - 1];
    const next = found[index];
    if (!previous || !next || next.kind === undefined) break;
    if (!joins(previous.kind, next.kind)) end = next.start;
  }
  return end;
}
