/**
 * The `QuinUI` capability surface that contributions register against, and the
 * screen's height allocation. Adapted from the harness's `HarnessUI`: keys are
 * actions plus a keymap instead of chord registrations, and the timeline is
 * fed from the hub's view rather than an SDK session.
 */
import {
  ItemTypeRegistry,
  type ItemFactory,
  type ItemType,
  RegionController,
  type RegionId,
  type Registration,
  StageController,
  type StageContentType,
  type StageHandle,
  type StageRequest,
} from "./controllers";
import { EditorController, maxHeight, minHeight, type DraftRequestOptions, type DraftResult } from "./editor-engine";
import { type Action, KeyBindings, type Keymap } from "./keys";
import { RunStateController, StatuslineController, type StatuslineItemType } from "./statusline";

/** Tab order of the regions that take focus. */
export const FOCUS_ORDER: readonly RegionId[] = ["editor", "timeline", "stage"];

export interface QuinUI<Render = unknown> {
  editor: {
    openDraft(request: DraftRequestOptions): Promise<DraftResult>;
  };
  stage: {
    activate(id: string): boolean;
    registerType<T>(type: StageContentType<T, Render>): Registration;
    show<T>(request: StageRequest<T, Render>): StageHandle<T>;
  };
  timeline: {
    registerType<T>(type: ItemType<T, Render>): ItemFactory<T, Render>;
  };
  actions: {
    register(actions: readonly Action[]): Registration;
  };
  regions: {
    requestFocus(region: RegionId): boolean;
  };
  statusline: {
    registerType<T>(type: StatuslineItemType<T>): Registration;
  };
}

export interface QuinControllers<Render = unknown> {
  regions: RegionController;
  keys: KeyBindings;
  stage: StageController<Render>;
  timeline: ItemTypeRegistry<Render>;
  editor: EditorController;
  statusline: StatuslineController;
  runState: RunStateController;
}

export interface QuinUIInstance<Render = unknown> extends QuinUI<Render> {
  readonly controllers: QuinControllers<Render>;
}

export interface QuinUIOptions {
  /** Resolves whether the engine accepted the prompt. */
  sendPrompt?: (text: string) => Promise<boolean>;
  keymap?: Keymap;
}

export function createQuinUI<Render = unknown>(options: QuinUIOptions = {}): QuinUIInstance<Render> {
  const controllers = createQuinControllers<Render>(options);
  return {
    controllers,
    editor: { openDraft: (request) => controllers.editor.openDraft(request) },
    stage: {
      activate: (id) => controllers.stage.activate(id),
      registerType: (type) => controllers.stage.registerType(type),
      show: (request) => controllers.stage.show(request),
    },
    timeline: { registerType: (type) => controllers.timeline.registerType(type) },
    actions: { register: (actions) => controllers.keys.register(actions) },
    regions: { requestFocus: (region) => controllers.regions.requestFocus(region) },
    statusline: { registerType: (type) => controllers.statusline.registerType(type) },
  };
}

/**
 * Build the wired controller set: the stage controller owns the `stage`
 * region's availability, and typed characters reach the editor and any stage
 * content that accepts text.
 */
export function createQuinControllers<Render = unknown>(options: QuinUIOptions = {}): QuinControllers<Render> {
  const regions = new RegionController();
  const timeline = new ItemTypeRegistry<Render>();
  let editor: EditorController | undefined;
  const stage = new StageController<Render>({
    regions,
    // An active draft owns the editor; a stage request must not steal it back.
    canFocus: () => !editor?.activeDraft(),
  });
  editor = new EditorController({
    regions,
    sendPrompt: options.sendPrompt,
    onPromptAccepted: (text) => stage.notifyPromptSubmitted(text),
    onAssistChange: (hasAssist) => stage.setAssistAvailable(hasAssist),
  });
  const keys = new KeyBindings({
    keymap: options.keymap,
    acceptsText: (region) => region === "editor" || (region === "stage" && (stage.active()?.acceptsText ?? false)),
  });
  return { regions, keys, stage, timeline, editor, statusline: new StatuslineController(), runState: new RunStateController() };
}

const maxStageHeight = 10;
const editorChromeHeight = 2;

export interface HeightAllocation {
  /** Total rows the editor occupies, including its border. */
  editor: number;
  /** Rows available to the editor body. */
  body: number;
  /** Border rows: 0 when the terminal is too short to afford them. */
  chrome: number;
  /** Rows available to the stage. */
  stage: number;
  /** Rows of the status line above the timeline, and of the one below the editor. */
  top: number;
  bottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The editor keeps a two-row body. The status lines go first, the top one
 * before the bottom one, and only while they would leave the timeline a row;
 * then the stage shrinks, then the editor border, and only a terminal shorter
 * than two rows loses the body itself.
 */
export function allocateHeights(
  terminalRows: number,
  editor: { preferredHeight: number },
  stageRequest: { preferredHeight: number },
  statuslines: { top?: boolean; bottom?: boolean } = {},
): HeightAllocation {
  const height = Math.max(0, Math.floor(terminalRows));
  let body = clamp(Math.floor(editor.preferredHeight), minHeight, maxHeight);
  let chrome = height >= body + editorChromeHeight ? editorChromeHeight : 0;
  let stage = clamp(Math.floor(stageRequest.preferredHeight), 0, maxStageHeight);

  stage = Math.min(stage, Math.max(0, height - body - chrome));
  if (body + chrome + stage > height) {
    chrome = 0;
    stage = Math.min(stage, Math.max(0, height - body));
  }
  if (body + chrome + stage > height) {
    body = Math.max(minHeight, Math.min(body, height - chrome - stage));
  }
  if (body + chrome + stage > height) {
    chrome = 0;
    stage = 0;
    body = Math.max(0, Math.min(body, height));
  }
  const free = height - body - chrome - stage;
  const bottom = statuslines.bottom && free >= 2 ? 1 : 0;
  const top = statuslines.top && free - bottom >= 2 ? 1 : 0;
  return { editor: body + chrome, body, chrome, stage, top, bottom };
}
