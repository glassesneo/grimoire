/**
 * The one-row top and bottom status lines and the run state indicator. Both
 * are information only: neither takes focus or holds a selection.
 */
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { DuplicateRegistrationError, Emitter, type Registration } from "./controllers";
import { useVersion } from "./state";
import { Line, palette } from "./style";

export type StatuslinePosition = "top" | "bottom";

export interface StatuslineSegment {
  text: string;
  color?: string;
}

/** A compiled statusline contribution kind: a value rendered as one segment. */
export interface StatuslineItemType<T> {
  kind: string;
  segment(value: T): StatuslineSegment;
  /** Checks a value from outside the harness; a type without it is not client-accessible. */
  validate?(value: unknown): value is T;
}

export interface StatuslineContribution {
  update(segment: StatuslineSegment): void;
  dispose(): void;
}

/** Fields the harness owns; contributions cannot replace or remove them. */
export interface StatuslineFields {
  session?: string;
  cwd?: string;
  model?: string;
  thinking?: string;
  context?: string;
  totals?: string;
}

interface Contribution {
  position: StatuslinePosition;
  segment: StatuslineSegment;
}

export class StatuslineController extends Emitter {
  readonly #types = new Map<string, { token: object; type: StatuslineItemType<unknown> }>();
  readonly #contributions: Contribution[] = [];
  #fields: StatuslineFields = {};

  registerType<T>(type: StatuslineItemType<T>): Registration {
    if (this.#types.has(type.kind)) throw new DuplicateRegistrationError("statusline", type.kind);
    const token = {};
    this.#types.set(type.kind, { token, type: type as unknown as StatuslineItemType<unknown> });
    return {
      dispose: () => {
        if (this.#types.get(type.kind)?.token === token) this.#types.delete(type.kind);
      },
    };
  }

  lookup(kind: string): StatuslineItemType<unknown> | undefined {
    return this.#types.get(kind)?.type;
  }

  setFields(fields: StatuslineFields): void {
    const next = { ...this.#fields, ...fields };
    if ((Object.keys(next) as (keyof StatuslineFields)[]).every((key) => next[key] === this.#fields[key])) return;
    this.#fields = next;
    this.changed();
  }

  fields(): StatuslineFields {
    return this.#fields;
  }

  /** Add a segment after earlier contributions; its handle owns only this segment. */
  contribute(position: StatuslinePosition, segment: StatuslineSegment): StatuslineContribution {
    const contribution: Contribution = { position, segment };
    this.#contributions.push(contribution);
    this.changed();
    return {
      update: (next) => {
        if (!this.#contributions.includes(contribution)) return;
        contribution.segment = next;
        this.changed();
      },
      dispose: () => {
        const index = this.#contributions.indexOf(contribution);
        if (index === -1) return;
        this.#contributions.splice(index, 1);
        this.changed();
      },
    };
  }

  contributions(position: StatuslinePosition): readonly StatuslineSegment[] {
    return this.#contributions.filter((contribution) => contribution.position === position).map((contribution) => contribution.segment);
  }
}

/** Terminal columns a string occupies. */
export const displayWidth = (text: string): number => Bun.stringWidth(text);

/** Cut `text` to `width` columns, keeping its start or, for paths, its end. */
export function fitText(text: string, width: number, keep: "start" | "end" = "start"): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  const characters = [...text];
  let result = "";
  if (keep === "end") {
    for (let index = characters.length - 1; index >= 0; index--) {
      const next = characters[index] + result;
      if (displayWidth(`…${next}`) > width) break;
      result = next;
    }
    return `…${result}`;
  }
  for (const character of characters) {
    if (displayWidth(`${result}${character}…`) > width) break;
    result += character;
  }
  return `${result}…`;
}

export interface LineSegment extends StatuslineSegment {
  /** Lower numbers are kept first when the line is too narrow. */
  priority: number;
  /** Shortened instead of dropped, keeping this end. */
  shrink?: "start" | "end";
}

const SEPARATOR = " · ";

/** Segments that fit `width`, in their original order, dropping or shortening the lowest priorities first. */
export function composeLine(segments: readonly LineSegment[], width: number): StatuslineSegment[] {
  const present = segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment.text !== "");
  const fitted = new Map<number, string>();
  let used = 0;
  for (const { segment, index } of [...present].sort((a, b) => a.segment.priority - b.segment.priority)) {
    const separator = fitted.size > 0 ? displayWidth(SEPARATOR) : 0;
    const textWidth = displayWidth(segment.text);
    if (used + separator + textWidth <= width) {
      fitted.set(index, segment.text);
      used += separator + textWidth;
    } else if (segment.shrink && width - used - separator >= 8) {
      // Any shorter and a shortened segment says nothing.
      const text = fitText(segment.text, width - used - separator, segment.shrink);
      fitted.set(index, text);
      used += separator + displayWidth(text);
    }
  }
  return present.flatMap(({ segment, index }) => {
    const text = fitted.get(index);
    return text === undefined ? [] : [{ text, color: segment.color }];
  });
}

export function StatuslineView(props: { segments: readonly LineSegment[]; width: number }): JSX.Element {
  const line = () => composeLine(props.segments, Math.max(0, props.width - 2));
  return (
    <box height={1} width="100%" paddingX={1} flexShrink={0}>
      <Line wrap="none" parts={line().flatMap((segment, index) => [
        index > 0 ? ([SEPARATOR, palette.dim] as const) : undefined,
        [segment.text, segment.color ?? palette.dim] as const,
      ])} />
    </box>
  );
}

/** The built-in fields and contributions of one line, with their width priorities. */
export function statuslineSegments(controller: StatuslineController, position: StatuslinePosition): LineSegment[] {
  const fields = controller.fields();
  const extra = controller.contributions(position).map((segment, index) => ({ ...segment, priority: 10 + index }));
  if (position === "top") {
    return [
      { text: fields.session ?? "", color: palette.text, priority: 1, shrink: "start" },
      { text: fields.cwd ?? "", priority: 0, shrink: "end" },
      ...extra,
    ];
  }
  return [
    { text: fields.model ?? "", color: palette.text, priority: 0, shrink: "end" },
    { text: fields.thinking ?? "", priority: 1 },
    { text: fields.context ?? "", priority: 2 },
    // Shortened from the left, so the cost is the last part to go.
    { text: fields.totals ?? "", priority: 5, shrink: "end" },
    ...extra,
  ];
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export const DEFAULT_WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const DEFAULT_WORKING_INTERVAL_MS = 80;
export const DEFAULT_WORKING_MESSAGE = "Working…";

/** Whether accepted work is running, and how extensions asked the indicator to look. */
export class RunStateController extends Emitter {
  #active = false;
  #message: string | undefined;
  #visible = true;
  #frames: string[] | undefined;
  #intervalMs: number | undefined;

  active(): boolean {
    return this.#active;
  }

  setActive(active: boolean): void {
    if (this.#active === active) return;
    this.#active = active;
    this.changed();
  }

  /** Omitted, the default message returns. */
  setMessage(message?: string): void {
    this.#message = message;
    this.changed();
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.changed();
  }

  /** Omitted, the default spinner returns; `frames: []` hides the glyph but keeps the message. */
  setIndicator(options?: { frames?: string[]; intervalMs?: number }): void {
    this.#frames = options?.frames ? [...options.frames] : undefined;
    this.#intervalMs = options?.intervalMs;
    this.changed();
  }

  /** What to draw, or undefined when nothing is shown. */
  snapshot(): { message: string; frames: string[]; intervalMs: number } | undefined {
    if (!this.#active || !this.#visible) return undefined;
    return {
      message: this.#message ?? DEFAULT_WORKING_MESSAGE,
      frames: this.#frames ?? DEFAULT_WORKING_FRAMES,
      intervalMs: Math.max(16, this.#intervalMs ?? DEFAULT_WORKING_INTERVAL_MS),
    };
  }
}

/** A borderless spinner and message; the timer runs only while there is more than one frame to show. */
export function RunStateIndicator(props: { controller: RunStateController }): JSX.Element {
  const version = useVersion(props.controller);
  const state = () => (version(), props.controller.snapshot());
  const [frame, setFrame] = createSignal(0);
  // Restart the animation only when the frames themselves change, not on every update.
  const animation = createMemo(() => {
    const current = state();
    return current && current.frames.length > 1 ? `${current.intervalMs}\u0000${current.frames.join("\u0000")}` : undefined;
  });
  createEffect(() => {
    const key = animation();
    setFrame(0);
    if (!key) return;
    const [interval, ...frames] = key.split("\u0000");
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), Number(interval));
    onCleanup(() => clearInterval(timer));
  });
  return (
    <Line wrap="none" parts={[
      state()?.frames.length ? [`${state()!.frames[frame() % state()!.frames.length]} `, palette.accent] : undefined,
      [state()?.message ?? "", palette.dim],
    ]} />
  );
}
