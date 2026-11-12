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

import { matchesKey, type KeyId } from "@earendil-works/pi-tui";

export const decisionKeybindingActions = [
  "common.next-question",
  "common.previous-question",
  "common.back",
  "common.cancel",
  "choice.accept",
  "choice.move-up",
  "choice.move-down",
  "choice.toggle",
  "choice.select-and-note",
  "choice.write-in",
  "editor.clear",
  "review.accept",
  "review.move-up",
  "review.move-down",
  "text.accept",
  "text.newline",
] as const;
export type DecisionKeybindingAction = (typeof decisionKeybindingActions)[number];
export type DecisionKeybindingOverrides = Partial<
  Record<DecisionKeybindingAction, readonly string[]>
>;

export const questionContexts = [
  "question.single",
  "question.multi",
  "question.text",
  "question.note",
  "question.write-in",
  "question.review",
  "question.common",
] as const;
export type QuestionContext = (typeof questionContexts)[number];
export const uiActions = [
  "accept",
  "newline",
  "next-question",
  "previous-question",
  "back",
  "cancel",
  "clear",
  "move-up",
  "move-down",
  "toggle",
  "select-and-note",
  "write-in",
] as const;
export type UiAction = (typeof uiActions)[number];
export type ResolvedQuestionKeymap = Record<QuestionContext, Partial<Record<UiAction, KeyId[]>>>;
export interface InjectedKeybindings {
  getKeys(action: string): readonly string[];
}

const modifierOrder = ["ctrl", "shift", "alt", "super"] as const;
const namedKey =
  /^(escape|esc|enter|return|tab|space|backspace|delete|insert|clear|home|end|pageUp|pageDown|up|down|left|right|f(?:[1-9]|1[0-2])|[`\-=[\]\\;',./!@#$%^&*()_+|~{}:<>?])$/;
export function isValidKeyId(key: string): boolean {
  const parts = key.split("+");
  if (parts.some((part) => part.length === 0)) return false;
  const modifiers = parts.slice(0, -1);
  return (
    new Set(modifiers).size === modifiers.length &&
    modifiers.every((value) => modifierOrder.includes(value as (typeof modifierOrder)[number])) &&
    (/^[a-z0-9]$/.test(parts.at(-1)!) || namedKey.test(parts.at(-1)!))
  );
}
function canonicalSyntax(key: string): string {
  const parts = key.split("+");
  const modifiers = parts
    .slice(0, -1)
    .sort((a, b) => modifierOrder.indexOf(a as never) - modifierOrder.indexOf(b as never));
  const base = { esc: "escape", return: "enter" }[parts.at(-1)!] ?? parts.at(-1)!;
  return [...modifiers, base].join("+");
}
function rawControlCode(base: string): number | undefined {
  if (/^[a-z]$/.test(base)) return base.charCodeAt(0) & 0x1f;
  if (base === "[") return 27;
  if (base === "\\") return 28;
  if (base === "]") return 29;
  if (base === "-" || base === "_") return 31;
  if (base === "space") return 0;
  return undefined;
}
function collisionSignatures(key: KeyId): ReadonlySet<string> {
  const normalized = canonicalSyntax(key);
  const parts = normalized.split("+");
  const modifiers = parts.slice(0, -1);
  const base = parts.at(-1)!;
  const signatures = new Set([`key:${normalized}`]);
  if (modifiers.length === 0) {
    const rawCodes: Partial<Record<string, number[]>> = {
      backspace: [8, 127],
      enter: [10, 13],
      escape: [27],
      space: [32],
      tab: [9],
    };
    for (const code of rawCodes[base] ?? []) signatures.add(`raw:${code}`);
  } else if (modifiers.length === 1 && modifiers[0] === "ctrl") {
    const code = rawControlCode(base);
    if (code !== undefined) signatures.add(`raw:${code}`);
  } else if (modifiers.length === 1 && modifiers[0] === "alt") {
    const rawCodes: Partial<Record<string, number[]>> = {
      backspace: [8, 127],
      enter: [13],
      space: [32],
    };
    for (const code of rawCodes[base] ?? []) signatures.add(`raw:27,${code}`);
  } else if (modifiers.length === 2 && modifiers[0] === "ctrl" && modifiers[1] === "alt") {
    const code = rawControlCode(base);
    if (code !== undefined) signatures.add(`raw:27,${code}`);
  }
  return signatures;
}
function keysOverlap(left: KeyId, right: KeyId): boolean {
  const rightSignatures = collisionSignatures(right);
  return [...collisionSignatures(left)].some((signature) => rightSignatures.has(signature));
}
function isIntentionalEnterNewlineOverlap(
  entries: ReadonlyArray<{ action: UiAction; key: KeyId }>,
): boolean {
  return (
    entries.length === 2 &&
    entries.some((entry) => entry.action === "accept" && canonicalSyntax(entry.key) === "enter") &&
    entries.some((entry) => entry.action === "newline" && canonicalSyntax(entry.key) === "ctrl+j")
  );
}
export function keyLabel(key: string): string {
  return key
    .split("+")
    .map(
      (part) =>
        ({
          ctrl: "Ctrl",
          shift: "Shift",
          alt: "Alt",
          super: "Super",
          escape: "Esc",
          enter: "Enter",
          space: "Space",
        })[part] ?? (part.length === 1 ? part.toUpperCase() : part),
    )
    .join("+");
}

const fallback: Record<DecisionKeybindingAction, KeyId[]> = {
  "common.next-question": ["ctrl+f"],
  "common.previous-question": ["ctrl+b"],
  "common.back": ["escape"],
  "common.cancel": ["ctrl+c"],
  "choice.accept": ["enter"],
  "choice.move-up": ["up"],
  "choice.move-down": ["down"],
  "choice.toggle": ["space"],
  "choice.select-and-note": ["e"],
  "choice.write-in": ["shift+enter", "alt+enter"],
  "editor.clear": ["ctrl+c"],
  "review.accept": ["enter"],
  "review.move-up": ["up"],
  "review.move-down": ["down"],
  "text.accept": ["enter"],
  "text.newline": ["shift+enter", "alt+enter"],
};
const injectedAction: Partial<Record<DecisionKeybindingAction, string>> = {
  "choice.accept": "tui.select.confirm",
  "review.accept": "tui.select.confirm",
  "choice.move-up": "tui.select.up",
  "review.move-up": "tui.select.up",
  "choice.move-down": "tui.select.down",
  "review.move-down": "tui.select.down",
  "text.accept": "tui.input.submit",
  "text.newline": "tui.input.newLine",
  "common.cancel": "app.clear",
  "editor.clear": "app.clear",
  "common.back": "tui.select.cancel",
};
const actionContexts: Record<DecisionKeybindingAction, Array<[QuestionContext, UiAction]>> = {
  "common.next-question": [["question.common", "next-question"]],
  "common.previous-question": [["question.common", "previous-question"]],
  "common.back": [["question.common", "back"]],
  "common.cancel": [["question.common", "cancel"]],
  "choice.accept": [
    ["question.single", "accept"],
    ["question.multi", "accept"],
  ],
  "choice.move-up": [
    ["question.single", "move-up"],
    ["question.multi", "move-up"],
  ],
  "choice.move-down": [
    ["question.single", "move-down"],
    ["question.multi", "move-down"],
  ],
  "choice.toggle": [
    ["question.single", "toggle"],
    ["question.multi", "toggle"],
  ],
  "choice.select-and-note": [
    ["question.single", "select-and-note"],
    ["question.multi", "select-and-note"],
  ],
  "choice.write-in": [
    ["question.single", "write-in"],
    ["question.multi", "write-in"],
  ],
  "editor.clear": [
    ["question.note", "clear"],
    ["question.write-in", "clear"],
  ],
  "review.accept": [["question.review", "accept"]],
  "review.move-up": [["question.review", "move-up"]],
  "review.move-down": [["question.review", "move-down"]],
  "text.accept": [
    ["question.text", "accept"],
    ["question.note", "accept"],
    ["question.write-in", "accept"],
  ],
  "text.newline": [
    ["question.text", "newline"],
    ["question.note", "newline"],
    ["question.write-in", "newline"],
  ],
};
const required: Partial<Record<QuestionContext, UiAction[][]>> = {
  "question.single": [["accept"], ["move-up"], ["move-down"], ["back"], ["cancel"]],
  "question.multi": [["accept"], ["move-up"], ["move-down"], ["toggle"], ["back"], ["cancel"]],
  "question.text": [["accept"], ["newline"], ["back"], ["cancel"]],
  "question.note": [["accept"], ["newline"], ["back"], ["clear"]],
  "question.write-in": [["accept"], ["newline"], ["back"], ["clear"]],
  "question.review": [
    ["accept"],
    ["move-up"],
    ["move-down"],
    ["next-question", "previous-question"],
    ["back"],
    ["cancel"],
  ],
};

export function validateDecisionKeybindingOverrides(
  value: unknown,
  path = "pi-decision-ui.json",
): DecisionKeybindingOverrides {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path}: keybindings must be an object`);
  for (const [action, keys] of Object.entries(value)) {
    if (!(decisionKeybindingActions as readonly string[]).includes(action))
      throw new Error(`${path}: unknown action ${action}`);
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string"))
      throw new Error(`${path}: ${action} must be an array of keys`);
    for (const key of keys)
      if (!isValidKeyId(key))
        throw new Error(`${path}: ${action}: invalid key ${JSON.stringify(key)}`);
  }
  return value as DecisionKeybindingOverrides;
}
function keysFor(
  action: DecisionKeybindingAction,
  overrides: DecisionKeybindingOverrides,
  injected?: InjectedKeybindings,
): KeyId[] {
  if (Object.hasOwn(overrides, action)) return [...overrides[action]!] as KeyId[];
  const injectedId = injectedAction[action];
  let keys = injectedId === undefined ? [] : [...(injected?.getKeys?.(injectedId) ?? [])];
  if (action === "common.back") {
    const clearKeys = injected?.getKeys?.("app.clear") ?? [];
    keys = keys.filter(
      (key) => !clearKeys.some((clearKey) => keysOverlap(key as KeyId, clearKey as KeyId)),
    );
  }
  return keys.length > 0 ? (keys as KeyId[]) : fallback[action]!;
}
export function resolveQuestionKeymap(
  overrides: DecisionKeybindingOverrides = {},
  path = "pi-decision-ui.json",
  injected?: InjectedKeybindings,
): ResolvedQuestionKeymap {
  validateDecisionKeybindingOverrides(overrides, path);
  const result = Object.fromEntries(
    questionContexts.map((context) => [context, {}]),
  ) as ResolvedQuestionKeymap;
  for (const action of decisionKeybindingActions)
    for (const [context, uiAction] of actionContexts[action])
      result[context][uiAction] = keysFor(action, overrides, injected);
  // Editors own Ctrl-C as clear and do not support question navigation.
  for (const context of ["question.note", "question.write-in"] as const) {
    result[context].cancel = [];
    result[context]["next-question"] = [];
    result[context]["previous-question"] = [];
  }
  for (const context of questionContexts.filter((value) => value !== "question.common")) {
    const effective = { ...result["question.common"], ...result[context] };
    const keyed = (Object.entries(effective) as Array<[UiAction, KeyId[]]>).flatMap(
      ([action, keys]) => keys.map((key) => ({ action, key })),
    );
    for (let leftIndex = 0; leftIndex < keyed.length; leftIndex += 1) {
      const left = keyed[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < keyed.length; rightIndex += 1) {
        const right = keyed[rightIndex]!;
        if (keysOverlap(left.key, right.key) && !isIntentionalEnterNewlineOverlap([left, right])) {
          throw new Error(
            `${path}: ${context}: collision between ${left.action}=${left.key} and ${right.action}=${right.key}`,
          );
        }
      }
    }
    for (const alternatives of required[context] ?? [])
      if (!alternatives.some((action) => (effective[action]?.length ?? 0) > 0))
        throw new Error(
          `${path}: ${context}: missing required action (${alternatives.join(" or ")})`,
        );
  }
  return result;
}
function effectiveMap(
  keymap: ResolvedQuestionKeymap,
  context: QuestionContext,
): Partial<Record<UiAction, KeyId[]>> {
  return context === "question.common"
    ? keymap[context]
    : { ...keymap["question.common"], ...keymap[context] };
}
export function resolveUiAction(
  data: string,
  context: QuestionContext,
  keymap: ResolvedQuestionKeymap,
): UiAction | undefined {
  const matches: Array<{ action: UiAction; specificity: number }> = [];
  for (const [action, keys] of Object.entries(effectiveMap(keymap, context)) as Array<
    [UiAction, KeyId[]]
  >)
    for (const key of keys)
      if (matchesKey(data, key)) matches.push({ action, specificity: key.split("+").length - 1 });
  matches.sort((left, right) => right.specificity - left.specificity);
  return matches[0]?.action;
}
const labels: Record<UiAction, string> = {
  accept: "confirm",
  newline: "newline",
  "next-question": "next",
  "previous-question": "previous",
  back: "back",
  cancel: "cancel",
  clear: "clear",
  "move-up": "up",
  "move-down": "down",
  toggle: "toggle",
  "select-and-note": "select and note",
  "write-in": "write response",
};
export function detailedQuestionHelp(
  context: QuestionContext,
  keymap: ResolvedQuestionKeymap,
): Array<{ action: UiAction; keys: string[]; label: string }> {
  return (Object.entries(effectiveMap(keymap, context)) as Array<[UiAction, KeyId[]]>)
    .filter(([, keys]) => keys.length > 0)
    .map(([action, keys]) => ({ action, keys: [...keys], label: labels[action] }));
}
export function questionHelp(
  context: QuestionContext,
  keymap: ResolvedQuestionKeymap,
  excluded?: ReadonlySet<UiAction>,
): string {
  return detailedQuestionHelp(context, keymap)
    .filter((item) => !excluded?.has(item.action))
    .map((item) => `${keyLabel(item.keys[0]!)} ${item.label}`)
    .join(" • ");
}
