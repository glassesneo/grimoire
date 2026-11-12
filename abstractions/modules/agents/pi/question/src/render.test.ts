import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import registerQuestion from "./extension.ts";
import { renderQuestionHistory, type RenderQuestion, type RenderResponse } from "./render.ts";

// The renderer owns which question/answer information remains readable after submission.
// Pi validates tool arguments, but cannot validate this repository's projection or layout.
// Observe information and terminal columns, not complete lines, decoration, or private state.
export default function verifyQuestionHistory(): void {
  const question: RenderQuestion = {
    id: "destination",
    prompt: "Where next?",
    kind: "single",
    options: [
      { value: "mountain", label: "Mountain", description: "Walk above the valley" },
      { value: "coast", label: "Coast", description: "Stay near the sea" },
    ],
  };
  const render = (response: RenderResponse | undefined, expanded: boolean, status = "submitted") =>
    renderQuestionHistory({
      questions: [question],
      details: { status, responses: response ? { destination: response } : {} },
      expanded,
      width: 80,
    }).join("\n");

  // Given confirmed answers, the collapsed transcript exposes the user's choices and notes.
  for (const response of [
    { kind: "single", value: "mountain", note: "bring boots" },
    { kind: "multi", values: [{ value: "mountain", note: "bring boots" }], writeIn: "River" },
  ] satisfies RenderResponse[]) {
    const text = render(response, false);
    assert.ok(
      text.includes(question.prompt) && text.includes("Mountain") && text.includes("bring boots"),
    );
    assert.ok(!text.includes("Coast") && !text.includes("Walk above the valley"));
  }
  assert.ok(render({ kind: "write-in", value: "River" }, false).includes("River"));
  assert.ok(render({ kind: "text", value: "Take the train" }, false).includes("Take the train"));

  // Given any answer state, expanding a choice question exposes every original option and description.
  for (const response of [
    undefined,
    { kind: "single", value: "coast" },
    { kind: "multi", values: [], writeIn: "River" },
    { kind: "write-in", value: "River" },
  ] satisfies (RenderResponse | undefined)[]) {
    for (const status of ["submitted", "cancelled"]) {
      const text = render(response, true, status);
      assert.ok(text.includes(question.prompt));
      for (const option of question.options!) {
        assert.ok(text.includes(option.label) && text.includes(option.description!));
      }
      if (response?.kind === "write-in" || response?.kind === "multi")
        assert.ok(text.includes("River"));
      if (!response) assert.match(text, /unanswered/i);
    }
  }
  const cancelled = render({ kind: "single", value: "coast" }, false, "cancelled");
  assert.match(cancelled, /cancel/i);
  assert.ok(cancelled.includes("Coast"));
  assert.match(render(undefined, false, "unavailable"), /unavailable/i);
  assert.match(render(undefined, false, "error"), /fail/i);

  // Given a failed execution, Pi passes the standard error result; its cause stays readable.
  let tool: any;
  registerQuestion({ registerTool: (definition: unknown) => (tool = definition) } as any);
  const failure = tool
    .renderResult(
      { content: [{ type: "text", text: "Question id must be unique: q" }], details: {} },
      { isPartial: false, expanded: false },
      {},
      { args: { questions: [] }, isError: true },
    )
    .render(80)
    .join("\n");
  assert.ok(failure.includes("Question id must be unique: q"), failure);

  // Given multilingual multiline content, resizing preserves its readable information within each row.
  const prompt = "行き先はどこ？🗻";
  const answer = "海岸へ行く👨‍👩‍👧‍👦\ne\u0301と山を選ぶ";
  for (const width of [8, 17, 80]) {
    const lines = renderQuestionHistory({
      questions: [{ id: "route", kind: "text", prompt }],
      details: { status: "submitted", responses: { route: { kind: "text", value: answer } } },
      expanded: false,
      width,
    });
    // Rendered rows must not contain line breaks or escape sequences.
    // oxlint-disable-next-line no-control-regex
    assert.ok(lines.every((line) => visibleWidth(line) <= width && !/[\r\n\u001b]/.test(line)));
    const information = lines.join("").replace(/\s/g, "");
    assert.ok(information.includes(prompt));
    assert.ok(information.includes(answer.replace(/\s/g, "")));
  }
  console.log("question history contract verified");
}
