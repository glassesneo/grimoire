import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import register from "./index.ts";

// Contract tests at the consumer boundary: real Pi sessions and serialization, with
// only HTTP replaced. Helper truth tables were removed: they missed lost history,
// duplicated tool calls and broken recovery despite all their assertions passing.
// No schema/type/build check observes these repository-owned cross-hook behaviors.
// Each scenario below owns one materially distinct outcome; no SDK behavior is retested.
export default async function contracts(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "pi-compaction-contract-"));
  const originalFetch = globalThis.fetch;
  const requests: { payload: any; headers: Headers }[] = [];
  const notices: string[] = [];
  const errors: unknown[] = [];
  let script: ((payload: any, init: RequestInit) => Response | Promise<Response>)[] = [];
  let summaryResponder: ((payload: any, init: RequestInit) => Response) | undefined;
  let session: AgentSession | undefined;
  let toolRuns = 0;
  let authGeneration = 1;
  let continuation: (() => void) | undefined;
  let queueDuringTool: (() => Promise<void>) | undefined;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      url instanceof Request ? url.url : String(url),
      "https://api.openai.com/v1/responses",
      "no live transport permitted",
    );
    const payload = JSON.parse(init!.body as string);
    requests.push({ payload, headers: new Headers(init!.headers) });
    const step = script.shift() ?? summaryResponder;
    assert.ok(step, "unexpected provider request");
    return step(payload, init!);
  };
  const text = (value: string) => ({
    type: "message",
    id: `msg_${value}`,
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: value, annotations: [] }],
  });
  const checkpoint = (id: string) => ({ type: "compaction", id, encrypted_content: `dummy-${id}` });
  const call = (id: string) => ({
    type: "function_call",
    id: `fc_${id}`,
    call_id: `call_${id}`,
    name: "echo",
    arguments: '{"value":"TOOL_VALUE"}',
    status: "completed",
  });
  const response =
    (items: any[], terminal = "completed", errorMessage = "synthetic failure") =>
    (_payload: any, _init: RequestInit) => {
      const id = `resp_${requests.length}`;
      const events: any[] = [{ type: "response.created", response: { id, status: "in_progress" } }];
      for (const [output_index, item] of items.entries()) {
        events.push({
          type: "response.output_item.added",
          output_index,
          item: item.type === "function_call" ? { ...item, arguments: "" } : item,
        });
        if (item.type === "message")
          events.push({
            type: "response.output_text.delta",
            output_index,
            delta: item.content[0].text,
          });
        if (item.type === "function_call")
          events.push({
            type: "response.function_call_arguments.delta",
            output_index,
            delta: item.arguments,
          });
        events.push({ type: "response.output_item.done", output_index, item });
      }
      // Empty terminal output is intentional: the completed streamed items own replay.
      events.push({
        type: `response.${terminal}`,
        response: {
          id,
          status: terminal,
          output: [],
          error:
            terminal === "failed" ? { code: "synthetic_error", message: errorMessage } : undefined,
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        },
      });
      return new Response(
        events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
  // Real transports cross clock ticks; keep SDK attempt timestamps ordered in this zero-I/O fixture.
  const prompt = async (s: AgentSession, value: string) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await s.prompt(value);
  };
  const last = () => requests.at(-1)!.payload;
  const sent = () => JSON.stringify(last().input);
  const expectReplay = (items: any[]) =>
    assert.deepEqual(
      last().input.filter((item: any) => items.some((expected) => expected.id === item.id)),
      items,
    );
  const runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models.json"),
    refreshOnCreate: false,
  });
  const originalProvider = runtime.getProvider("openai")!;
  // Auth is resolved by the actual runtime, including a rotating synthetic header.
  runtime.registerNativeProvider({
    ...originalProvider,
    auth: {
      apiKey: {
        name: "Offline test",
        login: async () => ({ type: "api_key", key: "dummy" }),
        resolve: async () => ({
          auth: {
            apiKey: `dummy-${authGeneration}`,
            headers: { "x-contract-auth": `generation-${authGeneration}` },
          },
          source: "synthetic",
        }),
      },
    },
  });
  const catalogModel = runtime.getModel("openai", "gpt-6.1-sol")!;
  assert.ok(catalogModel);
  const model = { ...catalogModel, contextWindow: 32768, maxTokens: 4096 };
  const reserveTokens = 12345;
  async function open(
    manager = SessionManager.create(root, join(root, "sessions")),
    extra?: (pi: ExtensionAPI) => void,
  ) {
    session?.dispose();
    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: false },
      compaction: {
        enabled: true,
        keepRecentTokens: 1,
        reserveTokens: 16384,
        modelOverrides: { [`openai/${model.id}`]: { reserveTokens } },
      },
    });
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "Offline contract fixture.",
      extensionFactories: [
        register,
        (pi) => {
          pi.on("agent_before_settle", (event) => {
            if (continuation) {
              const action = continuation;
              continuation = undefined;
              action();
              return {
                entries: [
                  ...event.entries,
                  {
                    type: "custom_message" as const,
                    customType: "fixture",
                    content: "Continue extension work",
                    display: false,
                  },
                ],
                continue: true,
              };
            }
          });
          extra?.(pi);
        },
      ],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const created = await createAgentSession({
      cwd: root,
      agentDir: root,
      modelRuntime: runtime,
      model,
      settingsManager,
      resourceLoader: loader,
      sessionManager: manager,
      tools: extra ? ["echo", "grammar_echo"] : ["echo"],
      customTools: [
        {
          name: "echo",
          label: "echo",
          description: "Synthetic echo",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
          execute: async () => {
            toolRuns++;
            await queueDuringTool?.();
            queueDuringTool = undefined;
            return { content: [{ type: "text", text: "TOOL_RESULT" }], details: {} };
          },
        },
      ],
    });
    session = created.session;
    await session.bindExtensions({
      mode: "rpc",
      uiContext: { notify: (message: string) => notices.push(message) } as any,
      onError: (error) => errors.push(error),
    });
    return session;
  }
  try {
    // Given successful work responses, API consumers see the latest raw checkpoint
    // and exact suffix once, followed by results; restart/auth refresh cannot erase it.
    // Material: missing or duplicated calls corrupt tool conversations and memory.
    let s = await open();
    script = [response([text("BASE_FACT")])];
    await s.prompt("ORIGINAL_FACT");
    assert.equal(last().context_management[0].compact_threshold, model.contextWindow - 12345);
    const raw = [checkpoint("cp_work"), text("SUFFIX"), call("work")];
    script = [response(raw), response([text("AFTER_TOOL")])];
    await s.prompt("Use a tool");
    expectReplay(raw);
    assert.equal(
      last().input.filter(
        (item: any) => item.call_id === "call_work" && item.type === "function_call",
      ).length,
      1,
    );
    assert.equal(
      last().input.filter(
        (item: any) => item.call_id === "call_work" && item.type === "function_call_output",
      ).length,
      1,
    );
    assert.ok(!sent().includes("ORIGINAL_FACT"));
    const file = s.sessionManager.getSessionFile()!;
    authGeneration++;
    s = await open(SessionManager.open(file));
    script = [response([text("REOPENED")])];
    await s.prompt("Resume");
    expectReplay(raw);
    assert.equal(requests.at(-1)!.headers.get("x-contract-auth"), "generation-2");
    script = [
      response([
        call("before"),
        checkpoint("cp_old"),
        text("OLD_SUFFIX"),
        checkpoint("cp_latest"),
        text("LATEST_SUFFIX"),
      ]),
      response([text("DONE")]),
    ];
    await s.prompt("Continue tools");
    expectReplay([checkpoint("cp_latest"), text("LATEST_SUFFIX")]);
    assert.ok(!sent().includes("OLD_SUFFIX"));
    assert.equal(last().input.filter((item: any) => item.type === "compaction").length, 1);
    assert.equal(
      last().input.filter((item: any) => item.call_id === "call_before").length,
      1,
      "only the post-checkpoint result remains",
    );
    console.log("PASS work replay, tool/results, persistence and auth refresh");

    // Given manual compaction of a split span after a checkpoint, the replacement
    // includes prior memory and the prefix; its extra generation is never executed
    // as work and survives restart with explicit cancelled tool results.
    script = [response([call("split")]), response([text("SPLIT_TAIL")])];
    // The manual prefix is large enough to compact, but below the automatic threshold.
    await s.prompt(`SPLIT_PREFIX ${"filler ".repeat(1500)}`);
    const manualAt = requests.length;
    const runsBefore = toolRuns;
    const manualRaw = [checkpoint("cp_manual"), text("MANUAL_EXTRA"), call("manual")];
    // Like the public API, the server compacts only an input above compact_threshold.
    const compacting = response([call("manual_before"), ...manualRaw]);
    script = [
      (payload, init) => {
        const estimated = Buffer.byteLength(JSON.stringify(payload.input), "utf8") / 4;
        assert.ok(
          payload.context_management[0].compact_threshold < estimated,
          "manual compaction requests a threshold its input exceeds",
        );
        return compacting(payload, init);
      },
    ];
    await s.compact();
    const manualInput = JSON.stringify(requests[manualAt].payload.input);
    assert.ok(manualInput.includes("cp_latest"), manualInput);
    assert.ok(manualInput.includes("SPLIT_PREFIX"), "split prefix user input is retained");
    assert.equal(requests[manualAt].headers.get("x-contract-auth"), "generation-2");
    assert.equal(requests[manualAt].payload.max_output_tokens, undefined);
    assert.equal(toolRuns, runsBefore);
    s = await open(SessionManager.open(file));
    script = [response([text("POST_MANUAL")])];
    await s.prompt("After manual");
    expectReplay(manualRaw);
    assert.equal(
      last().input.filter(
        (item: any) => item.type === "function_call_output" && item.call_id === "call_manual",
      ).length,
      1,
    );
    assert.equal(
      last().input.filter(
        (item: any) =>
          item.type === "function_call_output" && item.call_id === "call_manual_before",
      ).length,
      1,
    );
    assert.match(sent(), /Not executed/);
    assert.equal(toolRuns, runsBefore);
    const count = requests.length;
    await assert.rejects(s.compact("unsupported instructions"));
    assert.equal(requests.length, count);
    console.log("PASS manual prefix, raw extra output, cancellation and auth");

    // Given failure, standard summarization receives readable prior memory. The
    // current work (including already-queued human and extension continuations)
    // stays standard; only a new idle human input restores automatic mode.
    // Material: fallback must not silently summarize a placeholder or failed checkpoint.
    s = await open();
    script = [response([checkpoint("cp_recovery"), text("RECOVERY_SUFFIX")])];
    await s.prompt("RECOVER_THIS_FACT");
    script = [response([text("SECOND_FACT")])];
    await s.prompt("SECOND_USER");
    script = [response([text("THIRD_FACT")])];
    await s.prompt("THIRD_USER");
    const fallbackAt = requests.length;
    script = [
      response([checkpoint("cp_rejected")], "failed"),
      response([text("STANDARD_HISTORY")]),
    ];
    await s.compact();
    assert.equal(script.length, 0);
    const summaries = requests
      .slice(fallbackAt + 1)
      .map((request) => JSON.stringify(request.payload));
    assert.ok(
      summaries.some((value) => value.includes("RECOVER_THIS_FACT")),
      summaries.join("\n"),
    );
    assert.ok(summaries.every((value) => !value.includes("cp_rejected")));
    assert.ok(
      requests.slice(fallbackAt + 1).every((request) => !request.payload.context_management),
    );
    assert.ok(notices.some((message) => /standard compaction/i.test(message)));
    continuation = () => {};
    script = [
      response([call("standard")]),
      response([text("STANDARD_TOOL_DONE")]),
      response([text("EXTENSION_DONE")]),
      response([text("QUEUED_DONE")]),
    ];
    queueDuringTool = async () => {
      await s.followUp("ALREADY_QUEUED_HUMAN");
    };
    const workAt = requests.length;
    // A custom message starts extension-authored work without masquerading as human input.
    await s.sendCustomMessage(
      { customType: "fixture", content: "Extension continuation", display: false },
      { triggerTurn: true },
    );
    await s.waitForIdle();
    assert.ok(requests.slice(workAt).every((request) => !request.payload.context_management));
    script = [response([text("HUMAN_DONE")])];
    await s.prompt("NEW_HUMAN");
    assert.ok(last().context_management);
    assert.ok(
      !last().input.some((item: any) => item.type === "compaction"),
      "a native summary must not revive an older checkpoint",
    );
    console.log("PASS readable native fallback and human-input restoration");

    // Given incompatible model/provider/tool boundaries or cancelled/failed streams,
    // no opaque checkpoint is sent to another model and no partial one is adopted.
    // An incompatible checkpoint stays retired: the next human input resumes
    // automatic compaction over the readable history instead of detecting it again.
    // Material: these are distinct safety outcomes, not internal phase assertions.
    s = await open();
    script = [response([checkpoint("cp_boundary"), text("BOUNDARY_SUFFIX")])];
    await s.prompt("BOUNDARY_FACT");
    const other = { ...model, id: "synthetic-other-model" };
    script = [response([text("OTHER_MODEL")])];
    await s.setModel(other);
    await s.prompt("Switch model");
    assert.ok(sent().includes("BOUNDARY_FACT"));
    assert.ok(!last().input.some((item: any) => item.type === "compaction"));
    assert.ok(last().context_management, "the next human input resumes automatic compaction");
    script = [response([text("STILL_OTHER")])];
    await s.prompt("Again on the other model");
    assert.ok(sent().includes("BOUNDARY_FACT"));
    assert.ok(last().context_management, "the retired checkpoint is not detected again");
    s = await open();
    script = [response([checkpoint("cp_good"), text("GOOD")])];
    await s.prompt("CANCELLATION_FACT");
    runtime.registerNativeProvider({
      ...originalProvider,
      id: "synthetic",
      auth: runtime.getProvider("openai")!.auth,
      getModels: () => [{ ...model, provider: "synthetic" }],
      getAllModels: () => [{ ...model, provider: "synthetic" }],
    });
    await s.setModel({ ...model, provider: "synthetic" });
    script = [response([text("OTHER_PROVIDER")])];
    await s.prompt("Same model ID, different provider");
    assert.ok(sent().includes("CANCELLATION_FACT"));
    assert.ok(!last().input.some((item: any) => item.type === "compaction"));
    assert.equal(last().context_management, undefined);
    // A declaration change that Pi's tool metadata does not show (grammar to function)
    // happens between the checkpoint and its tool result within one turn.
    let grammarPi: ExtensionAPI;
    const grammarTool = (grammar: boolean): any => ({
      name: "grammar_echo",
      label: "grammar_echo",
      description: "Stable description",
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
      constrainedSampling: grammar ? { type: "grammar", variants: { openai_regex: ".*" } } : false,
      execute: async () => {
        grammarPi.registerTool(grammarTool(false));
        grammarPi.setActiveTools(["grammar_echo"]);
        return { content: [{ type: "text", text: "GRAMMAR_RESULT" }], details: {} };
      },
    });
    s = await open(undefined, (pi) => {
      grammarPi = pi;
      pi.registerTool(grammarTool(true));
    });
    s.setActiveToolsByName(["grammar_echo"]);
    const toolsAt = requests.length;
    script = [
      response([
        checkpoint("cp_tools"),
        {
          type: "custom_tool_call",
          id: "ctc_grammar",
          call_id: "call_grammar",
          name: "grammar_echo",
          input: "TOOL_BOUNDARY_FACT",
          status: "completed",
        },
      ]),
      response([text("MISMATCHED")]),
    ];
    await s.prompt("TOOL_BOUNDARY_FACT");
    assert.ok(JSON.stringify(requests[toolsAt].payload.input).includes('"type":"custom"'));
    assert.ok(
      requests
        .slice(toolsAt + 1)
        .every(
          (request) =>
            !Array.isArray(request.payload.input) ||
            !request.payload.input.some((item: any) => item.type === "compaction"),
        ),
      "a checkpoint is never replayed under different tool declarations",
    );
    assert.ok(notices.some((message) => /Tool declarations changed/.test(message)));
    script = [response([text("AFTER_TOOLS")])];
    await s.prompt("Next human input");
    assert.ok(sent().includes("TOOL_BOUNDARY_FACT"));
    assert.ok(sent().includes("GRAMMAR_RESULT"));
    assert.ok(!last().input.some((item: any) => item.type === "compaction"));
    assert.ok(last().context_management, "the next human input resumes automatic compaction");
    s = await open();
    script = [response([checkpoint("cp_cancel"), text("CANCEL_SUFFIX")])];
    await s.prompt("CANCELLATION_FACT");
    const beforeAbort = s.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "compaction").length;
    script = [
      (_payload, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: checkpoint("cp_aborted") })}\n\n`,
                ),
              );
              init.signal!.addEventListener(
                "abort",
                () => controller.error(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
              setTimeout(() => void s.abort(), 5);
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    ];
    await s.prompt("Cancel");
    assert.equal(
      s.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length,
      beforeAbort,
    );
    assert.ok(!JSON.stringify(s.sessionManager.getBranch()).includes("cp_aborted"));
    console.log("PASS model/provider boundary and cancellation safety");
    assert.equal(script.length, 0);

    // Recovery failure is not success, and overflow uses Pi's standard recovery
    // lifecycle rather than cancelling it or silently discarding earlier memory.
    s = await open();
    script = [response([checkpoint("cp_overflow_base"), text("OVERFLOW_BASE")])];
    await s.prompt("OVERFLOW_MEMORY");
    script = [response([text("OVERFLOW_PREFIX")])];
    await s.prompt("OLD_USER");
    const overflowAt = requests.length;
    script = [
      response([checkpoint("cp_overflow_rejected")], "failed", "maximum context length exceeded"),
      response([text("NATIVE_HISTORY")]),
      response([text("RECOVERED_WORK")]),
    ];
    await prompt(s, "Recover overflow");
    assert.ok(
      requests
        .slice(overflowAt + 1)
        .some((request) => JSON.stringify(request.payload).includes("OVERFLOW_MEMORY")),
    );
    assert.ok(
      requests.slice(overflowAt + 1).every((request) => !request.payload.context_management),
    );
    assert.ok(!JSON.stringify(s.sessionManager.getBranch()).includes("cp_overflow_rejected"));
    assert.equal(s.getLastAssistantText(), "RECOVERED_WORK");
    assert.equal(script.length, 0);
    s = await open();
    script = [response([text("FAILURE_BASE")])];
    await s.prompt("KEEP_ON_FAILURE");
    const compactionsBefore = s.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "compaction").length;
    script = [response([checkpoint("cp_failed_manual")], "failed"), response([], "failed")];
    await assert.rejects(s.compact());
    assert.equal(
      s.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length,
      compactionsBefore,
    );
    assert.ok(notices.some((message) => /compaction failed/i.test(message)));
    assert.equal(script.length, 0);
    // An ordinary failed work request adopts no checkpoint and does not replace
    // history; the current work stays standard until the next human input.
    script = [response([checkpoint("cp_failed_work")], "failed")];
    await s.prompt("NEW_HUMAN_AFTER_FAILURE");
    assert.equal(
      s.sessionManager.getBranch().filter((entry) => entry.type === "compaction").length,
      compactionsBefore,
      "a failed request does not summarize history",
    );
    assert.ok(!JSON.stringify(s.sessionManager.getBranch()).includes("cp_failed_work"));
    script = [response([text("CONTINUED_AFTER_ERROR")])];
    await s.sendCustomMessage(
      { customType: "fixture", content: "Continue after error", display: false },
      { triggerTurn: true },
    );
    await s.waitForIdle();
    assert.ok(sent().includes("KEEP_ON_FAILURE"));
    assert.equal(last().context_management, undefined);
    // Reloading the session is not human input: the fallback survives it.
    s = await open(SessionManager.open(s.sessionManager.getSessionFile()!));
    script = [response([text("CONTINUED_AFTER_RELOAD")])];
    await s.sendCustomMessage(
      { customType: "fixture", content: "Continue after reload", display: false },
      { triggerTurn: true },
    );
    await s.waitForIdle();
    assert.ok(sent().includes("KEEP_ON_FAILURE"));
    assert.equal(last().context_management, undefined, "a reload does not end the fallback");
    script = [response([text("HUMAN_AFTER_ERROR")])];
    await s.prompt("NEXT_HUMAN_AFTER_ERROR");
    assert.ok(last().context_management);
    assert.equal(script.length, 0, "all scripted requests consumed");
    console.log("PASS native overflow recovery and visible summary failure");

    // Given history spanning multiple provider checkpoints, standard fallback must
    // consume all readable history through bounded requests, carrying each generated
    // native summary forward. A warning followed by an oversized request is not recovery.
    s = await open();
    const facts = ["FACT_ALPHA", "FACT_BETA", "FACT_GAMMA"];
    for (const fact of facts) {
      script = [response([checkpoint(`cp_${fact}`), text(`SUFFIX_${fact}`)])];
      await s.prompt(`${fact}: ${"x".repeat(60000)}`);
    }
    script = [response([text("LAST_KEPT_RESPONSE")])];
    await s.prompt("LAST_USER");
    const boundedAt = requests.length;
    let summariesMade = 0;
    summaryResponder = (payload, init) => {
      assert.equal(payload.context_management, undefined);
      assert.ok(
        Buffer.byteLength(JSON.stringify(payload.input), "utf8") <=
          model.contextWindow - reserveTokens,
        "standard summary request must fit its input budget",
      );
      summariesMade++;
      if (summariesMade > 1)
        assert.ok(JSON.stringify(payload.input).includes(`CARRIED_${summariesMade - 1}`));
      return response([text(`CARRIED_${summariesMade}`)])(payload, init);
    };
    script = [response([checkpoint("cp_bounded_rejected")], "failed")];
    const recovered = await s.compact();
    summaryResponder = undefined;
    assert.ok(summariesMade > 1);
    const summaryInputs = requests
      .slice(boundedAt + 1)
      .map((request) => JSON.stringify(request.payload.input))
      .join("\n");
    for (const fact of facts)
      assert.ok(summaryInputs.includes(fact), `native summaries received ${fact}`);
    assert.ok(recovered.summary.includes(`CARRIED_${summariesMade}`));
    script = [response([text("BOUNDED_RECOVERY_DONE")])];
    await s.sendCustomMessage(
      { customType: "fixture", content: "Continue recovered work", display: false },
      { triggerTurn: true },
    );
    await s.waitForIdle();
    assert.ok(sent().includes(`CARRIED_${summariesMade}`));
    assert.equal(last().context_management, undefined);
    assert.equal(script.length, 0);
    console.log("PASS cumulative-history bounded native fallback");
    assert.deepEqual(errors, []);
    if (process.env.PI_COMPACTION_TEST_OK)
      writeFileSync(process.env.PI_COMPACTION_TEST_OK, "passed\n");
  } finally {
    session?.dispose();
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}
