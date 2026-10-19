/**
 * Chords and the key configuration. The runtime applies `keybindings.json` to
 * the registered actions once every extension has registered, and publishes
 * the resulting chords; the screen resolves keys against them.
 *
 * An action's layer is its id's prefix when that names a focus region
 * (`editor`, `timeline`, `stage`), and the global layer otherwise. The global
 * layer is consulted first, so a global chord always wins; the focused
 * region's layer is consulted next. Global actions have no default chords:
 * defaults an extension gives one are reported and not bound.
 *
 * A key is a single character or a name OpenTUI reports, such as `return`,
 * `escape`, or `space`; a capital letter is `shift+<letter>`. The
 * configuration maps an action id to one chord or a list; an empty list
 * unbinds the action. Problems never stop the runtime: an unknown action is
 * reported; a global chord that shadows a region's is reported and the global
 * one wins; an unknown key, a character chord in the editor, or a chord bound
 * twice in one layer is reported and that binding is dropped.
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

/** A chord that types its own character: one visible character, without Ctrl or Alt. */
export function typesText(chord: Chord): boolean {
  return !chord.ctrl && !chord.alt && (chord.name === "space" || isCharacter(chord.name));
}

export function layerOf(actionId: string): Region | typeof GLOBAL {
  const prefix = actionId.slice(0, Math.max(0, actionId.indexOf(".")));
  return (REGIONS as readonly string[]).includes(prefix) ? (prefix as Region) : GLOBAL;
}

export function validActionId(id: string): boolean {
  return /^[a-z][a-z0-9_-]*\.[a-z0-9_.-]+$/.test(id);
}

export interface KeyDiagnostic {
  level: "warning" | "error";
  text: string;
}

/**
 * The chords of every action: its defaults unless the configuration names it,
 * with invalid and ambiguous bindings dropped and reported.
 */
export function applyKeyConfig(
  actions: readonly { id: string; keys?: readonly string[] }[],
  config: unknown,
): { keys: Record<string, string[]>; diagnostics: KeyDiagnostic[] } {
  const diagnostics: KeyDiagnostic[] = [];
  const configured = new Map<string, string[]>();
  if (config !== undefined) {
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      diagnostics.push({ level: "error", text: "keybindings: expected an object of action ids" });
    } else {
      for (const [id, value] of Object.entries(config)) {
        const chords = typeof value === "string" ? [value] : value;
        if (!Array.isArray(chords) || !chords.every((chord) => typeof chord === "string")) {
          diagnostics.push({
            level: "error",
            text: `keybindings: ${id} must be a key or a list of keys; ignored`,
          });
          continue;
        }
        configured.set(id, chords);
      }
    }
  }
  const known = new Set(actions.map((action) => action.id));
  for (const id of configured.keys())
    if (!known.has(id))
      diagnostics.push({ level: "warning", text: `keybindings: unknown action ${id}` });

  // Parse, then drop what can never run.
  const candidates: { id: string; layer: string; text: string; chord: Chord }[] = [];
  for (const action of actions) {
    const layer = layerOf(action.id);
    if (layer === GLOBAL && !configured.has(action.id) && action.keys?.length)
      diagnostics.push({
        level: "warning",
        text: `keybindings: ${action.id} is global, so its default keys are not bound`,
      });
    const defaults = layer === GLOBAL ? [] : (action.keys ?? []);
    for (const text of configured.get(action.id) ?? defaults) {
      let chord: Chord;
      try {
        chord = parseChord(text);
      } catch (error) {
        diagnostics.push({
          level: "error",
          text: `keybindings: ${action.id}: ${(error as Error).message}; binding dropped`,
        });
        continue;
      }
      if (layer === "editor" && typesText(chord)) {
        diagnostics.push({
          level: "error",
          text: `keybindings: ${formatChord(chord)} for ${action.id} types text in the editor; binding dropped`,
        });
        continue;
      }
      candidates.push({ id: action.id, layer, text, chord });
    }
  }
  // A chord bound twice in one layer is ambiguous; neither binding stays.
  const byLayer = new Map<string, Map<string, string[]>>();
  for (const candidate of candidates) {
    const table = byLayer.get(candidate.layer) ?? new Map<string, string[]>();
    byLayer.set(candidate.layer, table);
    const owners = table.get(chordId(candidate.chord)) ?? [];
    if (!owners.includes(candidate.id)) owners.push(candidate.id);
    table.set(chordId(candidate.chord), owners);
  }
  const ambiguous = new Set<string>();
  for (const [layer, table] of byLayer)
    for (const [id, owners] of table)
      if (owners.length > 1) {
        ambiguous.add(`${layer}#${id}`);
        const chord = candidates.find((c) => c.layer === layer && chordId(c.chord) === id)!.chord;
        diagnostics.push({
          level: "error",
          text: `keybindings: ${formatChord(chord)} is bound to ${owners.join(" and ")}; those bindings are dropped`,
        });
      }
  const keys: Record<string, string[]> = Object.fromEntries(actions.map((a) => [a.id, []]));
  for (const candidate of candidates) {
    if (ambiguous.has(`${candidate.layer}#${chordId(candidate.chord)}`)) continue;
    keys[candidate.id]!.push(candidate.text);
  }
  const global = byLayer.get(GLOBAL);
  if (global)
    for (const [layer, table] of byLayer) {
      if (layer === GLOBAL) continue;
      for (const [id, owners] of table) {
        const shadow = global.get(id);
        if (!shadow || ambiguous.has(`${GLOBAL}#${id}`) || ambiguous.has(`${layer}#${id}`))
          continue;
        const chord = candidates.find((c) => chordId(c.chord) === id)!.chord;
        diagnostics.push({
          level: "warning",
          text: `keybindings: global ${shadow[0]} takes ${formatChord(chord)} before ${owners[0]}`,
        });
      }
    }
  return { keys, diagnostics };
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
          // The runtime published only valid chords.
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
