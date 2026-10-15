import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/**
 * Token and cost totals of one branch, entries before a compaction included.
 * pi's `getSessionStats()` sums every entry of the session file, abandoned
 * branches too, so it cannot answer this. A tool result's usage already
 * includes the calls it made, and display records carry none, so nothing is
 * counted twice.
 */
export function branchUsage(branch: readonly SessionEntry[]): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const add = (usage: Usage | undefined) => {
    if (!usage) return;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
    totals.cost += usage.cost.total;
  };
  for (const entry of branch) {
    if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary")
      add(entry.usage);
    else if (
      entry.type === "message" &&
      (entry.message.role === "assistant" || entry.message.role === "toolResult")
    )
      add(entry.message.usage);
  }
  return totals;
}

function compact(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatUsage(totals: UsageTotals): string {
  const tokens = `↑${compact(totals.input)} ↓${compact(totals.output)}`;
  const cache = `${totals.cacheRead > 0 ? ` R${compact(totals.cacheRead)}` : ""}${totals.cacheWrite > 0 ? ` W${compact(totals.cacheWrite)}` : ""}`;
  return `${tokens}${cache} $${totals.cost.toFixed(3)}`;
}

/** Context use as pi estimates it; unknown, as right after a compaction, is not zero. */
export function formatContext(
  usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined,
): string {
  if (!usage) return "";
  if (usage.tokens === null || usage.percent === null)
    return `ctx ?/${compact(usage.contextWindow)}`;
  return `ctx ${usage.percent.toFixed(0)}% of ${compact(usage.contextWindow)}`;
}
