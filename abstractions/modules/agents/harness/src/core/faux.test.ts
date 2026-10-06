import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, type ToolResultMessage } from "@earendil-works/pi-ai";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createFauxSession, type FauxSessionOptions } from "./faux";
import { createSessionHost } from "./session";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

async function runPrompt(options: FauxSessionOptions) {
  const cwd = await mkdtemp(join(tmpdir(), "harness-faux-"));
  directories.push(cwd);
  const { faux, customization } = createFauxSession(options);
  const host = await createSessionHost({
    cwd,
    agentDir: join(cwd, "agent"),
    settingsManager: SettingsManager.inMemory({}),
    sessionManager: SessionManager.inMemory(cwd),
    customization,
  });
  try {
    await host.runtime.session.prompt("go");
    await host.runtime.session.waitForIdle();
    const toolResults = host.runtime.session.messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
    return { cwd, faux, toolResults, files: await readdir(cwd) };
  } finally {
    await host.dispose();
  }
}

const touch = fauxAssistantMessage(
  [fauxThinking("make the file"), fauxToolCall("bash", { command: "touch made-by-bash" }, { id: "call-1" })],
  { stopReason: "toolUse" },
);

test("faux replies drive the real session, and given tool results replace running the tools", async () => {
  const { faux, toolResults, files } = await runPrompt({
    responses: [touch, fauxAssistantMessage([fauxText("done")])],
    toolResults: { "call-1": { content: [{ type: "text", text: "pretended" }] } },
  });
  expect(faux.getPendingResponseCount()).toBe(0);
  expect(toolResults.map((message) => message.content)).toEqual([[{ type: "text", text: "pretended" }]]);
  expect(files).not.toContain("made-by-bash");
});

test("a call without a given result fails as a tool error instead of running", async () => {
  const { toolResults, files } = await runPrompt({
    responses: [touch, fauxAssistantMessage([fauxText("done")])],
    toolResults: {},
  });
  expect(toolResults[0]?.isError).toBe(true);
  expect(files).not.toContain("made-by-bash");
});

test("without tool results, tools run for real", async () => {
  const { toolResults, files } = await runPrompt({ responses: [touch, fauxAssistantMessage([fauxText("done")])] });
  expect(toolResults[0]?.isError).toBe(false);
  expect(files).toContain("made-by-bash");
});
