/**
 * The `data` of each item kind the required projection produces, which the
 * screen's renderers read. A renderer reads only these fields; it never reads
 * Pi's messages.
 */

export type ToolState = "pending" | "running" | "done" | "error" | "unfinished";

export type ToolArguments = { available: true; value: unknown } | { available: false };

/** Pi's stop reason: "stop", "length", "toolUse", "error", "aborted", or another a provider reports. */
export type StopReason = string;

export interface UserData {
  text: string;
  /** Attachment descriptions; images themselves are not sent. */
  images: string[];
}

export interface ResponseData {
  /** Thinking text joined, for a collapsed preview. */
  thinking: string;
  hasThinking: boolean;
  /** Every thinking block was withheld; there is nothing to preview. */
  thinkingWithheld: boolean;
  /** The prose and code as the model wrote them. */
  body: string;
  streaming: boolean;
  stopReason?: StopReason;
  errorMessage?: string;
}

export interface ThinkingData {
  text: string;
  withheld: boolean;
}

export interface ProseData {
  text: string;
  streaming: boolean;
}

export interface CodeData {
  language: string;
  body: string;
  /** The raw fenced block, fences included. */
  sourceText: string;
  /** No closing fence yet, as while a reply streams. */
  open: boolean;
}

export interface NestedCallSummary {
  name: string;
  args: ToolArguments;
  state: ToolState;
}

export interface ToolResultData {
  /** The result's text blocks joined. */
  text: string;
  /** Descriptions of the result's images. */
  images: string[];
  details?: unknown;
  /** A streamed update rather than the final result. */
  partial: boolean;
}

export interface ToolData {
  callId: string;
  name: string;
  args: ToolArguments;
  state: ToolState;
  /** Absent when no result arrived; not an empty result. */
  result?: ToolResultData;
  /** Calls this tool made, and calls those made, in the order they started. */
  calls: NestedCallSummary[];
  /** What the extension that owns this tool's presentation added, by its name. */
  extra?: Record<string, unknown>;
}

export type CompactionState = "running" | "completed" | "failed" | "aborted";

export interface CompactionData {
  state: CompactionState;
  reason?: string;
  summary?: string;
  tokensBefore?: number;
  errorMessage?: string;
}

export type RetryState = "waiting" | "retrying" | "succeeded" | "failed" | "ended";

export interface RetryAttempt {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
}

export interface RetryData {
  category: "response" | "summary";
  state: RetryState;
  attempts: RetryAttempt[];
  finalError?: string;
}

export interface CustomData {
  customType: string;
  text: string;
  details?: unknown;
}

export interface ConfigData {
  setting: "model" | "thinking";
  from: string;
  to: string;
}

export type NoticeLevel = "info" | "warning" | "error";

export interface NoticeData {
  level: NoticeLevel;
  text: string;
}
