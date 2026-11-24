import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isContextOverflow, isRetryableAssistantError, type Usage } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  generateSummaryWithUsage,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  checkpointRecord,
  fallbackType,
  readable,
  restore,
  retiredType,
  saved,
  savedFallback,
  type Saved,
} from "./boundary.ts";
import {
  Output,
  cancelledCalls,
  compactionPayload,
  declarations,
  identity,
  marker,
  splice,
  supported,
  type ReplayItem,
} from "./responses.ts";

const manualThreshold = 1000;

export default function registerCompaction(pi: ExtensionAPI): void {
  let blocked = false;
  let output: Output | undefined;
  let requestMessages: AgentMessage[] = [];
  let requestTools = "";
  let requestIdentity = "";
  let replayTag: string | undefined;

  const settings = (ctx: ExtensionContext) =>
    SettingsManager.inMemory(pi.getSettings()).getCompactionSettings(ctx.model);
  const visible = (ctx: ExtensionContext, text: string) => {
    if (ctx.hasUI) ctx.ui.notify(text, "error");
    else console.error(text);
  };
  const setBlocked = (value: boolean) => {
    if (blocked === value) return;
    blocked = value;
    pi.appendEntry(fallbackType, { blocked: value });
  };
  const fallback = (ctx: ExtensionContext, reason: string) => {
    if (!blocked)
      visible(
        ctx,
        `${reason} Using Pi standard compaction with readable history until the next human input.`,
      );
    setBlocked(true);
    output = undefined;
  };
  const retire = (ctx: ExtensionContext, checkpoint: Saved, reason: string): Saved => {
    if (checkpoint?.replayable) pi.appendEntry(retiredType, {});
    fallback(ctx, reason);
    return checkpoint && { ...checkpoint, replayable: false };
  };
  const checkModel = (ctx: ExtensionContext, checkpoint: Saved = saved(ctx)): Saved =>
    checkpoint?.replayable && (!ctx.model || checkpoint.checkpoint.identity !== identity(ctx.model))
      ? retire(
          ctx,
          checkpoint,
          "Checkpoint model/provider/endpoint changed; restored the original context.",
        )
      : checkpoint;
  const checkEndpoint = async (ctx: ExtensionContext) => {
    if (!supported(ctx.model)) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || (auth.baseUrl && !supported({ ...ctx.model, baseUrl: auth.baseUrl }))) {
      fallback(
        ctx,
        "Resolved authentication endpoint is unavailable or not public Responses; retained readable history.",
      );
    }
  };
  const record = (ctx: ExtensionContext, replay: ReplayItem[], messages: AgentMessage[]) =>
    checkpointRecord({ identity: identity(ctx.model!), tools: requestTools, replay }, messages);

  // Preflights the actual native prompt before transport; UTF-8 JSON bytes conservatively budget
  // text plus message framing, while retaining the configured output reserve.
  const standardSummary = async (
    ctx: ExtensionContext,
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => {
    if (!ctx.model) throw new Error("No model for standard compaction");
    const model = ctx.model;
    const budget =
      model.contextWindow -
      Math.max(settings(ctx).reserveTokens, Math.min(model.maxTokens, model.contextWindow / 2));
    const transcript = readable(messages);
    let offset = 0;
    let summary: string | undefined;
    let usage: Usage | undefined;
    const tooLarge = new Error("Standard summary prompt exceeds the input budget");
    while (offset < transcript.length) {
      signal?.throwIfAborted();
      let size = Math.min(transcript.length - offset, budget);
      for (;;) {
        let end = offset + size;
        if (end < transcript.length && /[\uD800-\uDBFF]/.test(transcript[end - 1]!)) end--;
        if (end <= offset)
          throw new Error("Pi standard summary leaves no input budget for remaining history");
        try {
          const result = await generateSummaryWithUsage(
            [{ role: "user", content: transcript.slice(offset, end), timestamp: Date.now() }],
            model,
            undefined,
            undefined,
            undefined,
            signal,
            undefined,
            summary,
            ctx.thinkingLevel,
            (target, context, options) => {
              if (Buffer.byteLength(JSON.stringify(context.messages), "utf8") > budget)
                throw tooLarge;
              return ctx.modelRegistry.streamSimple(target, context, options);
            },
          );
          signal?.throwIfAborted();
          if (!result.text.trim()) throw new Error("Pi standard summary was empty");
          summary = result.text;
          if (!usage) usage = structuredClone(result.usage);
          else {
            for (const key of [
              "input",
              "output",
              "cacheRead",
              "cacheWrite",
              "totalTokens",
              "cacheWrite1h",
              "reasoning",
            ] as const) {
              if (result.usage[key] !== undefined)
                usage[key] = (usage[key] ?? 0) + result.usage[key]!;
            }
            for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const)
              usage.cost[key] += result.usage.cost[key];
            usage.cost.totalFromProvider =
              usage.cost.totalFromProvider === true && result.usage.cost.totalFromProvider === true;
          }
          offset = end;
          break;
        } catch (error) {
          if (error !== tooLarge) throw error;
          size = Math.floor(size / 2);
        }
      }
    }
    return { text: summary!, usage };
  };

  pi.on("session_start", (_event, ctx) => {
    requestTools = "";
    blocked = savedFallback(ctx);
    checkModel(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    output = undefined;
    blocked = savedFallback(ctx);
    checkModel(ctx);
  });
  pi.on("model_select", (_event, ctx) => {
    checkModel(ctx);
  });
  // input runs when received, not when queued work is delivered, so a human message received during
  // this work must not re-enable server compaction mid-recovery.
  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && ctx.isIdle() && !event.streamingBehavior) setBlocked(false);
    checkModel(ctx);
  });
  pi.on("context", async (event, ctx) => {
    const checkpoint = checkModel(ctx);
    await checkEndpoint(ctx);
    requestMessages = restore(event.messages, checkpoint);
    replayTag = undefined;
    if (blocked || !supported(ctx.model) || (checkpoint && !checkpoint.replayable))
      return { messages: requestMessages };
    if (checkpoint) {
      replayTag = marker(checkpoint.entry.id);
      return {
        messages: event.messages.map((message) =>
          message.role === "compactionSummary" && message.summary === checkpoint.entry.summary
            ? { role: "user" as const, content: replayTag!, timestamp: message.timestamp }
            : message,
        ),
      };
    }
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (blocked || !supported(ctx.model)) return;
    const payload = event.payload as { input?: unknown[]; [key: string]: unknown };
    if (!Array.isArray(payload?.input)) {
      fallback(
        ctx,
        "Responses payload is unavailable; stopping this request with history retained.",
      );
      ctx.abort();
      return { ...payload, input: null };
    }
    let input = payload.input;
    const declared = declarations({ ...payload, input });
    if (replayTag) {
      const checkpoint = saved(ctx);
      if (checkpoint && checkpoint.checkpoint.tools !== declared) {
        retire(
          ctx,
          checkpoint,
          "Tool declarations changed; stopping this request with readable history kept.",
        );
        ctx.abort();
        return { ...payload, input: null };
      }
      const replaced = checkpoint && splice(input, replayTag, checkpoint.checkpoint.replay);
      if (!replaced) {
        fallback(ctx, "Checkpoint projection failed; stopping this request.");
        ctx.abort();
        return { ...payload, input: null };
      }
      input = replaced;
    }
    output = new Output();
    requestTools = declared;
    requestIdentity = identity(ctx.model);
    return compactionPayload(payload, input, ctx.model.contextWindow - settings(ctx).reserveTokens);
  });
  pi.on("provider_stream_event", (event, ctx) => {
    if (!output) return;
    if (
      ctx.model &&
      identity(ctx.model) === requestIdentity &&
      event.provider === ctx.model.provider &&
      event.model === ctx.model.id &&
      event.api === ctx.model.api
    )
      output.observe(event.data);
  });
  pi.on("turn_end", (event, ctx) => {
    const suffix = output?.suffix();
    const observed = output !== undefined;
    output = undefined;
    if (event.outcome === "aborted") return;
    if (observed && event.outcome === "completed" && suffix) {
      const messages = [...requestMessages, event.message];
      return {
        entries: [
          ...event.entries,
          {
            type: "compaction" as const,
            ...record(ctx, suffix, messages),
            firstKeptEntryId: event.toolResultEntryIds[0] ?? null,
          },
        ],
      };
    }
    if (!observed || event.outcome === "completed") return;
    // Pi retries after this hook. A transient error says nothing about whether the saved checkpoint
    // still works, so it is kept even if Pi exhausts its retry budget.
    if (
      event.message.role === "assistant" &&
      !isContextOverflow(event.message, ctx.model?.contextWindow) &&
      isRetryableAssistantError(event.message)
    )
      return;
    // Restored history that no longer fits reaches Pi's own threshold or overflow compaction, which
    // summarizes it in session_before_compact.
    fallback(ctx, "Responses request failed; no checkpoint was adopted.");
  });
  pi.on("session_before_compact", async (event, ctx) => {
    if (event.signal.aborted) return { cancel: true };
    if (event.reason === "manual" && event.customInstructions?.trim()) {
      visible(ctx, "/compact does not support additional instructions; nothing was compacted.");
      return { cancel: true };
    }
    const checkpoint = checkModel(ctx);
    await checkEndpoint(ctx);
    const preparation = event.preparation;
    const prefix: AgentMessage[] = [
      ...(preparation.previousSummary
        ? [
            {
              role: "compactionSummary" as const,
              summary: preparation.previousSummary,
              tokensBefore: preparation.tokensBefore,
              timestamp: Date.now(),
            },
          ]
        : []),
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ];
    const messages = restore(prefix, checkpoint);
    const nativeFallback = async () => {
      try {
        const result = await standardSummary(ctx, messages, event.signal);
        event.signal.throwIfAborted();
        return {
          compaction: {
            summary: result.text,
            firstKeptEntryId: preparation.firstKeptEntryId,
            tokensBefore: preparation.tokensBefore,
            usage: result.usage,
          },
        };
      } catch {
        if (!event.signal.aborted)
          visible(
            ctx,
            "Pi standard compaction failed; history retained and no recovery was scheduled.",
          );
        return { cancel: true };
      }
    };
    if (!supported(ctx.model) || blocked) return checkpoint ? nativeFallback() : undefined;
    if (event.reason === "threshold") return { cancel: true };
    if (event.reason === "overflow") {
      fallback(ctx, "Responses compaction did not absorb the overflow.");
      return nativeFallback();
    }
    // The manual request declares no tools, so the checkpoint keeps the work requests'
    // declarations; the next work request verifies them before any replay.
    const live = checkpoint?.replayable ? checkpoint : undefined;
    if (live && requestTools && live.checkpoint.tools !== requestTools) {
      retire(ctx, live, "Tool declarations changed; restored the original context.");
      return nativeFallback();
    }
    requestTools ||= live?.checkpoint.tools ?? "";
    if (!requestTools) {
      visible(ctx, "No work request has declared tools yet; using Pi standard compaction.");
      return nativeFallback();
    }
    const collected = new Output();
    try {
      const tag = live ? marker(live.entry.id) : undefined;
      const manualPrefix = tag
        ? [{ role: "user" as const, content: tag, timestamp: Date.now() }, ...prefix.slice(1)]
        : messages;
      const response = await ctx.modelRegistry
        .streamSimple(
          ctx.model,
          {
            messages: [
              { role: "system", content: ctx.getSystemPrompt(), timestamp: Date.now() },
              ...convertToLlm(manualPrefix),
            ],
          },
          {
            signal: event.signal,
            maxRetries: 0,
            onPayload: (value) => {
              const payload = value as { input: unknown[]; [key: string]: unknown };
              let input = payload.input;
              if (live) {
                const replaced = splice(input, tag!, live.checkpoint.replay);
                if (!replaced) throw new Error("Manual checkpoint prefix missing");
                input = replaced;
              }
              return compactionPayload(payload, input, manualThreshold);
            },
            onProviderStreamEvent: (data) => collected.observe(data),
          },
        )
        .result();
      event.signal.throwIfAborted();
      const suffix = collected.suffix();
      if (!suffix || response.stopReason === "error" || response.stopReason === "aborted")
        throw new Error("No completed checkpoint");
      const replay = [...suffix, ...cancelledCalls(collected.items)];
      const recovery = [
        ...messages,
        {
          role: "user" as const,
          content: `Separate manual compaction output (not executed as work):\n${JSON.stringify({ content: response.content, replay })}`,
          timestamp: Date.now(),
        },
      ];
      return {
        compaction: {
          ...record(ctx, replay, recovery),
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          usage: response.usage,
        },
      };
    } catch {
      if (event.signal.aborted) return { cancel: true };
      fallback(ctx, "Manual Responses compaction failed; no checkpoint was adopted.");
      return nativeFallback();
    }
  });
  pi.on("session_compact_failed", (event, ctx) => {
    if (event.errorMessage) {
      fallback(ctx, "Pi standard compaction failed; history was not replaced.");
      visible(ctx, event.errorMessage);
    }
  });
}
