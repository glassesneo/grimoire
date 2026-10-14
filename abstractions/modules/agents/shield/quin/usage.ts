/**
 * Pi's session stats as the harness's src/core/usage.ts formats them. Pi's
 * totals cover the whole session file, which is the current branch here
 * because quin does not branch.
 */
// Pi saves usage with each message; these events can change the totals or the context estimate.
export const STATS_EVENTS = new Set(["message_end", "agent_settled", "compaction_end"]);

/** The part of Pi's get_session_stats response the statusline shows. */
export interface SessionStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

function compact(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
export function formatUsage(stats: SessionStats): string {
  const t = stats.tokens;
  const cache = `${t.cacheRead > 0 ? ` R${compact(t.cacheRead)}` : ""}${t.cacheWrite > 0 ? ` W${compact(t.cacheWrite)}` : ""}`;
  return `↑${compact(t.input)} ↓${compact(t.output)}${cache} $${stats.cost.toFixed(3)}`;
}
/** Context use as Pi estimates it; unknown, as right after a compaction, is not zero. */
export function formatContext(usage: SessionStats["contextUsage"]): string {
  if (!usage) return "";
  if (usage.tokens === null || usage.percent === null) return `ctx ?/${compact(usage.contextWindow)}`;
  return `ctx ${usage.percent.toFixed(0)}% of ${compact(usage.contextWindow)}`;
}
