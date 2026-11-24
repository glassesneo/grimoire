import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { validateDecisionKeybindingOverrides, type DecisionKeybindingOverrides } from "./keymap.ts";

export interface DecisionUiConfig {
  schemaVersion: 1;
  keybindings: DecisionKeybindingOverrides;
}

export function validateDecisionUiConfig(
  value: unknown,
  path = "pi-decision-ui.json",
): DecisionUiConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path}: expected an object`);
  const root = value as Record<string, unknown>;
  const unknown = Object.keys(root).filter(
    (key) => key !== "schemaVersion" && key !== "keybindings",
  );
  if (unknown.length > 0) throw new Error(`${path}: unknown root field ${unknown[0]}`);
  if (root.schemaVersion !== 1)
    throw new Error(`${path}: unsupported schema version ${String(root.schemaVersion)}`);
  return {
    schemaVersion: 1,
    keybindings: validateDecisionKeybindingOverrides(root.keybindings, path),
  };
}

export function loadDecisionUiConfig(agentDir = getAgentDir()): {
  config: DecisionUiConfig;
  path: string;
} {
  const path = join(agentDir, "pi-decision-ui.json");
  try {
    return { config: validateDecisionUiConfig(JSON.parse(readFileSync(path, "utf8")), path), path };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { config: { schemaVersion: 1, keybindings: {} }, path };
    throw new Error(
      `${path}: malformed configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
