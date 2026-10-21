/**
 * Chords as screens resolve them. keel's model applies `keybindings.json` to the
 * declared actions and publishes each action's chords (`State.keys`); a screen
 * parses them into tables and looks keys up there.
 *
 * An action's layer is its id's prefix when that names a focus region
 * (`editor`, `timeline`, `stage`), and the global layer otherwise. The global
 * layer is consulted first, so a global chord always wins; the focused
 * region's layer is consulted next.
 *
 * A key is a single character or a name OpenTUI reports, such as `return`,
 * `escape`, or `space`; a capital letter is `shift+<letter>`.
 */

export const REGIONS = ["editor", "timeline", "stage"] as const;
export type Region = (typeof REGIONS)[number];
export const GLOBAL = "global";

export interface Chord {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export class ChordError extends Error {}

const MODIFIERS = new Set(["ctrl", "shift", "alt"]);

/** The names OpenTUI reports for keys that type no single character. */
const NAMED_KEYS = new Set([
  "return",
  "linefeed",
  "escape",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  ...Array.from({ length: 35 }, (_, i) => `f${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `kp${i}`),
  "kpdecimal",
  "kpdivide",
  "kpmultiply",
  "kpminus",
  "kpplus",
  "kpenter",
  "kpequal",
  "kpseparator",
  "kpleft",
  "kpright",
  "kpup",
  "kpdown",
  "kppageup",
  "kppagedown",
  "kphome",
  "kpend",
  "kpinsert",
  "kpdelete",
  "capslock",
  "scrolllock",
  "numlock",
  "printscreen",
  "pause",
  "menu",
]);

/** One user-perceived character, such as a letter with a combining mark. */
function isCharacter(text: string): boolean {
  return Array.from(new Intl.Segmenter().segment(text)).length === 1;
}

/** `ctrl+shift+f`, `escape`, `kpenter`, `:`, `+`. Modifiers come first; the last part is the key. */
export function parseChord(text: string): Chord {
  const plus = text === "+" || text.endsWith("++");
  const parts = (plus ? text.slice(0, -1) : text).split("+");
  const last = parts.pop();
  const name = plus && last === "" ? "+" : last;
  if (!name) throw new ChordError(`invalid key ${JSON.stringify(text)}`);
  if (/^[A-Z]$/.test(name))
    throw new ChordError(
      `${JSON.stringify(text)} names a capital letter; use shift+${name.toLowerCase()}`,
    );
  if (!isCharacter(name) && !NAMED_KEYS.has(name))
    throw new ChordError(`unknown key name ${JSON.stringify(name)} in ${JSON.stringify(text)}`);
  const chord: Chord = { name };
  for (const modifier of parts) {
    if (!MODIFIERS.has(modifier))
      throw new ChordError(
        `unknown modifier ${JSON.stringify(modifier)} in ${JSON.stringify(text)}`,
      );
    chord[modifier as "ctrl" | "shift" | "alt"] = true;
  }
  return chord;
}

export function formatChord(chord: Chord): string {
  const label =
    chord.name.length === 1
      ? chord.name.toUpperCase()
      : chord.name[0]!.toUpperCase() + chord.name.slice(1);
  return [chord.ctrl && "Ctrl", chord.alt && "Alt", chord.shift && "Shift", label]
    .filter(Boolean)
    .join("+");
}

export function chordId(chord: Chord): string {
  return `${chord.name}|${chord.ctrl ? 1 : 0}|${chord.shift ? 1 : 0}|${chord.alt ? 1 : 0}`;
}

export function layerOf(actionId: string): Region | typeof GLOBAL {
  const prefix = actionId.slice(0, Math.max(0, actionId.indexOf(".")));
  return (REGIONS as readonly string[]).includes(prefix) ? (prefix as Region) : GLOBAL;
}

/** A key event as the renderer reports it. */
export interface KeyInput extends Chord {
  meta?: boolean;
  option?: boolean;
}

/** The chord tables of published keys, for resolving input. */
export class KeyTables {
  readonly #tables = new Map<string, Map<string, string>>();

  constructor(keys: Record<string, readonly string[]>) {
    for (const [id, chords] of Object.entries(keys)) {
      const layer = layerOf(id);
      const table = this.#tables.get(layer) ?? new Map<string, string>();
      this.#tables.set(layer, table);
      for (const text of chords) {
        try {
          table.set(chordId(parseChord(text)), id);
        } catch {
          // The model published only valid chords.
        }
      }
    }
  }

  /** The global action bound to the key, if any. */
  global(key: KeyInput): string | undefined {
    return this.#tables.get(GLOBAL)?.get(chordId(normalize(key)));
  }

  /** The focused region's action bound to the key, if any. */
  region(region: string, key: KeyInput): string | undefined {
    return this.#tables.get(region)?.get(chordId(normalize(key)));
  }
}

function normalize(key: KeyInput): Chord {
  return {
    name: key.name,
    ctrl: key.ctrl,
    shift: key.shift,
    alt: key.alt || key.meta || key.option,
  };
}

export const chordsOf = (keys: Record<string, readonly string[]>, id: string): Chord[] =>
  (keys[id] ?? []).flatMap((text) => {
    try {
      return [parseChord(text)];
    } catch {
      return [];
    }
  });
