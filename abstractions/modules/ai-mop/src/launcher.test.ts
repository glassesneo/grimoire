import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "ai-mop-launch-test-"));
const project = join(root, "project");
const inherited = join(root, "inherited");
const marker = "CONTEXT_MUST_NOT_LEAK";
const digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const requests: Array<Record<string, unknown>> = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  requests.push(JSON.parse(body) as Record<string, unknown>);
  const first = requests.length === 1;
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = first
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "echo-1",
            type: "function",
            function: { name: "echo", arguments: '{"text":"echo-verified"}' },
          },
          {
            index: 1,
            id: "hash-1",
            type: "function",
            function: { name: "sha256", arguments: '{"text":"test"}' },
          },
        ],
      }
    : { role: "assistant", content: "isolation-verified" };
  const chunk = {
    id: "mock",
    object: "chat.completion.chunk",
    model: "gpt-6-astra",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: first ? "tool_calls" : "stop" }] })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
});

try {
  await mkdir(join(project, ".pi"), { recursive: true });
  await mkdir(inherited);
  await writeFile(join(project, "AGENTS.md"), marker);
  const poison = join(root, "poison.ts");
  await writeFile(poison, 'throw new Error("UNEXPECTED_EXTENSION_LOADED");');
  const settings = JSON.stringify({ extensions: [poison], defaultTools: ["bash"] });
  await writeFile(join(project, ".pi", "settings.json"), settings);
  await writeFile(join(inherited, "settings.json"), settings);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const launcher = process.argv[2];
  assert(launcher, "launcher path required");
  const run = async (extra: string[]) => {
    const child = spawn(
      launcher,
      [
        "--provider",
        "ai-mop-chat",
        "--model",
        "gpt-6-astra",
        "--thinking",
        "off",
        "--no-session",
        "--mode",
        "json",
        ...extra,
        "-p",
        "Use the test tools",
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          AI_MOP_API_KEY: "synthetic-key",
          AI_MOP_API_KEY_FILE: "",
          AI_MOP_MODELS_FILE: "",
          AI_MOP_STATE_DIR: join(root, "state"),
          AI_MOP_OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          PI_CODING_AGENT_DIR: inherited,
          PI_CODING_AGENT_SESSION_DIR: join(root, "inherited-sessions"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let errors = "";
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      errors += data.toString();
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      assert.equal(code, 0, errors + output);
    } finally {
      clearTimeout(timeout);
    }
    return output;
  };
  const output = await run([]);
  assert.equal(requests.length, 2, output);
  assert(!JSON.stringify(requests).includes(marker), "project context reached the model");
  const tools = requests[0].tools as Array<{ function: { name: string } }>;
  assert.deepEqual(tools.map((tool) => tool.function.name).sort(), ["echo", "sha256"]);
  const messages = requests[1].messages as Array<{ role: string; content: string }>;
  const results = messages
    .filter((message) => message.role === "tool")
    .map((message) => message.content);
  assert(results.includes("echo-verified"), "echo result did not reach the next request");
  assert(results.includes(digest), "hash result did not reach the next request");
  const disabled = await run(["--no-tools"]);
  assert.equal(requests.length, 3, disabled);
  assert.deepEqual(requests[2].tools ?? [], [], "--no-tools must override the default test tools");
  console.log("AI MOP launch isolation, direct tools and explicit tool disablement verified");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
