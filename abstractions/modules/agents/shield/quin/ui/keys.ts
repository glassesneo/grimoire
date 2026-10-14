/**
 * Keys and operations are separate: contributions register named actions with
 * default chords, and a keymap replaces the chords of any action by its id.
 *
 * An action id is `<layer>.<name>`. The layer is a region, or `global` for an
 * action reachable from every region. The focused region's chords are tried
 * first, then the global ones. A chord that types a character is not resolved
 * while the focused region accepts text, so it reaches the native input.
 */
import { DuplicateRegistrationError, Emitter, type RegionId, type Registration } from "./controllers";

export const GLOBAL_LAYER = "global";

export interface KeyChord {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** A key event as the renderer reports it. */
export interface KeyInput extends KeyChord {
  meta?: boolean;
  option?: boolean;
}

export interface Action {
  /** `<layer>.<name>`; the stable identifier a keymap refers to. */
  id: string;
  run(): void;
  /** Chords bound when the keymap does not name this action. */
  keys?: readonly string[];
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

/** `ctrl+shift+f`, `escape`, `kpenter`, `:`. Modifiers come first; the last part is the key name. */
export function parseChord(text: string): KeyChord {
  const parts = text.split("+");
  // `+` itself is a key name.
  if (text.endsWith("++")) parts.splice(-2, 2, "+");
  const name = parts.pop();
  if (!name) throw new KeymapError(`invalid key: ${JSON.stringify(text)}`);
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
  return !chord.ctrl && !chord.alt && [...chord.name].length === 1;
}

export function layerOf(actionId: string): string {
  const index = actionId.indexOf(".");
  if (index < 1 || index === actionId.length - 1) throw new KeymapError(`action id must be <layer>.<name>: ${JSON.stringify(actionId)}`);
  return actionId.slice(0, index);
}

interface Entry {
  token: object;
  action: Action;
}

export interface KeyBindingsOptions {
  /** Replaces default chords per action; validated against the registered actions. */
  keymap?: Keymap;
  /** Whether the focused region takes typed characters now. */
  acceptsText?(region: RegionId): boolean;
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
  #tables: Map<string, Map<string, string>> | undefined;

  constructor(options: KeyBindingsOptions = {}) {
    super();
    this.#keymap = options.keymap ?? {};
    this.#acceptsText = options.acceptsText ?? (() => false);
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
    if (typesText(chord) && this.#acceptsText(region)) return undefined;
    const tables = this.#tables ?? new Map();
    const id = chordId(chord);
    const actionId = tables.get(region)?.get(id) ?? tables.get(GLOBAL_LAYER)?.get(id);
    return actionId === undefined ? undefined : this.#actions.get(actionId)?.action;
  }

  #rebuild(): void {
    const tables = new Map<string, Map<string, string>>();
    for (const { action } of this.#actions.values()) {
      const layer = layerOf(action.id);
      const table = tables.get(layer) ?? new Map<string, string>();
      tables.set(layer, table);
      for (const chord of this.chords(action.id)) {
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
