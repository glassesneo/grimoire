import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { questionParameters } from "./internal/core.ts";
import { runDecisionFlow } from "./index.ts";
import {
  renderQuestionFailure,
  renderQuestionHistory,
  type RenderDetails,
  type RenderQuestion,
} from "./render.ts";

// Nothing is cached, so a theme change has nothing to invalidate.
function component(lines: (width: number) => string[]) {
  return { render: lines, invalidate() {} };
}

export default function registerQuestion(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "question",
      label: "Question",
      description:
        "Ask the user for a decision or missing information. A write-in is an answer. A question id with no response was not answered. Cancellation and an unavailable UI leave the decision unresolved.",
      parameters: questionParameters,
      exposure: "model-only",
      executionMode: "sequential",
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const details = await runDecisionFlow(ctx, params.questions, { signal, config: false });
        return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
      },
      renderCall() {
        return component(() => []);
      },
      renderResult(result, options, _theme, context) {
        if (options.isPartial) return component(() => []);
        if (context.isError) {
          const message = result.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n");
          return component((width) => renderQuestionFailure(message, width));
        }
        return component((width) =>
          renderQuestionHistory({
            questions: context.args.questions as readonly RenderQuestion[],
            details: result.details as RenderDetails,
            expanded: options.expanded,
            width,
          }),
        );
      },
    }),
  );
}
