/**
 * Keys and operations are separate: contributions register named actions with
 * default chords, and a keymap replaces the chords of any action by its id.
 *
 * An action id is `<layer>.<name>`. The layer is a region, or `global` for an
 * action reachable from every region. The focused region's chords are tried
 * first, then the global ones. A chord that types a character is not resolved
 * while the focused region accepts text, so it reaches the native input;
 * binding one in a layer that always accepts text is an error. Space is text too;
 * an action may explicitly capture text in a conditionally textual region.
 *
 * A key is a single character or one of the names OpenTUI reports, such as
 * `return`, `escape`, or `space`; a capital letter is `shift+<letter>`.
 */
import { DuplicateRegistrationError, Emitter, type RegionId, type Registration } from "./controllers";

const GLOBAL_LAYER = "global";

interface KeyChord {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A key event as the renderer reports it. */
interface KeyInput extends KeyChord {
  meta?: boolean;
  option?: boolean;
}

export interface Action {
  /** `<layer>.<name>`; the stable identifier a keymap refers to. */
  id: string;
  run(): void;
  /** Chords bound when the keymap does not name this action. */
  keys?: readonly string[];
  /** Whether the action applies now; otherwise its chords fall through to the global layer and the native input. */
  when?(): boolean;
  /** Handle text in a conditionally textual region, such as the palette's argument separator. */
  captureText?: boolean;
}

/** Action id to chords. Listing an action replaces its default chords; an empty list unbinds it. */
export type Keymap = Readonly<Record<string, readonly string[]>>;

export class KeymapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeymapError";
  }
}

const MODIFIERS = new Set(["ctrl", "shift", "alt"]);

/** The names OpenTUI reports for keys that type no single character. */
const NAMED_KEYS = new Set([
  "return", "linefeed", "escape", "tab", "space", "backspace", "delete", "insert", "clear",
  "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
  ...Array.from({ length: 35 }, (_, i) => `f${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `kp${i}`),
  "kpdecimal", "kpdivide", "kpmultiply", "kpminus", "kpplus", "kpenter", "kpequal", "kpseparator",
  "kpleft", "kpright", "kpup", "kpdown", "kppageup", "kppagedown", "kphome", "kpend", "kpinsert", "kpdelete",
  "capslock", "scrolllock", "numlock", "printscreen", "pause", "menu",
]);

/** `ctrl+shift+f`, `escape`, `kpenter`, `:`, `+`. Modifiers come first; the last part is the key name. */
export function parseChord(text: string): KeyChord {
  // A trailing `+` after the separator, or alone, is the `+` key.
  const plus = text === "+" || text.endsWith("++");
  const parts = (plus ? text.slice(0, -1) : text).split("+");
  const last = parts.pop();
  const name = plus && last === "" ? "+" : last;
  if (!name) throw new KeymapError(`invalid key: ${JSON.stringify(text)}`);
  // OpenTUI reports a capital letter as its lowercase name with Shift.
  if (/^[A-Z]$/.test(name)) throw new KeymapError(`${JSON.stringify(text)} names a capital letter; use shift+${name.toLowerCase()}`);
  if ([...name].length !== 1 && !NAMED_KEYS.has(name)) throw new KeymapError(`unknown key name ${JSON.stringify(name)} in ${JSON.stringify(text)}`);
  const chord: KeyChord = { name };
  for (const modifier of parts) {
    if (!MODIFIERS.has(modifier)) throw new KeymapError(`unknown modifier ${JSON.stringify(modifier)} in ${JSON.stringify(text)}`);
    chord[modifier as "ctrl" | "shift" | "alt"] = true;
  }
  return chord;
}

export function formatChord(chord: KeyChord): string {
  const label = chord.name.length === 1 ? chord.name.toUpperCase() : chord.name[0]!.toUpperCase() + chord.name.slice(1);
  return [chord.ctrl && "Ctrl", chord.alt && "Alt", chord.shift && "Shift", label].filter(Boolean).join("+");
}

function chordId(chord: KeyChord): string {
  return `${chord.name}|${chord.ctrl ? 1 : 0}|${chord.shift ? 1 : 0}|${chord.alt ? 1 : 0}`;
}

/** A chord that types its own character: one visible character, without Ctrl or Alt. */
function typesText(chord: KeyChord): boolean {
  return !chord.ctrl && !chord.alt && (chord.name === "space" || [...chord.name].length === 1);
}

/** Why a chord cannot be bound in a layer, if it cannot. */
function unusable(chord: KeyChord, layer: string, textLayers: ReadonlySet<string>): string | undefined {
  if (typesText(chord) && textLayers.has(layer)) return "types text there, so it could never run";
  return undefined;
}

function layerOf(actionId: string): string {
  const index = actionId.indexOf(".");
  if (index < 1 || index === actionId.length - 1) throw new KeymapError(`action id must be <layer>.<name>: ${JSON.stringify(actionId)}`);
  return actionId.slice(0, index);
}

interface Entry {
  token: object;
  action: Action;
}

interface KeyBindingsOptions {
  /** Replaces default chords per action; validated against the registered actions. */
  keymap?: Keymap;
  /** True for an always-textual region, a predicate for a conditionally textual one. */
  textRegions?: Readonly<Record<RegionId, boolean | (() => boolean)>>;
}

/**
 * The action registry and the chord tables built from it. Tables are rebuilt
 * when an action is added or removed; a chord bound twice in one layer is an
 * error, so a conflicting keymap is rejected rather than resolved by order.
 */
export class KeyBindings extends Emitter {
  readonly #actions = new Map<string, Entry>();
  readonly #keymap: Keymap;
  readonly #acceptsText: (region: RegionId) => boolean;
  readonly #textLayers: ReadonlySet<string>;
  #tables: Map<string, Map<string, string>> | undefined;

  constructor(options: KeyBindingsOptions = {}) {
    super();
    if (options.keymap !== undefined && (typeof options.keymap !== "object" || options.keymap === null || Array.isArray(options.keymap))) throw new KeymapError("keymap must be an object of action ids");
    this.#keymap = options.keymap ?? {};
    const regions = options.textRegions ?? {};
    this.#acceptsText = region => { const value = regions[region]; return typeof value === "function" ? value() : value === true; };
    this.#textLayers = new Set(Object.keys(regions).filter(region => regions[region] === true));
    for (const [id, chords] of Object.entries(this.#keymap)) {
      layerOf(id);
      if (!Array.isArray(chords) || !chords.every((chord) => typeof chord === "string")) throw new KeymapError(`keys of ${id} must be a list of strings`);
      chords.forEach(parseChord);
    }
  }

  register(actions: readonly Action[]): Registration {
    const batch = new Set<string>();
    for (const action of actions) {
      layerOf(action.id);
      if (batch.has(action.id) || this.#actions.has(action.id)) throw new DuplicateRegistrationError("action", action.id);
      batch.add(action.id);
    }
    const token = {};
    for (const action of actions) this.#actions.set(action.id, { token, action });
    try {
      this.#rebuild();
    } catch (error) {
      // A rejected batch leaves the earlier tables in force.
      for (const action of actions) this.#actions.delete(action.id);
      throw error;
    }
    return {
      dispose: () => {
        let removed = false;
        for (const action of actions) {
          if (this.#actions.get(action.id)?.token === token) {
            this.#actions.delete(action.id);
            removed = true;
          }
        }
        if (removed) this.#rebuild();
      },
    };
  }

  /** Reject keymap entries that name no registered action; call once the static contributions are in. */
  checkKeymap(): void {
    const unknown = Object.keys(this.#keymap).filter((id) => !this.#actions.has(id));
    if (unknown.length > 0) throw new KeymapError(`unknown actions in keymap: ${unknown.join(", ")}`);
  }

  /** The chords an action is bound to now, in keymap order. */
  chords(actionId: string): readonly KeyChord[] {
    const entry = this.#actions.get(actionId);
    if (!entry) return [];
    return (this.#keymap[actionId] ?? entry.action.keys ?? []).map(parseChord);
  }

  /** The action bound in the focused region, then the global one. */
  resolve(region: RegionId, key: KeyInput): Action | undefined {
    const chord: KeyChord = { name: key.name, ctrl: key.ctrl, shift: key.shift, alt: key.alt || key.meta || key.option };
    const text = typesText(chord) && this.#acceptsText(region);
    const tables = this.#tables ?? new Map();
    const id = chordId(chord);
    const applies = (actionId: string | undefined) => {
      const action = actionId === undefined ? undefined : this.#actions.get(actionId)?.action;
      return action && (!text || action.captureText) && (action.when?.() ?? true) ? action : undefined;
    };
    return applies(tables.get(region)?.get(id)) ?? applies(tables.get(GLOBAL_LAYER)?.get(id));
  }

  #rebuild(): void {
    const tables = new Map<string, Map<string, string>>();
    for (const { action } of this.#actions.values()) {
      const layer = layerOf(action.id);
      const table = tables.get(layer) ?? new Map<string, string>();
      tables.set(layer, table);
      for (const chord of this.chords(action.id)) {
        const reason = unusable(chord, layer, this.#textLayers);
        if (reason) throw new KeymapError(`${formatChord(chord)} for ${action.id} ${reason}`);
        const id = chordId(chord);
        const existing = table.get(id);
        if (existing !== undefined) throw new KeymapError(`${formatChord(chord)} is bound to both ${existing} and ${action.id}`);
        table.set(id, action.id);
      }
    }
    this.#tables = tables;
    this.changed();
  }
}
