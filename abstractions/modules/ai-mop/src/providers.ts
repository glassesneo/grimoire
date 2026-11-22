// AI MOP's routes as pi-ai providers, for any agent built on pi-ai: Pi loads them through
// `extension.ts`, and other agents through `ai-mop.providerSources`. Each route reaches the proxy
// with one wire API; the key comes from AI_MOP_API_KEY or the file AI_MOP_API_KEY_FILE names, and
// AI_MOP_OPENAI_BASE_URL and AI_MOP_ANTHROPIC_BASE_URL override the endpoints. The importing
// agent supplies @earendil-works/pi-ai.
import { readFileSync } from "node:fs";
import { createProvider } from "@earendil-works/pi-ai";
import {
  anthropicMessagesApi,
  openAICompletionsApi,
  openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

export function apiKey(): string | undefined {
  return (
    process.env.AI_MOP_API_KEY?.trim() ||
    (process.env.AI_MOP_API_KEY_FILE
      ? readFileSync(process.env.AI_MOP_API_KEY_FILE, "utf8").trim()
      : undefined)
  );
}

// The endpoints, read from the environment when called.
export function baseUrls(): { readonly openai: string; readonly anthropic: string } {
  return {
    openai: process.env.AI_MOP_OPENAI_BASE_URL ?? "https://api.openai.iniad.org/api/v1",
    anthropic: process.env.AI_MOP_ANTHROPIC_BASE_URL ?? "https://api.anthropic.iniad.org/api",
  };
}

export function routes() {
  const { openai, anthropic } = baseUrls();
  return [
    {
      id: "ai-mop-responses",
      label: "Responses",
      source: "openai",
      api: "openai-responses",
      baseUrl: openai,
      implementation: openAIResponsesApi(),
    },
    {
      id: "ai-mop-chat",
      label: "Chat trial",
      source: "openai",
      api: "openai-completions",
      baseUrl: openai,
      implementation: openAICompletionsApi(),
    },
    {
      id: "ai-mop-anthropic",
      label: "Anthropic trial",
      source: "anthropic",
      api: "anthropic-messages",
      baseUrl: anthropic,
      implementation: anthropicMessagesApi(),
    },
  ] as const;
}

export type Route = ReturnType<typeof routes>[number];

// One provider per route, offering the source's catalog models at no cost.
export function providers(from: readonly Route[] = routes()) {
  return from.map((route) =>
    createProvider({
      id: route.id,
      baseUrl: route.baseUrl,
      auth: {
        apiKey: {
          name: "AI MOP API key",
          async resolve() {
            const key = apiKey();
            return key
              ? { auth: { apiKey: key }, source: "AI MOP environment or key file" }
              : undefined;
          },
        },
      },
      // Catalog metadata describes candidates, not availability or proxy compatibility.
      models: getBuiltinModels(route.source).map((model) => ({
        id: model.id,
        name: `${model.name} [${route.label}]`,
        provider: route.id,
        api: route.api,
        baseUrl: route.baseUrl,
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
      api: route.implementation,
    }),
  );
}
