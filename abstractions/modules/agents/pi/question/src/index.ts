/*
Copyright (c) 2026 glassesneo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

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
  /** Omit to load the optional agent configuration; false disables file loading. */
  config?: DecisionUiConfig | false;
}

/**
 * Collect user-owned decisions through Pi's native TUI or RPC dialogs.
 * Invalid items are rejected before any UI is opened.
 */
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
