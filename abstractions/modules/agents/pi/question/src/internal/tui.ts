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

import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  decisionNoteRequirement,
  formatQuestionResponse,
  notePresentation,
  QuestionProgress,
  shouldAllowWriteIn,
  shouldAutoSubmitSingle,
  type DecisionFlowPolicy,
  type DecisionNoteRequirement,
  type PendingQuestionResponse,
  type QuestionItem,
  type QuestionOption,
  type QuestionResponse,
  type QuestionResultDetails,
} from "./core.ts";
import { choiceMarker } from "../render.ts";
import {
  questionHelp,
  resolveQuestionKeymap,
  resolveUiAction,
  keyLabel,
  type DecisionKeybindingOverrides,
  type InjectedKeybindings,
  type QuestionContext,
  type ResolvedQuestionKeymap,
  type UiAction,
} from "./keymap.ts";
import type { DecisionUiConfig } from "./config.ts";

interface DisplayChoice {
  value: string;
  label: string;
  description?: string;
}
interface ChoiceDraft {
  focusIndex: number;
  selected: Set<string>;
  optionNotes: Map<string, string>;
  writeIn?: string;
}
interface TextDraft {
  value: string;
}
type QuestionDraft = ChoiceDraft | TextDraft;
type Mode = "question" | "note" | "write-in" | "review";
interface TuiQuestionContext {
  ui: Pick<ExtensionUIContext, "custom">;
}

function editorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("borderAccent", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
}
function choicesFor(question: QuestionItem): DisplayChoice[] {
  return (question.options ?? []).map((option: QuestionOption) => ({ ...option }));
}
function appendWrapped(
  lines: string[],
  width: number,
  text: string,
  prefix = "",
  decorate?: (line: string) => string,
): void {
  const append = (line: string): void => {
    lines.push(decorate?.(line) ?? line);
  };
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) {
    wrapTextWithAnsi(`${prefix}${text}`, width).forEach(append);
    return;
  }
  const wrapped = wrapTextWithAnsi(text, width - prefixWidth);
  wrapped.forEach((line, index) =>
    append(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`),
  );
}
function cloneDraft(draft: QuestionDraft): QuestionDraft {
  return "value" in draft
    ? { value: draft.value }
    : {
        focusIndex: draft.focusIndex,
        selected: new Set(draft.selected),
        optionNotes: new Map(draft.optionNotes),
        writeIn: draft.writeIn,
      };
}
function draftFrom(question: QuestionItem, response?: QuestionResponse): QuestionDraft {
  if (question.kind === "text") return { value: response?.kind === "text" ? response.value : "" };
  const draft: ChoiceDraft = { focusIndex: 0, selected: new Set(), optionNotes: new Map() };
  if (response?.kind === "single") {
    draft.selected.add(response.value);
    if (response.note !== undefined) draft.optionNotes.set(response.value, response.note);
    draft.focusIndex = Math.max(
      0,
      (question.options ?? []).findIndex((option) => option.value === response.value),
    );
  } else if (response?.kind === "multi") {
    for (const item of response.values) {
      draft.selected.add(item.value);
      if (item.note !== undefined) draft.optionNotes.set(item.value, item.note);
    }
    draft.writeIn = response.writeIn;
  } else if (response?.kind === "write-in") {
    draft.writeIn = response.value;
  }
  return draft;
}
function notePreview(note: string | undefined): string | undefined {
  return note
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

export class DecisionComponent implements Component, Focusable {
  readonly #tui: Pick<TUI, "requestRender">;
  readonly #theme: Theme;
  readonly #questions: readonly QuestionItem[];
  readonly #progress: QuestionProgress;
  readonly #done: (result: QuestionResultDetails) => void;
  readonly #drafts = new Map<string, QuestionDraft>();
  readonly #editor: Editor;
  readonly #keymap: ResolvedQuestionKeymap;
  readonly #policy?: DecisionFlowPolicy;
  readonly #signal?: AbortSignal;
  readonly #abortHandler: () => void;
  #mode: Mode = "question";
  #reviewIndex = 0;
  #fromReview = false;
  #reviewEntryWasResponded = false;
  #lastEditedIndex = 0;
  #questionSnapshot?: QuestionDraft;
  #noteDraftSnapshot?: ChoiceDraft;
  #writeInDraftSnapshot?: ChoiceDraft;
  #noteSnapshot?: string;
  #noteTarget?: string;
  #submitAfterNote = false;
  #validation?: string;
  #cachedLines?: string[];
  #cachedWidth?: number;
  #finished = false;
  #focused = false;

  constructor(options: {
    tui: TUI;
    theme: Theme;
    keymapConfig?: DecisionKeybindingOverrides;
    keymapPath?: string;
    injectedKeybindings?: InjectedKeybindings;
    questions: readonly QuestionItem[];
    progress?: QuestionProgress;
    policy?: DecisionFlowPolicy;
    signal?: AbortSignal;
    done: (result: QuestionResultDetails) => void;
  }) {
    this.#tui = options.tui;
    this.#theme = options.theme;
    this.#questions = options.questions;
    this.#progress = options.progress ?? new QuestionProgress(options.questions);
    this.#done = options.done;
    this.#policy = options.policy;
    this.#keymap = resolveQuestionKeymap(
      options.keymapConfig,
      options.keymapPath,
      options.injectedKeybindings,
    );
    this.#editor = new Editor(options.tui, editorTheme(options.theme));
    this.#editor.disableSubmit = true;
    for (const question of options.questions)
      this.#drafts.set(question.id, draftFrom(question, this.#progress.responseFor(question)));
    this.#openQuestion(false);
    this.#signal = options.signal;
    this.#abortHandler = () => this.#cancel();
    this.#signal?.addEventListener("abort", this.#abortHandler, { once: true });
    if (this.#signal?.aborted) this.#finish(this.#progress.cancelled(false));
  }
  get focused(): boolean {
    return this.#focused;
  }
  set focused(value: boolean) {
    this.#focused = value;
    this.#syncEditorFocus();
  }
  invalidate(): void {
    this.#cachedLines = undefined;
    this.#cachedWidth = undefined;
    this.#editor.invalidate();
  }
  dispose(): void {
    this.#cleanup();
  }
  #cleanup(): void {
    this.#signal?.removeEventListener("abort", this.#abortHandler);
    this.#editor.focused = false;
  }
  #refresh(): void {
    this.invalidate();
    this.#tui.requestRender();
  }
  #finish(result: QuestionResultDetails): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#cleanup();
    this.#done(result);
  }
  #cancel(): void {
    this.#finish(this.#progress.cancelled(this.#mode !== "review"));
  }
  #question(): QuestionItem {
    return this.#progress.current;
  }
  #autoSubmitSingle(): boolean {
    return this.#progress.total === 1 && shouldAutoSubmitSingle(this.#policy);
  }
  #allowWriteIn(): boolean {
    return shouldAllowWriteIn(this.#policy);
  }
  #draft(): QuestionDraft {
    return this.#drafts.get(this.#question().id)!;
  }
  #choiceDraft(): ChoiceDraft {
    const draft = this.#draft();
    if (!("selected" in draft)) throw new Error("Not a choice question");
    return draft;
  }
  #textDraft(): TextDraft {
    const draft = this.#draft();
    if (!("value" in draft)) throw new Error("Not a text question");
    return draft;
  }
  #choices(): DisplayChoice[] {
    return choicesFor(this.#question());
  }
  #isInlineWriteInFocused(): boolean {
    const question = this.#question();
    return (
      question.kind === "multi" &&
      this.#allowWriteIn() &&
      this.#choiceDraft().focusIndex === this.#choices().length
    );
  }
  #syncEditorFocus(): void {
    this.#editor.focused =
      this.#focused &&
      (this.#mode === "note" ||
        this.#mode === "write-in" ||
        (this.#mode === "question" &&
          (this.#question().kind === "text" || this.#isInlineWriteInFocused())));
  }
  #context(): QuestionContext {
    return this.#mode === "review"
      ? "question.review"
      : this.#mode === "note"
        ? "question.note"
        : this.#mode === "write-in"
          ? "question.write-in"
          : (`question.${this.#question().kind}` as QuestionContext);
  }
  #openQuestion(fromReview: boolean): void {
    this.#mode = "question";
    this.#fromReview = fromReview;
    this.#reviewEntryWasResponded = fromReview && this.#progress.isResponded(this.#question());
    this.#lastEditedIndex = this.#progress.index;
    this.#questionSnapshot = cloneDraft(this.#draft());
    this.#validation = undefined;
    if (this.#question().kind === "text") this.#editor.setText(this.#textDraft().value);
    this.#syncEditorFocus();
  }
  #saveEditorDraft(): void {
    if (this.#mode === "question" && this.#question().kind === "text")
      this.#textDraft().value = this.#editor.getExpandedText();
  }
  #draftHasMissingRequiredNote(question: QuestionItem, draft: QuestionDraft): number | undefined {
    if (question.kind === "text" || !("selected" in draft)) return undefined;
    for (const [index, option] of (question.options ?? []).entries()) {
      if (
        draft.selected.has(option.value) &&
        decisionNoteRequirement(this.#policy, question, option) === "required" &&
        (draft.optionNotes.get(option.value)?.trim().length ?? 0) === 0
      )
        return index;
    }
    return undefined;
  }
  #saveDraftOnNavigate(): void {
    this.#saveEditorDraft();
    if (this.#draftHasMissingRequiredNote(this.#question(), this.#draft()) !== undefined) return;
    const pending = this.#pendingFromDraft();
    if (pending === undefined) this.#progress.clear();
    else this.#progress.submit(pending);
  }
  #moveQuestion(delta: number): void {
    const next = this.#progress.index + delta;
    if (delta > 0 && next >= this.#progress.total && this.#autoSubmitSingle()) {
      const missingNote = this.#draftHasMissingRequiredNote(this.#question(), this.#draft());
      if (missingNote !== undefined) {
        this.#choiceDraft().focusIndex = missingNote;
        this.#openNote({ submitAfterSave: true });
        return;
      }
    }
    this.#saveDraftOnNavigate();
    if (delta > 0 && next >= this.#progress.total) {
      if (this.#autoSubmitSingle()) {
        this.#finish(this.#progress.submitted());
        return;
      }
      this.#mode = "review";
      this.#reviewIndex = 0;
      this.#syncEditorFocus();
      this.#validation = undefined;
      this.#refresh();
      return;
    }
    if (next < 0 || next >= this.#progress.total) return;
    this.#progress.moveTo(next);
    this.#openQuestion(false);
    this.#refresh();
  }
  #choiceFocusCount(): number {
    const question = this.#question();
    return this.#choices().length + (question.kind === "multi" && this.#allowWriteIn() ? 1 : 0);
  }
  #focusedRegularChoice(): DisplayChoice | undefined {
    return this.#choices()[this.#choiceDraft().focusIndex];
  }
  #moveChoice(delta: number): void {
    const count = this.#choiceFocusCount();
    if (count === 0) return;
    const draft = this.#choiceDraft();
    const next = (draft.focusIndex + delta + count) % count;
    this.#validation = undefined;
    if (
      this.#question().kind === "multi" &&
      this.#allowWriteIn() &&
      next === this.#choices().length
    )
      return this.#openWriteIn();
    draft.focusIndex = next;
    this.#refresh();
  }
  #focusedChoice(): DisplayChoice {
    const choice = this.#focusedRegularChoice();
    if (choice === undefined) throw new Error("Focused choice is the write-in row");
    return choice;
  }
  #noteRequirement(option?: QuestionOption): DecisionNoteRequirement {
    const question = this.#question();
    const focused = this.#focusedChoice();
    const target =
      option ??
      (this.#noteTarget === undefined
        ? question.options?.find((candidate) => candidate.value === focused.value)
        : question.options?.find((candidate) => candidate.value === this.#noteTarget));
    return decisionNoteRequirement(this.#policy, question, target);
  }
  #openNote(options: { submitAfterSave?: boolean } = {}): void {
    const draft = this.#choiceDraft();
    const focused = this.#focusedChoice();
    this.#noteTarget = focused.value;
    this.#noteDraftSnapshot = cloneDraft(draft) as ChoiceDraft;
    this.#noteSnapshot = draft.optionNotes.get(this.#noteTarget);
    this.#submitAfterNote = options.submitAfterSave ?? false;
    this.#editor.setText(this.#noteSnapshot ?? "");
    this.#mode = "note";
    this.#validation = undefined;
    this.#syncEditorFocus();
    this.#refresh();
  }
  #closeNote(save: boolean): void {
    const editedNote = this.#editor.getExpandedText();
    if (save && this.#noteRequirement() === "required" && editedNote.trim() === "") {
      this.#validation = "Note must contain non-whitespace text.";
      this.#refresh();
      return;
    }
    if (!save) {
      if (this.#noteDraftSnapshot !== undefined)
        this.#drafts.set(this.#question().id, cloneDraft(this.#noteDraftSnapshot));
    } else {
      const draft = this.#choiceDraft();
      const normalized = editedNote.trim() === "" ? undefined : editedNote;
      const target = this.#noteTarget;
      if (target === undefined) throw new Error("Regular note has no target");
      if (normalized === undefined) draft.optionNotes.delete(target);
      else draft.optionNotes.set(target, normalized);
      if (this.#question().kind === "single") {
        draft.selected.clear();
        draft.writeIn = undefined;
      }
      draft.selected.add(target);
    }
    const submit = save && this.#submitAfterNote;
    this.#noteDraftSnapshot = undefined;
    this.#noteSnapshot = undefined;
    this.#noteTarget = undefined;
    this.#submitAfterNote = false;
    this.#mode = "question";
    this.#validation = undefined;
    this.#syncEditorFocus();
    if (submit) this.#commit();
    else this.#refresh();
  }
  #openWriteIn(): void {
    const draft = this.#choiceDraft();
    this.#writeInDraftSnapshot = cloneDraft(draft) as ChoiceDraft;
    if (this.#question().kind === "multi") draft.focusIndex = this.#choices().length;
    this.#editor.setText(draft.writeIn ?? "");
    this.#mode = "write-in";
    this.#validation = undefined;
    this.#syncEditorFocus();
    this.#refresh();
  }
  #closeWriteIn(save: boolean): void {
    const snapshot = this.#writeInDraftSnapshot;
    const existing = snapshot?.writeIn;
    const edited = this.#editor.getExpandedText();
    if (save && edited.trim() === "" && existing === undefined) {
      this.#validation = "Response must contain non-whitespace text.";
      this.#refresh();
      return;
    }
    if (!save && snapshot !== undefined)
      this.#drafts.set(this.#question().id, cloneDraft(snapshot));
    else if (save) {
      const draft = this.#choiceDraft();
      draft.writeIn = edited.trim() === "" ? undefined : edited;
      if (this.#question().kind === "single" && draft.writeIn !== undefined) draft.selected.clear();
      if (this.#question().kind === "multi")
        draft.focusIndex = Math.min(snapshot?.focusIndex ?? 0, this.#choices().length - 1);
    }
    this.#writeInDraftSnapshot = undefined;
    this.#mode = "question";
    this.#validation = undefined;
    this.#syncEditorFocus();
    if (save && this.#question().kind === "single" && this.#choiceDraft().writeIn !== undefined)
      this.#commit();
    else if (save && this.#question().kind === "single" && existing !== undefined) {
      this.#progress.clear();
      if (this.#fromReview) {
        this.#mode = "review";
        this.#reviewIndex = this.#progress.index + 1;
        this.#fromReview = false;
        this.#reviewEntryWasResponded = false;
        this.#syncEditorFocus();
      }
      this.#refresh();
    } else this.#refresh();
  }
  #closeWriteInForNavigation(): void {
    const draft = this.#choiceDraft();
    const edited = this.#editor.getExpandedText();
    draft.writeIn = edited.trim() === "" ? undefined : edited;
    this.#writeInDraftSnapshot = undefined;
    this.#mode = "question";
    this.#validation = undefined;
    this.#syncEditorFocus();
  }
  #pendingFromDraft(): PendingQuestionResponse | undefined {
    const question = this.#question();
    if (question.kind === "text") {
      const value = this.#textDraft().value;
      return value.trim() === "" ? undefined : { kind: "text", value };
    }
    const draft = this.#choiceDraft();
    if (question.kind === "single" && draft.writeIn !== undefined)
      return { kind: "write-in", value: draft.writeIn };
    if (draft.selected.size === 0 && draft.writeIn === undefined) return undefined;
    if (question.kind === "multi") {
      return {
        kind: "multi",
        values: (question.options ?? [])
          .filter((option) => draft.selected.has(option.value))
          .map((option) =>
            draft.optionNotes.has(option.value)
              ? { value: option.value, note: draft.optionNotes.get(option.value) }
              : { value: option.value },
          ),
        ...(draft.writeIn === undefined ? {} : { writeIn: draft.writeIn }),
      };
    }
    const value = [...draft.selected][0]!;
    const note = draft.optionNotes.get(value);
    return note === undefined ? { kind: "single", value } : { kind: "single", value, note };
  }
  #pending(options: { silent?: boolean } = {}): PendingQuestionResponse | undefined {
    const question = this.#question();
    if (question.kind === "text") {
      const value = this.#editor.getExpandedText();
      this.#textDraft().value = value;
      if (value.trim() === "") {
        if (!options.silent) {
          this.#validation = "Answer must contain non-whitespace text.";
          this.#refresh();
        }
        return undefined;
      }
      return { kind: "text", value };
    }
    const draft = this.#choiceDraft();
    const focused = this.#focusedRegularChoice();
    if (question.kind === "single" && draft.writeIn !== undefined)
      return { kind: "write-in", value: draft.writeIn };
    if (question.kind === "multi") {
      if (draft.selected.size === 0 && draft.writeIn !== undefined) return this.#pendingFromDraft();
      // Focus is not selection: only selected options are checked for required notes.
      if (draft.selected.size === 0 && draft.writeIn === undefined) {
        if (!options.silent) {
          this.#validation = "Select at least one option or write another response.";
          this.#refresh();
        }
        return undefined;
      }
      for (const [index, option] of (question.options ?? []).entries()) {
        if (!draft.selected.has(option.value)) continue;
        if (
          decisionNoteRequirement(this.#policy, question, option) === "required" &&
          draft.optionNotes.get(option.value) === undefined
        ) {
          draft.focusIndex = index;
          this.#openNote({ submitAfterSave: true });
          return undefined;
        }
      }
      return this.#pendingFromDraft();
    }
    let realSelected = [...draft.selected];
    if (realSelected.length === 0) {
      if (focused === undefined) throw new Error("Focused regular choice is the write-in row");
      draft.selected.add(focused.value);
      realSelected = [focused.value];
    }
    const value = realSelected[0]!;
    const option = question.options?.find((candidate) => candidate.value === value);
    if (
      decisionNoteRequirement(this.#policy, question, option) === "required" &&
      draft.optionNotes.get(value) === undefined
    ) {
      draft.focusIndex = Math.max(
        0,
        (question.options ?? []).findIndex((candidate) => candidate.value === value),
      );
      this.#openNote({ submitAfterSave: true });
      return undefined;
    }
    const note = draft.optionNotes.get(value);
    return note === undefined ? { kind: "single", value } : { kind: "single", value, note };
  }
  #finishAfterCommit(editedIndex: number, wasResponded: boolean): void {
    if (!this.#fromReview && this.#autoSubmitSingle()) {
      this.#finish(this.#progress.submitted());
      return;
    }
    if (this.#fromReview) {
      this.#mode = "review";
      if (this.#progress.allResponded) this.#reviewIndex = 0;
      else if (!wasResponded)
        this.#reviewIndex = (this.#progress.nextUntouched(editedIndex) ?? editedIndex) + 1;
      else this.#reviewIndex = editedIndex + 1;
      this.#fromReview = false;
      this.#reviewEntryWasResponded = false;
      this.#syncEditorFocus();
      this.#refresh();
      return;
    }
    const next = this.#progress.nextUntouched();
    if (next === undefined) {
      this.#mode = "review";
      this.#reviewIndex = 0;
      this.#syncEditorFocus();
      this.#refresh();
    } else {
      this.#progress.moveTo(next);
      this.#openQuestion(false);
      this.#refresh();
    }
  }
  #commit(): void {
    const pending = this.#pending();
    if (pending === undefined) return;
    const editedIndex = this.#progress.index;
    const wasResponded = this.#reviewEntryWasResponded;
    this.#progress.submit(pending);
    this.#finishAfterCommit(editedIndex, wasResponded);
  }
  #back(): void {
    if (this.#mode === "note") {
      this.#closeNote(false);
      return;
    }
    if (this.#mode === "write-in") {
      this.#closeWriteIn(false);
      return;
    }
    if (this.#mode === "review") {
      this.#progress.moveTo(this.#lastEditedIndex);
      this.#openQuestion(true);
      this.#refresh();
      return;
    }
    if (this.#questionSnapshot !== undefined)
      this.#drafts.set(this.#question().id, cloneDraft(this.#questionSnapshot));
    if (this.#fromReview) {
      this.#mode = "review";
      this.#reviewIndex = this.#progress.index + 1;
      this.#fromReview = false;
      this.#reviewEntryWasResponded = false;
      this.#syncEditorFocus();
      this.#refresh();
    } else {
      const cancel = (this.#keymap["question.common"].cancel ?? []).map(keyLabel).join("/");
      this.#validation = `Nothing to go back to. Press ${cancel} to cancel all questions.`;
      if (this.#question().kind === "text") this.#editor.setText(this.#textDraft().value);
      this.#refresh();
    }
  }
  #handleToggle(): void {
    const question = this.#question();
    if (question.kind !== "single" && question.kind !== "multi") return;
    const draft = this.#choiceDraft();
    const choice = this.#focusedRegularChoice();
    if (choice === undefined) return;
    if (question.kind === "single") draft.writeIn = undefined;
    if (question.kind === "single") {
      draft.selected.clear();
      draft.selected.add(choice.value);
    } else {
      if (draft.selected.has(choice.value)) {
        draft.selected.delete(choice.value);
        draft.optionNotes.delete(choice.value);
      } else draft.selected.add(choice.value);
    }
    this.#validation = undefined;
    this.#refresh();
  }
  #handleQuestion(action: UiAction | undefined, data: string): void {
    if (action === "next-question") return this.#moveQuestion(1);
    if (action === "previous-question") return this.#moveQuestion(-1);
    if (action === "back") return this.#back();
    if (action === "move-up") return this.#moveChoice(-1);
    if (action === "move-down") return this.#moveChoice(1);
    if (action === "select-and-note" && this.#question().kind !== "text") {
      const choice = this.#focusedChoice();
      if (
        this.#noteRequirement(
          this.#question().options?.find((option) => option.value === choice.value),
        ) !== "none"
      ) {
        return this.#openNote({ submitAfterSave: this.#question().kind === "single" });
      }
    }
    if (action === "write-in" && this.#question().kind !== "text" && this.#allowWriteIn())
      return this.#openWriteIn();
    if (action === "toggle") return this.#handleToggle();
    if (action === "accept") return this.#commit();
    if (action === "newline" && this.#question().kind === "text") {
      this.#editor.insertTextAtCursor("\n");
      this.#validation = undefined;
      return this.#refresh();
    }
    if (this.#question().kind === "text") {
      this.#editor.handleInput(data);
      this.#validation = undefined;
      this.#refresh();
    }
  }
  #openMissingReviewNote(): boolean {
    for (const [index, question] of this.#questions.entries()) {
      const optionIndex = this.#draftHasMissingRequiredNote(
        question,
        this.#drafts.get(question.id)!,
      );
      if (optionIndex === undefined) continue;
      this.#progress.moveTo(index);
      this.#openQuestion(true);
      this.#choiceDraft().focusIndex = optionIndex;
      this.#openNote({ submitAfterSave: true });
      return true;
    }
    return false;
  }
  #handleReview(action: UiAction | undefined): void {
    if (action === "move-up") {
      this.#reviewIndex =
        (this.#reviewIndex - 1 + this.#questions.length + 1) % (this.#questions.length + 1);
      this.#refresh();
    } else if (action === "move-down") {
      this.#reviewIndex = (this.#reviewIndex + 1) % (this.#questions.length + 1);
      this.#refresh();
    } else if (action === "next-question" || action === "previous-question") {
      const delta = action === "next-question" ? 1 : -1;
      if (this.#reviewIndex === 0) this.#reviewIndex = delta > 0 ? 1 : this.#questions.length;
      else
        this.#reviewIndex =
          ((this.#reviewIndex - 1 + delta + this.#questions.length) % this.#questions.length) + 1;
      this.#refresh();
    } else if (action === "back") this.#back();
    else if (action === "accept") {
      if (this.#reviewIndex === 0) {
        if (!this.#openMissingReviewNote()) this.#finish(this.#progress.submitted());
      } else {
        this.#progress.moveTo(this.#reviewIndex - 1);
        this.#openQuestion(true);
        this.#refresh();
      }
    }
  }
  handleInput(data: string): void {
    if (this.#finished) return;
    const primaryAction = resolveUiAction(data, this.#context(), this.#keymap);
    const multiWriteInAction =
      this.#mode === "write-in" && this.#question().kind === "multi"
        ? resolveUiAction(data, "question.multi", this.#keymap)
        : undefined;
    const action =
      primaryAction ??
      (multiWriteInAction === "move-up" || multiWriteInAction === "move-down"
        ? multiWriteInAction
        : undefined);
    if (action === "cancel") return this.#cancel();
    if (this.#mode === "note") {
      if (action === "back") this.#closeNote(false);
      else if (action === "accept") this.#closeNote(true);
      else if (action === "clear") {
        this.#editor.setText("");
        this.#validation = undefined;
        this.#refresh();
      } else if (action === "newline") {
        this.#editor.insertTextAtCursor("\n");
        this.#refresh();
      } else {
        this.#editor.handleInput(data);
        this.#refresh();
      }
    } else if (this.#mode === "write-in") {
      if (action === "move-up" || action === "move-down") {
        this.#closeWriteInForNavigation();
        this.#moveChoice(action === "move-up" ? -1 : 1);
      } else if (action === "back") this.#closeWriteIn(false);
      else if (action === "accept") this.#closeWriteIn(true);
      else if (action === "clear") {
        this.#editor.setText("");
        this.#validation = undefined;
        this.#refresh();
      } else if (action === "newline") {
        this.#editor.insertTextAtCursor("\n");
        this.#refresh();
      } else {
        this.#editor.handleInput(data);
        this.#refresh();
      }
    } else if (this.#mode === "review") this.#handleReview(action);
    else this.#handleQuestion(action, data);
  }
  #responseStatusLabel(question: QuestionItem): string {
    if (this.#draftHasMissingRequiredNote(question, this.#drafts.get(question.id)!) !== undefined)
      return "⚠ Required note needed";
    if (this.#progress.isAnswered(question)) return "✓ Answered";
    return "○ Unanswered";
  }
  #renderHeader(lines: string[], width: number): void {
    const tabs = this.#questions.map((question, index) => {
      const active = this.#mode !== "review" && index === this.#progress.index;
      const marker = this.#progress.isAnswered(question) ? "✓" : "○";
      const text = `[${index + 1} ${active ? "●" : marker}]`;
      if (active) return this.#theme.fg("accent", this.#theme.bold(text));
      if (this.#progress.isAnswered(question)) return this.#theme.fg("success", text);
      return this.#theme.fg("dim", text);
    });
    if (!this.#autoSubmitSingle()) {
      const text = `[Review${this.#mode === "review" ? " ●" : ""}]`;
      tabs.push(
        this.#mode === "review"
          ? this.#theme.fg("accent", this.#theme.bold(text))
          : this.#theme.fg("dim", text),
      );
    }
    appendWrapped(lines, width, tabs.join(" "));
  }
  #renderChoices(lines: string[], width: number): void {
    const question = this.#question();
    const draft = this.#choiceDraft();
    const choices = this.#choices();
    for (let index = 0; index < choices.length; index += 1) {
      const choice = choices[index]!;
      const focused = index === draft.focusIndex;
      const virtualSelected = this.#mode === "note" && choice.value === this.#noteTarget;
      const selected = draft.selected.has(choice.value) || virtualSelected;
      const control = choiceMarker(question.kind === "multi" ? "multi" : "single", selected);
      const option = question.options?.[index];
      const noteKey =
        this.#keymap[`question.${question.kind}` as QuestionContext]["select-and-note"]?.[0];
      const required =
        decisionNoteRequirement(this.#policy, question, option) === "required"
          ? ` (note required${noteKey === undefined ? "" : `; ${keyLabel(noteKey)} select and note`})`
          : "";
      const text = `${control} ${choice.label}${required}`;
      const styled = this.#theme.fg(
        focused ? "accent" : selected ? "success" : "text",
        focused || selected ? this.#theme.bold(text) : text,
      );
      appendWrapped(
        lines,
        width,
        styled,
        focused ? "> " : "  ",
        focused ? (line) => this.#theme.bg("selectedBg", line) : undefined,
      );
      if (choice.description?.trim())
        appendWrapped(lines, width, this.#theme.fg("muted", choice.description), "    ");
      const note = draft.optionNotes.get(choice.value);
      const preview = notePreview(note);
      if (preview) appendWrapped(lines, width, this.#theme.fg("muted", `Note: ${preview}`), "    ");
      if (question.kind === "multi" && this.#mode === "note" && choice.value === this.#noteTarget)
        this.#renderNoteEditor(lines, width);
    }
    if (question.kind === "single" && draft.writeIn !== undefined) {
      appendWrapped(
        lines,
        width,
        this.#theme.fg("success", this.#theme.bold("(●) Write another response")),
        "  ",
      );
      const preview = notePreview(draft.writeIn);
      if (preview)
        appendWrapped(lines, width, this.#theme.fg("muted", `Response: ${preview}`), "    ");
    }
    if (question.kind === "multi" && this.#allowWriteIn()) {
      const focused = draft.focusIndex === this.#choices().length;
      const selected = draft.writeIn !== undefined;
      const text = `${choiceMarker("multi", selected)} Write another response`;
      const styled = this.#theme.fg(
        focused ? "accent" : selected ? "success" : "text",
        focused || selected ? this.#theme.bold(text) : text,
      );
      appendWrapped(
        lines,
        width,
        styled,
        focused ? "> " : "  ",
        focused ? (line) => this.#theme.bg("selectedBg", line) : undefined,
      );
      const preview = notePreview(draft.writeIn);
      if (preview)
        appendWrapped(lines, width, this.#theme.fg("muted", `Response: ${preview}`), "    ");
      if (this.#mode === "write-in") {
        const presentation = notePresentation(this.#policy, question, "write-in");
        this.#renderEditor(lines, width, presentation.prompt ?? "Write another response");
        if (presentation.placeholder)
          appendWrapped(lines, width, this.#theme.fg("dim", presentation.placeholder), " ");
      }
    }
  }
  #renderEditor(lines: string[], width: number, label: string): void {
    appendWrapped(lines, width, this.#theme.fg("accent", this.#theme.bold(label)), " ");
    for (const line of this.#editor.render(Math.max(1, width - 1)))
      lines.push(width > 1 ? ` ${line}` : line);
  }
  #renderNoteEditor(lines: string[], width: number): void {
    const presentation = notePresentation(this.#policy, this.#question(), "response");
    const fallback =
      this.#noteRequirement() === "required"
        ? "Required note for this option"
        : "Optional note for this option";
    this.#renderEditor(lines, width, presentation.prompt ?? fallback);
    if (presentation.placeholder)
      appendWrapped(lines, width, this.#theme.fg("dim", presentation.placeholder), " ");
  }
  #renderNoteTarget(lines: string[], width: number): void {
    const choice = this.#question().options?.find((option) => option.value === this.#noteTarget);
    if (choice !== undefined) {
      const selected = true;
      const control = choiceMarker(
        this.#question().kind === "multi" ? "multi" : "single",
        selected,
      );
      appendWrapped(
        lines,
        width,
        this.#theme.fg("accent", this.#theme.bold(`${control} ${choice.label}`)),
        " ",
      );
      if (choice.description?.trim())
        appendWrapped(lines, width, this.#theme.fg("muted", choice.description), "    ");
    }
    this.#renderNoteEditor(lines, width);
  }
  #renderReview(lines: string[], width: number): void {
    const hasMissingRequiredNote = this.#questions.some(
      (question) =>
        this.#draftHasMissingRequiredNote(question, this.#drafts.get(question.id)!) !== undefined,
    );
    const submitText = `${hasMissingRequiredNote ? "Complete required notes before submitting" : "Submit responses — ready"} (${this.#progress.answeredCount} answered, ${this.#progress.untouchedCount} untouched)`;
    const submitFocused = this.#reviewIndex === 0;
    const submitColor = submitFocused ? "accent" : hasMissingRequiredNote ? "warning" : "success";
    appendWrapped(
      lines,
      width,
      this.#theme.fg(submitColor, this.#theme.bold(submitText)),
      submitFocused ? "> " : "  ",
      submitFocused ? (line) => this.#theme.bg("selectedBg", line) : undefined,
    );
    this.#questions.forEach((question, index) => {
      const response = this.#progress.responseFor(question);
      const focused = this.#reviewIndex === index + 1;
      const missingRequiredNote =
        this.#draftHasMissingRequiredNote(question, this.#drafts.get(question.id)!) !== undefined;
      const text = `Q${index + 1} ${this.#responseStatusLabel(question)}: ${question.prompt}`;
      const color = focused
        ? "accent"
        : missingRequiredNote || response === undefined
          ? "warning"
          : this.#progress.isAnswered(question)
            ? "success"
            : "warning";
      const styled = this.#theme.fg(color, focused ? this.#theme.bold(text) : text);
      appendWrapped(
        lines,
        width,
        styled,
        focused ? "> " : "  ",
        focused ? (line) => this.#theme.bg("selectedBg", line) : undefined,
      );
      if (response)
        appendWrapped(
          lines,
          width,
          this.#theme.fg("muted", formatQuestionResponse(question, response)),
          "    ",
        );
    });
  }
  render(width: number): string[] {
    const w = Math.max(1, width);
    if (this.#cachedLines && this.#cachedWidth === w) return this.#cachedLines;
    const lines = [this.#theme.fg("border", "─".repeat(w))];
    this.#renderHeader(lines, w);
    lines.push("");
    if (this.#mode === "review") this.#renderReview(lines, w);
    else {
      appendWrapped(
        lines,
        w,
        this.#theme.fg("accent", this.#theme.bold(this.#question().prompt)),
        " ",
      );
      lines.push("");
      if (this.#mode === "note" && this.#question().kind !== "multi")
        this.#renderNoteTarget(lines, w);
      else if (this.#mode === "write-in" && this.#question().kind !== "multi")
        this.#renderEditor(lines, w, "Write another response");
      else if (this.#question().kind === "text") this.#renderEditor(lines, w, "Answer");
      else this.#renderChoices(lines, w);
    }
    if (this.#validation) {
      lines.push("");
      appendWrapped(
        lines,
        w,
        this.#theme.fg("error", this.#theme.bold(`Error: ${this.#validation}`)),
        " ",
      );
    }
    const help = questionHelp(
      this.#context(),
      this.#keymap,
      this.#allowWriteIn() ? undefined : new Set<UiAction>(["write-in"]),
    );
    lines.push("");
    appendWrapped(lines, w, this.#theme.fg("dim", help), " ");
    lines.push(this.#theme.fg("border", "─".repeat(w)));
    this.#cachedLines = lines.map((line) => truncateToWidth(line, w, ""));
    this.#cachedWidth = w;
    return this.#cachedLines;
  }
}

export async function runTuiDecisionFlow(
  context: TuiQuestionContext,
  questions: readonly QuestionItem[],
  signal: AbortSignal | undefined,
  policy: DecisionFlowPolicy | undefined,
  config: DecisionUiConfig,
  configPath: string,
): Promise<QuestionResultDetails> {
  const progress = new QuestionProgress(questions);
  if (signal?.aborted) return progress.cancelled(false);
  return context.ui.custom<QuestionResultDetails>(
    (tui, theme, keybindings, done) =>
      new DecisionComponent({
        tui,
        theme,
        keymapConfig: config.keybindings,
        keymapPath: configPath,
        injectedKeybindings: keybindings as InjectedKeybindings,
        questions,
        progress,
        policy,
        signal,
        done,
      }),
    {
      overlay: false,
      blocked: { kind: "question", message: "Waiting for a question" },
    },
  );
}

export const runTuiQuestionFlow = runTuiDecisionFlow;
