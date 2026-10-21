/**
 * The keel contract (contracts/keel.tsp) for TypeScript: types inferred from its generated
 * JSON Schema, and validators compiled from the same schema. A receiver validates what it
 * receives with `validator(name)`; the value itself is used as received.
 */
import type { Static } from "typebox";
import Schema from "typebox/schema";
import contract from "../../contracts/generated/keel";

type Definitions = (typeof contract)["$defs"];

/** A definition of the contract as a TypeScript type. */
export type Definition<Name extends Extract<keyof Definitions, string>> = Static<{
  $defs: Definitions;
  $ref: `#/$defs/${Name}`;
}>;

const compile = <Name extends Extract<keyof Definitions, string>>(name: Name) =>
  Schema.Compile({ $defs: contract.$defs, $ref: `#/$defs/${name}` } as const);

const validators = new Map<string, ReturnType<typeof compile>>();

/** The validator of a definition, compiled once. */
export function validator<Name extends Extract<keyof Definitions, string>>(
  name: Name,
): {
  Check(value: unknown): value is Definition<Name>;
  Errors(value: unknown): [boolean, unknown[]];
} {
  let compiled = validators.get(name);
  if (!compiled) validators.set(name, (compiled = compile(name)));
  return compiled as never;
}

/** The first validation error of `value` as text, for a diagnostic. */
export function firstError(name: Extract<keyof Definitions, string>, value: unknown): string {
  const [, errors] = validator(name).Errors(value);
  const error = errors[0] as { instancePath?: string; message?: string } | undefined;
  return error ? `${error.instancePath || "/"}: ${error.message ?? "invalid"}` : "invalid";
}
