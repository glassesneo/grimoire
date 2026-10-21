// The generated contract as both sides use it: the TypeScript validator judges the shared
// cases (contracts/cases.json) as the model's does, and the inferred types keep tags,
// dictionary values, required fields, and references. The type assertions are checked by the
// project's type check.
import { expect, test } from "bun:test";
import cases from "../../contracts/cases.json";
import { type Definition, validator } from "./contract";

test("the shared cases are judged as the contract says", () => {
  for (const { definition, value, valid } of cases.cases)
    expect([definition, validator(definition as "DriverRecord").Check(value)]).toEqual([
      definition,
      valid,
    ]);
});

// Tags narrow, and fields of another variant do not exist.
export function narrowing(record: Definition<"DriverRecord">, item: Definition<"Item">) {
  if (record.type === "operation" && record.operation.op === "set_draft") {
    const text: string = record.operation.text;
    void text;
  }
  if (record.type === "entries")
    for (const entry of record.entries)
      if (entry.kind === "tool") {
        const state: "pending" | "running" | "done" | "error" | "unfinished" = entry.state;
        void state;
      }
  if (item.kind === "tool") {
    const callId: string = item.data.callId;
    void callId;
  }
  // @ts-expect-error a prose item has no call id
  if (item.kind === "prose") void item.data.callId;
}

// Dictionaries keep their value types; required fields are required; objects are closed.
export function shapes(state: Definition<"State">) {
  const revision: number | undefined = state.drafts["prompt"]?.revision;
  const chords: string[] | undefined = state.keys["editor.submit"];
  const renderer: string | undefined = state.kinds["tool"];
  // @ts-expect-error a draft's revision is a number
  const draft: Definition<"Draft"> = { text: "", revision: "0" };
  // @ts-expect-error a draft needs its revision
  const partial: Definition<"Draft"> = { text: "" };
  // @ts-expect-error an instruction has no undeclared fields
  const extra: Definition<"Instruction"> = { type: "submit", id: "1", text: "x", more: 1 };
  void [revision, chords, renderer, draft, partial, extra];
}
