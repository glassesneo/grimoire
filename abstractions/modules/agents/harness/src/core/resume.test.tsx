import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { testRender } from "@opentui/solid";
import { Screen } from "../ui/screen";
import { createFauxSession } from "./faux";
import { openSession, resumeHint } from "./resume";
import { createSessionHost } from "./session";

let root: string;
let previousAgentDir: string | undefined;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "harness-resume-"));
  // Session lookup reads the default session directory under the agent directory.
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
});
afterAll(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true });
});

async function host(sessionManager: SessionManager) {
  const { customization } = createFauxSession({ responses: [fauxAssistantMessage("first reply")] });
  return createSessionHost({
    cwd: root,
    agentDir: join(root, "agent"),
    settingsManager: SettingsManager.inMemory({}),
    sessionManager,
    customization,
  });
}

test("a session that has written its file can be found again by id, prefix, or path, and shows its history", async () => {
  const fresh = SessionManager.create(root);
  expect(resumeHint(fresh)).toBeUndefined();

  const first = await host(fresh);
  await first.runtime.session.prompt("remember this");
  await first.runtime.session.waitForIdle();
  await first.dispose();
  const id = fresh.getSessionId();
  expect(resumeHint(fresh)).toBe(`To resume this session: harness --session ${id}`);

  expect((await openSession(id, root))?.getSessionId()).toBe(id);
  expect((await openSession(id.slice(0, 8), root))?.getSessionId()).toBe(id);
  const opened = await openSession(fresh.getSessionFile()!, root);
  expect(opened?.getSessionId()).toBe(id);
  expect(await openSession("no-such-session", root)).toBeUndefined();

  const resumed = await host(opened!);
  const setup = await testRender(() => <Screen host={resumed} startupNotices={[]} />, { width: 60, height: 30 });
  try {
    // The timeline lays out its items over several frames.
    for (let frame = 0; frame < 3; frame++) {
      await Bun.sleep(20);
      await setup.flush();
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain("remember this");
    expect(setup.captureCharFrame()).toContain("first reply");
  } finally {
    await resumed.dispose();
    setup.renderer.destroy();
  }
});
