import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { diagnose, requestEndpoint, requestParameters } from "./diagnostics.ts";
import { apiKey, baseUrls, providers, routes as aiMopRoutes } from "./providers.ts";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  const { openai, anthropic } = baseUrls();
  const routes = aiMopRoutes();
  for (const provider of providers(routes)) pi.registerProvider(provider);

  const updateStatus = (_event: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const route = routes.find((candidate) => candidate.id === ctx.model?.provider);
    ctx.ui.setStatus(
      "ai-mop-route",
      route ? `AI MOP: ${route.label} · ${ctx.thinkingLevel}` : undefined,
    );
  };
  pi.on("session_start", updateStatus);
  pi.on("model_select", updateStatus);
  pi.on("thinking_level_select", updateStatus);

  pi.registerTool({
    name: "echo",
    label: "Echo",
    description:
      "Return the supplied text unchanged. No external effects. Accepts up to 16384 characters.",
    parameters: Type.Object({ text: Type.String({ maxLength: 16384 }) }),
    async execute(_id, { text }) {
      return { content: [{ type: "text", text }], details: {} };
    },
  });
  pi.registerTool({
    name: "sha256",
    label: "SHA-256",
    description:
      "Calculate the hexadecimal SHA-256 digest of UTF-8 text. No file or network access. Accepts up to 16384 characters.",
    parameters: Type.Object({ text: Type.String({ maxLength: 16384 }) }),
    async execute(_id, { text }) {
      return {
        content: [{ type: "text", text: createHash("sha256").update(text, "utf8").digest("hex") }],
        details: {},
      };
    },
  });

  pi.registerCommand("mop-models", {
    description:
      "Fetch AI MOP model IDs, or per-model Anthropic metadata: /mop-models openai|anthropic [model-id]",
    async handler(args, ctx) {
      const [
        source = ctx.model?.provider === "ai-mop-anthropic" ? "anthropic" : "openai",
        modelId,
        ...extra
      ] = args.trim().split(/\s+/).filter(Boolean);
      if (source !== "openai" && source !== "anthropic")
        throw new Error("Choose openai or anthropic");
      if (extra.length || (modelId && source !== "anthropic"))
        throw new Error("Use /mop-models openai or /mop-models anthropic [model-id]");
      const key = apiKey();
      if (!key) throw new Error("Set AI_MOP_API_KEY or AI_MOP_API_KEY_FILE");
      const headers: Record<string, string> =
        source === "openai"
          ? { Authorization: `Bearer ${key}` }
          : { "x-api-key": key, "anthropic-version": "2023-06-01" };
      const path = `/models${modelId ? `/${encodeURIComponent(modelId)}` : ""}`;
      const response = await fetch(`${source === "openai" ? openai : `${anthropic}/v1`}${path}`, {
        headers,
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      });
      if (!response.ok) {
        const hint =
          source === "anthropic" && !modelId
            ? "; the tested proxy does not provide this listing. Try /mop-models anthropic <model-id> for an individual lookup"
            : "";
        throw new Error(`AI MOP ${source} model lookup: HTTP ${response.status}${hint}`);
      }
      const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
      if (modelId) {
        const text = JSON.stringify({ source, modelId, metadata: data }, null, 2);
        if (ctx.hasUI) ctx.ui.notify(text, "info");
        else process.stderr.write(text + "\n");
        return;
      }
      if (!Array.isArray(data.data)) throw new Error("AI MOP model list has no data array");
      const ids = data.data
        .flatMap((model) => (typeof model.id === "string" ? [model.id] : []))
        .sort();
      const text = JSON.stringify({ source, ids }, null, 2);
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else process.stderr.write(text + "\n");
    },
  });

  pi.registerCommand("mop-help", {
    description: "Explain how to reach AI MOP from this workbench",
    async handler(_args, ctx) {
      const text = [
        "The key comes from AI_MOP_API_KEY, or the file AI_MOP_API_KEY_FILE names.",
        "Routes: ai-mop-responses and ai-mop-chat (OpenAI), ai-mop-anthropic (Anthropic). Pick one with --provider or /model.",
        "Use ai-mop-responses for tools with reasoning; the proxy can reject that combination on Chat.",
        "/mop-models openai lists the server's models; /mop-models anthropic <model-id> shows one model.",
        "/mop-status shows the selected route and the last request.",
      ].join("\n");
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else process.stderr.write(text + "\n");
    },
  });

  let lastRequest: Record<string, unknown> | undefined;
  pi.registerCommand("mop-status", {
    description:
      "Show the selected route and the last request's HTTP status, timing and usage without prompt contents",
    async handler(_args, ctx) {
      const text = JSON.stringify(
        {
          selected: {
            provider: ctx.model?.provider,
            model: ctx.model?.id,
            api: ctx.model?.api,
            baseUrl: ctx.model?.baseUrl,
            thinking: ctx.thinkingLevel,
            endpoint: requestEndpoint(ctx.model?.api, ctx.model?.baseUrl),
            tools: pi.getActiveTools(),
          },
          lastRequest,
        },
        null,
        2,
      );
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else process.stderr.write(text + "\n");
    },
  });

  let started = 0;
  let httpStatus: number | undefined;
  let endpoint: string | undefined;
  let parameters: Record<string, unknown> = {};
  pi.on("turn_start", () => {
    started = 0;
    httpStatus = undefined;
    endpoint = undefined;
    parameters = {};
  });
  pi.on("before_provider_request", (event, ctx) => {
    endpoint = requestEndpoint(ctx.model?.api, ctx.model?.baseUrl);
    started = performance.now();
    httpStatus = undefined;
    const payload = event.payload as Record<string, unknown>;
    parameters = requestParameters(payload);
  });
  pi.on("after_provider_response", (event) => {
    httpStatus = event.status;
  });
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = event.message;
    const hasContent = message.content.some(
      (part) =>
        part.type === "toolCall" ||
        (part.type === "text" && part.text.length > 0) ||
        (part.type === "thinking" && part.thinking.length > 0),
    );
    const diagnostic = diagnose(message.provider, message.errorMessage, httpStatus, hasContent);
    if (diagnostic) {
      if (ctx.hasUI) ctx.ui.notify(diagnostic.hint, "warning");
      else process.stderr.write(`AI MOP [${diagnostic.kind}]: ${diagnostic.hint}\n`);
    }
    lastRequest = {
      provider: message.provider,
      model: message.model,
      api: message.api,
      endpoint,
      diagnostic,
      hasContent,
      elapsedMs: started ? Math.round(performance.now() - started) : undefined,
      httpStatus,
      parameters,
      stopReason: message.stopReason,
      usage: message.usage,
    };
    pi.appendEntry("ai-mop-request", lastRequest);
  });
}
