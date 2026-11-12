/*
Copyright (c) 2026 glassesneo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

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

/** A missing optional configuration is equivalent to no overrides. */
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
