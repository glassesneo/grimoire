/**
 * The one-row top and bottom status lines and the run state indicator. Both
 * are information only: neither takes focus or holds a selection.
 */
import { createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { Emitter } from "./controllers";
import { useVersion } from "./state";
import { Line, palette } from "./timeline-types";

type StatuslinePosition = "top" | "bottom";

interface StatuslineSegment {
  text: string;
  color?: string;
}

export interface StatuslineContribution {
  update(segment: StatuslineSegment): void;
  dispose(): void;
}

/** Fields the harness owns; contributions cannot replace or remove them. */
interface StatuslineFields {
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
  readonly #contributions: Contribution[] = [];
  #fields: StatuslineFields = {};

  setFields(fields: StatuslineFields): void {
    const next = { ...this.#fields, ...fields };
    if (
      (Object.keys(next) as (keyof StatuslineFields)[]).every(
        (key) => next[key] === this.#fields[key],
      )
    )
      return;
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
        if (next.text === contribution.segment.text && next.color === contribution.segment.color)
          return;
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
    return this.#contributions
      .filter((contribution) => contribution.position === position)
      .map((contribution) => contribution.segment);
  }
}

/** Terminal columns a string occupies. */
const displayWidth = (text: string): number => Bun.stringWidth(text);

/** Cut `text` to `width` columns, keeping its start or, for paths, its end. */
function fitText(text: string, width: number, keep: "start" | "end" = "start"): string {
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

interface LineSegment extends StatuslineSegment {
  /** Lower numbers are kept first when the line is too narrow. */
  priority: number;
  /** Shortened instead of dropped, keeping this end. */
  shrink?: "start" | "end";
}

const SEPARATOR = " · ";

/** Segments that fit `width`, in their original order, dropping or shortening the lowest priorities first. */
function composeLine(segments: readonly LineSegment[], width: number): StatuslineSegment[] {
  const present = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.text !== "");
  const fitted = new Map<number, string>();
  let used = 0;
  for (const { segment, index } of [...present].sort(
    (a, b) => a.segment.priority - b.segment.priority,
  )) {
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

export function StatuslineView(props: {
  segments: readonly LineSegment[];
  width: number;
}): JSX.Element {
  const line = () => composeLine(props.segments, Math.max(0, props.width - 2));
  return (
    <box height={1} width="100%" paddingX={1} flexShrink={0}>
      <Line
        wrap="none"
        parts={line().flatMap((segment, index) => [
          index > 0 ? ([SEPARATOR, palette.dim] as const) : undefined,
          [segment.text, segment.color ?? palette.dim] as const,
        ])}
      />
    </box>
  );
}

/** The built-in fields and contributions of one line, with their width priorities. */
export function statuslineSegments(
  controller: StatuslineController,
  position: StatuslinePosition,
): LineSegment[] {
  const fields = controller.fields();
  const extra = controller
    .contributions(position)
    .map((segment, index) => ({ ...segment, priority: 10 + index }));
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

const WORKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WORKING_INTERVAL_MS = 80;
const WORKING_MESSAGE = "Working…";

/** Whether accepted work is running, and the message beside the spinner. */
export class RunStateController extends Emitter {
  #active = false;
  #message: string | undefined;

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
    if (message === this.#message) return;
    this.#message = message;
    this.changed();
  }

  /** The message to draw, or undefined when nothing is shown. */
  message(): string | undefined {
    return this.#active ? (this.#message ?? WORKING_MESSAGE) : undefined;
  }
}

/** A borderless spinner and message; the timer runs only while work is running. */
export function RunStateIndicator(props: { controller: RunStateController }): JSX.Element {
  const version = useVersion(props.controller);
  const message = () => (version(), props.controller.message());
  const running = createMemo(() => message() !== undefined);
  const [frame, setFrame] = createSignal(0);
  createEffect(() => {
    setFrame(0);
    if (!running()) return;
    const timer = setInterval(
      () => setFrame((value) => (value + 1) % WORKING_FRAMES.length),
      WORKING_INTERVAL_MS,
    );
    onCleanup(() => clearInterval(timer));
  });
  return (
    <Line
      wrap="none"
      parts={[
        running() ? [`${WORKING_FRAMES[frame()]} `, palette.accent] : undefined,
        [message() ?? "", palette.dim],
      ]}
    />
  );
}
