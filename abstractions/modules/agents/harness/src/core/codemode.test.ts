import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSession, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createSessionHost } from "./session";

// The host owns extension wiring across runtime replacement. Builds cannot catch
// a missing factory or loadout; Pi owns projecting hidden declarations into requests.
function expectCodemodeLoadout(session: AgentSession) {
  const codemode = session.getToolDefinition("codemode");
  expect(codemode).toBeDefined();
  expect(session.getActiveToolNames()).toContain("codemode");
  const callable = session.getCallableToolNames();
  const ordinary = ["read", "bash", "edit", "write"];
  for (const name of ordinary) expect(callable).toContain(name);

  const definitions = session.getAllTools();
  const loadout = codemode!.prepareLoadout!({
    declared: session.agent.state.tools,
    callable: session.agent.state.tools.filter((tool) => callable.includes(tool.name)),
    registered: session.agent.state.tools,
    getExposure: (name) => definitions.find((tool) => tool.name === name)?.exposure ?? "direct",
    getNamespace: (name) => definitions.find((tool) => tool.name === name)?.namespace,
    getPromptGuidelines: () => [],
  });
  for (const name of ordinary) expect(loadout?.hiddenDeclarations).toContain(name);
  expect(loadout?.hiddenDeclarations).not.toContain("codemode");
}

test("the host retains ordinary callable tools behind codemode when replacing a session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harness-codemode-"));
  const host = await createSessionHost({
    cwd: directory,
    agentDir: join(directory, "agent"),
    settingsManager: SettingsManager.inMemory({
      defaultTools: ["+codemode"],
      codemode: { mode: "only" },
    }),
    sessionManager: SessionManager.create(directory, join(directory, "sessions")),
  });
  try {
    const initial = host.runtime.session;
    expectCodemodeLoadout(initial);
    expect((await host.runtime.newSession()).cancelled).toBe(false);
    expect(host.runtime.session).not.toBe(initial);
    expectCodemodeLoadout(host.runtime.session);
  } finally {
    await host.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
