/**
 * keel's records as TypeScript: the types of the keel contract (contracts/keel.tsp, through
 * ./contract.ts) that the screen and the driver use, and the draft destinations. The contract
 * owns every shape; nothing here declares one.
 */
import type { Definition } from "./contract";

// What the model publishes and screens follow.
export type Snapshot = Definition<"Snapshot">;
export type StateEvent = Definition<"StateEvent">;
export type Changes = Definition<"Changes">;
export type State = Definition<"State">;
export type SessionInfo = Definition<"SessionInfo">;
export type RunInfo = Definition<"RunInfo">;
export type QueueInfo = Definition<"QueueInfo">;
export type Item = Definition<"Item">;
export type RequestInfo = Definition<"RequestInfo">;
export type AssistInfo = Definition<"AssistInfo">;
export type Candidate = Definition<"Candidate">;
export type Draft = Definition<"Draft">;
export type ActionClass = Definition<"ActionClass">;
export type ActionInfo = Definition<"ActionInfo">;

// A screen's requests and their results.
export type InvokeResult = Definition<"InvokeResult">;
export type AttachOptions = Definition<"AttachOptions">;

// The driver and the model.
export type DriverRecord = Definition<"DriverRecord">;
export type Instruction = Definition<"Instruction">;
export type Entry = Definition<"Entry">;
export type ToolEntry = Definition<"ToolEntry">;
export type Operation = Definition<"Operation">;
export type OperationValue = Definition<"OperationValue">;
export type DriverResult = Definition<"DriverResult">;
export type RequestAnswer = Definition<"RequestAnswer">;

/** Draft destination of the prompt. */
export const PROMPT = "prompt";
export const assistDestination = (id: string) => `assist:${id}`;
