/**
 * The `data` of each item kind, which the screen's renderers read, as the keel contract
 * (contracts/keel.tsp) defines it. A renderer reads only these fields; it never reads Pi's
 * messages.
 */
import type { Definition } from "./contract";

export type ToolState = Definition<"ToolState">;
export type ToolArguments = Definition<"ToolArguments">;
export type UserData = Definition<"UserData">;
export type ResponseData = Definition<"ResponseData">;
export type ThinkingData = Definition<"ThinkingData">;
export type ProseData = Definition<"ProseData">;
export type CodeData = Definition<"CodeData">;
export type NestedCallSummary = Definition<"NestedCallSummary">;
export type ToolResultData = Definition<"ToolResultData">;
export type ToolData = Definition<"ToolData">;
export type CompactionData = Definition<"CompactionData">;
export type RetryAttempt = Definition<"RetryAttempt">;
export type RetryData = Definition<"RetryData">;
export type CustomData = Definition<"CustomData">;
export type ConfigData = Definition<"ConfigData">;
export type NoticeLevel = Definition<"NoticeLevel">;
export type NoticeData = Definition<"NoticeData">;
