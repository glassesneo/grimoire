import {
  replaceControlCharacters,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type RenderKind = "single" | "multi" | "text";

export interface RenderOption {
  value: string;
  label: string;
  description?: string;
}

export interface RenderQuestion {
  id: string;
  prompt: string;
  kind: RenderKind;
  options?: readonly RenderOption[];
}

export type RenderResponse =
  | { kind: "single"; value: string; note?: string }
  | { kind: "multi"; values: ReadonlyArray<{ value: string; note?: string }>; writeIn?: string }
  | { kind: "text"; value: string }
  | { kind: "write-in"; value: string };

export interface RenderDetails {
  status: string;
  responses: Readonly<Record<string, RenderResponse>>;
}

export function choiceMarker(kind: "single" | "multi", selected: boolean): string {
  if (kind === "multi") return selected ? "[x]" : "[ ]";
  return selected ? "(●)" : "( )";
}

export function choiceText(kind: "single" | "multi", selected: boolean, label: string): string {
  return `${choiceMarker(kind, selected)} ${label}`;
}

/** Colors the extension applies; the record stays readable without them. */
export interface HistoryStyle {
  /** Colors the left rule that sets the record apart from model output. */
  rule: (text: string) => string;
  /** Emphasizes question prompts. */
  prompt: (text: string) => string;
}

const plain: HistoryStyle = { rule: (text) => text, prompt: (text) => text };
const rule = "▎";

// Draws the body one rule and one space narrower, then prefixes every row with the rule.
function ruled(width: number, style: HistoryStyle, body: (width: number) => string[]): string[] {
  if (width < 3) return body(width);
  return body(width - 2).map((line) => `${style.rule(rule)} ${line}`);
}

function push(
  lines: string[],
  width: number,
  text: string,
  indent = "",
  paint: (text: string) => string = (line) => line,
): void {
  if (width <= 0) return;
  const prefix = truncateToWidth(indent, Math.max(0, width - 1), "");
  const available = width - visibleWidth(prefix);
  const safe = text
    .split(/\r\n|\r|\n/)
    .map(replaceControlCharacters)
    .join("\n");
  for (const line of wrapTextWithAnsi(safe, available)) {
    lines.push(prefix + paint(truncateToWidth(line, available, "")));
  }
}

function isSelected(response: RenderResponse | undefined, value: string): boolean {
  if (response?.kind === "single") return response.value === value;
  if (response?.kind === "multi") return response.values.some((item) => item.value === value);
  return false;
}

function noteFor(response: RenderResponse | undefined, value: string): string | undefined {
  if (response?.kind === "single" && response.value === value) return response.note;
  if (response?.kind === "multi") return response.values.find((item) => item.value === value)?.note;
  return undefined;
}

function optionKind(question: RenderQuestion): "single" | "multi" {
  return question.kind === "multi" ? "multi" : "single";
}

/** A failed execution has no question details; its message carries the cause. */
export function renderQuestionFailure(
  message: string,
  width: number,
  style: HistoryStyle = plain,
): string[] {
  return ruled(width, style, (inner) => {
    const lines: string[] = [];
    push(lines, inner, `Failed: ${message.trim() || "unknown error"}`);
    return lines;
  });
}

/**
 * History drawn from the question arguments and the confirmed result.
 * The live prompt UI uses the same choice markers. This view has no cursor and no key hints.
 */
export function renderQuestionHistory(input: {
  questions: readonly RenderQuestion[];
  details: RenderDetails;
  expanded: boolean;
  width: number;
  style?: HistoryStyle;
}): string[] {
  const style = input.style ?? plain;
  return ruled(input.width, style, (width) => historyLines(input, width, style));
}

function historyLines(
  input: { questions: readonly RenderQuestion[]; details: RenderDetails; expanded: boolean },
  width: number,
  style: HistoryStyle,
): string[] {
  const lines: string[] = [];
  const { details, expanded } = input;
  if (details.status === "unavailable") {
    push(lines, width, "Unavailable");
    return lines;
  }
  if (details.status !== "submitted" && details.status !== "cancelled") {
    push(lines, width, `Failed: ${details.status}`);
    return lines;
  }
  if (details.status === "cancelled") push(lines, width, "Cancelled");
  for (const question of input.questions) {
    push(lines, width, question.prompt, "", style.prompt);
    const response = details.responses[question.id];
    const options = question.options ?? [];
    const known = new Set(options.map((option) => option.value));
    const visible = expanded
      ? options
      : options.filter((option) => isSelected(response, option.value));
    for (const option of visible) {
      const kind = optionKind(question);
      push(lines, width, choiceText(kind, isSelected(response, option.value), option.label), "  ");
      if (expanded && option.description?.trim()) push(lines, width, option.description, "    ");
      const note = noteFor(response, option.value);
      if (note) push(lines, width, `note: ${note}`, "    ");
    }
    if (response === undefined) {
      push(lines, width, "Unanswered", "  ");
    } else if (response.kind === "text") {
      push(lines, width, response.value, "  ");
    } else if (response.kind === "write-in") {
      push(
        lines,
        width,
        choiceText(optionKind(question), true, `Write-in: ${response.value}`),
        "  ",
      );
    } else if (response.kind === "single" && !known.has(response.value)) {
      push(lines, width, choiceText("single", true, `Write-in: ${response.value}`), "  ");
      if (response.note) push(lines, width, `note: ${response.note}`, "    ");
    }
    if (response?.kind === "multi" && response.writeIn !== undefined) {
      push(lines, width, choiceText("multi", true, `Write-in: ${response.writeIn}`), "  ");
    }
  }
  return lines;
}
