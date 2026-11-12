export const stopWindowMs = 1_500;
// Without key-repeat reports, a second press stops only after this much quiet.
// Terminal auto-repeat sends the next event sooner, so a held key never stops.
export const settleMs = 120;

export interface StopState {
  key: string | null;
  at: number;
  // armed: one press seen; pending: a second press awaits quiet; repeating: a held key.
  phase: "idle" | "armed" | "pending" | "repeating";
}

export const idleStop: StopState = { key: null, at: 0, phase: "idle" };

export type StopEffect = "none" | "clear-input" | "stop" | "armed" | "pending";

/** Reduces a press of a stop key, or the settle timer that a pending press started. */
export function reduceStop(
  state: StopState,
  event: {
    type: "key" | "settle";
    key?: string;
    now?: number;
    running?: boolean;
    repeat?: boolean;
    repeatKnown?: boolean;
  },
): { state: StopState; effect: StopEffect } {
  const now = event.now ?? 0;
  if (event.type === "settle") {
    return state.phase === "pending" && now - state.at >= settleMs
      ? { state: idleStop, effect: "stop" }
      : { state, effect: "none" };
  }
  const key = event.key ?? "";
  if (event.repeat) return { state, effect: "none" };
  if (!event.running) return { state: idleStop, effect: key === "ctrl+c" ? "clear-input" : "none" };
  const arm = { state: { key, at: now, phase: "armed" as const }, effect: "armed" as const };
  const same = state.key === key && now >= state.at;
  if (event.repeatKnown) {
    return same && state.phase === "armed" && now - state.at <= stopWindowMs
      ? { state: idleStop, effect: "stop" }
      : arm;
  }
  if (
    same &&
    (state.phase === "pending" || state.phase === "repeating") &&
    now - state.at < settleMs
  )
    return { state: { key, at: now, phase: "repeating" }, effect: "none" };
  if (same && state.phase === "armed" && now - state.at <= stopWindowMs)
    return { state: { key, at: now, phase: "pending" }, effect: "pending" };
  return arm;
}
