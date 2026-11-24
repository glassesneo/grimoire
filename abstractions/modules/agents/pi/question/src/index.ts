import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  validateQuestionParameters,
  type DecisionFlowPolicy,
  type DecisionNotePresentation,
  type DecisionNoteRequirement,
  type QuestionItem,
  type QuestionOption,
  type QuestionResponse,
  type QuestionResultDetails,
} from "./internal/core.ts";
import {
  loadDecisionUiConfig,
  validateDecisionUiConfig,
  type DecisionUiConfig,
} from "./internal/config.ts";
import type { DecisionKeybindingOverrides } from "./internal/keymap.ts";
import { runStandardDecisionFlow } from "./internal/standard-ui.ts";
import { runTuiDecisionFlow } from "./internal/tui.ts";

export type DecisionKind = "single" | "multi" | "text";
export type DecisionOption = QuestionOption;
export type DecisionItem = QuestionItem;
export type DecisionResponse = QuestionResponse;
export type DecisionResult = QuestionResultDetails;
export type {
  DecisionFlowPolicy,
  DecisionNotePresentation,
  DecisionNoteRequirement,
  DecisionUiConfig,
  DecisionKeybindingOverrides,
};

export interface DecisionFlowOptions {
  signal?: AbortSignal;
  policy?: DecisionFlowPolicy;
  config?: DecisionUiConfig | false;
}

export async function runDecisionFlow(
  ctx: Pick<ExtensionContext, "mode" | "hasUI" | "ui">,
  items: readonly DecisionItem[],
  options: DecisionFlowOptions = {},
): Promise<DecisionResult> {
  validateQuestionParameters({ questions: [...items] });
  if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc"))
    return { status: "unavailable", responses: {} };
  const loaded =
    options.config === false
      ? {
          config: { schemaVersion: 1, keybindings: {} } as DecisionUiConfig,
          path: "disabled configuration",
        }
      : options.config === undefined
        ? loadDecisionUiConfig()
        : {
            config: validateDecisionUiConfig(options.config, "provided configuration"),
            path: "provided configuration",
          };
  if (ctx.mode === "rpc")
    return runStandardDecisionFlow(
      { hasUI: ctx.hasUI, ui: ctx.ui },
      items,
      options.signal,
      options.policy,
    );
  return runTuiDecisionFlow(ctx, items, options.signal, options.policy, loaded.config, loaded.path);
}
