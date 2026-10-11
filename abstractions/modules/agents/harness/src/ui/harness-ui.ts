/**
 * The `HarnessUI` capability surface static contributions register against, plus
 * the screen's height allocation. It wraps the terminal-independent controllers
 * and exposes no region registration.
 */
import {
  StageController,
  type StageContentType,
  type StageHandle,
  type StageRequest,
  KeyRegistry,
  type KeyBinding,
  ItemTypeRegistry,
  type ItemFactory,
  type TimelineItemInput,
  type ItemType,
  RegionController,
  type RegionId,
  type Registration,
} from "./controllers";
import {
  EditorController,
  maxHeight,
  minHeight,
  type DraftRequestOptions,
  type DraftResult,
} from "./editor-engine";
import { CommandController, type HarnessCommand } from "./command-controller";
import { TimelineBindings } from "./harness-client";
import type { ItemScrollKind } from "./item-actions";
import { RunStateController, StatuslineController, type StatuslineItemType } from "./statusline";

export interface HarnessUI<Render = unknown> {
  editor: {
    openDraft(request: DraftRequestOptions): Promise<DraftResult>;
  };
  commands: { register(definition: HarnessCommand): Registration };
  stage: {
    activate(id: string): boolean;
    registerType<T>(type: StageContentType<T, Render>): Registration;
    show<T>(request: StageRequest<T, Render>): StageHandle<T>;
  };
  timeline: {
    registerType<T>(type: ItemType<T, Render>): ItemFactory<T, Render>;
    append<T>(item: TimelineItemInput<T, Render>): void;
  };
  keys: {
    register(contribution: string, region: RegionId, bindings: readonly KeyBinding[]): Registration;
  };
  regions: {
    requestFocus(region: RegionId): boolean;
  };
  statusline: {
    registerType<T>(type: StatuslineItemType<T>): Registration;
  };
}

export type ScrollKind = ItemScrollKind;

/**
 * Behaviour the default contribution drives but does not own: the screen and the
 * later timeline/stage views supply it. Keys that stay inside the region
 * model (focus moves) are handled by the contribution directly.
 */
export interface HarnessUIActions {
  submit(): void;
  cancel(): void;
  quit(): void;
  focusFromEditor(target: "timeline" | "stage"): void;
  moveTimelineCursor(delta: number): void;
  scrollTimeline(kind: ScrollKind): void;
  toggleTimelineItem(): void;
  expandTimelineItem(): void;
  collapseTimelineItem(): void;
  copyTimelineItem(): void;
  moveStageCursor(delta: number): void;
  confirmStage(): void;
  cancelStage(): void;
  openCommand?(): void;
  moveStageRequest?(delta: number): void;
  stageAcceptsText?(): boolean;
  commandArguments?(): void;
  moveCommandDraftCursor?(delta: number): void;
  commandOwnsDraft?(): boolean;
}

export interface HarnessControllers<Render = unknown> {
  regions: RegionController;
  keys: KeyRegistry;
  stage: StageController<Render>;
  timeline: ItemTypeRegistry<Render>;
  editor: EditorController;
  commands: CommandController<Render>;
  bindings: TimelineBindings;
  statusline: StatuslineController;
  runState: RunStateController;
  /** Where contributed timeline items go; see `TimelineItemSink`. */
  items: TimelineItemSink;
}

export interface HarnessUIInstance<Render = unknown> extends HarnessUI<Render> {
  readonly controllers: HarnessControllers<Render>;
}

/**
 * Items contributed apart from the session, by native contributions or
 * extensions, named by a registered kind. A screen keeps them with the
 * session's history so one projection orders both; without one they go
 * straight to the registry.
 */
export interface TimelineItemSink {
  /** Add an item, or replace the value of the item with this id. */
  put(id: string, kind: string, value: unknown): void;
  remove(id: string): void;
}

export function registrySink<Render>(timeline: ItemTypeRegistry<Render>): TimelineItemSink {
  const versions = new Map<string, number>();
  return {
    put(id, kind, value) {
      const type = timeline.lookup(kind);
      if (!type) throw new Error(`No timeline type is registered as ${JSON.stringify(kind)}`);
      const version = (versions.get(id) ?? -1) + 1;
      versions.set(id, version);
      timeline.append({ id, version, type, value });
    },
    remove(id) {
      versions.delete(id);
      timeline.remove(id);
    },
  };
}

export interface HarnessUIOptions {
  sendPrompt?: (text: string) => Promise<boolean>;
  notify?: (text: string) => void;
  items?: TimelineItemSink;
}

export function createHarnessUI<Render = unknown>(
  options: HarnessUIOptions = {},
): HarnessUIInstance<Render> {
  const controllers = createHarnessControllers<Render>(options);
  return {
    controllers,
    editor: {
      openDraft: (request) => controllers.editor.openDraft(request),
    },
    commands: { register: (definition) => controllers.commands.register(definition) },
    stage: {
      activate: (id) => controllers.stage.activate(id),
      registerType: (type) => controllers.stage.registerType(type),
      show: (request) => controllers.stage.show(request),
    },
    timeline: {
      registerType: (type) => controllers.timeline.registerType(type),
      append: (item) => controllers.items.put(item.id, item.type.kind, item.value),
    },
    keys: {
      register: (contribution, region, bindings) => controllers.keys.register(contribution, region, bindings),
    },
    regions: {
      requestFocus: (region) => controllers.regions.requestFocus(region),
    },
    statusline: {
      registerType: (type) => controllers.statusline.registerType(type),
    },
  };
}

/**
 * Build the wired controller set: keys feed the regions, the stage controller
 * owns the `stage` region's availability, and an accepted prompt is forwarded
 * to the active stage requester.
 */
export function createHarnessControllers<Render = unknown>(
  options: HarnessUIOptions = {},
): HarnessControllers<Render> {
  const keys = new KeyRegistry();
  const regions = new RegionController({ keys });
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
    // A shown assist keeps the stage region focusable without a request.
    onAssistChange: (hasAssist) => stage.setAssistAvailable(hasAssist),
  });
  return {
    regions, keys, stage, timeline, editor,
    commands: new CommandController(stage, editor, options.notify ?? (() => {})),
    bindings: new TimelineBindings(),
    statusline: new StatuslineController(),
    runState: new RunStateController(),
    items: options.items ?? registrySink(timeline),
  };
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
