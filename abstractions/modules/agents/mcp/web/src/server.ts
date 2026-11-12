import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createSearchRouter, defaultSearchRouterDependencies } from "./search_router.ts";
import { routeWebFetch } from "./web_fetch_router.ts";
import {
  defaultSleep,
  loadWebRetrievalRuntimeConfig,
  raceWithSignal,
} from "./web_retrieval_runtime.ts";
import { isRecord, parseWebFetchInput, parseWebSearchInput } from "./web_retrieval_types.ts";

const protocol = "2025-11-25";

export const tools = [
  {
    name: "web_search",
    description:
      "Search the public web. General search chooses between Parallel and Brave by the configured weights, skips providers without a credential, and does not replace a successful empty result. Discovery search uses Exa.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        objective: { type: "string" },
        intent: { type: "string", enum: ["auto", "general", "discovery"] },
        freshness: { type: "string", enum: ["day", "week", "month", "year"] },
        includeDomains: { type: "array", items: { type: "string" } },
        excludeDomains: { type: "array", items: { type: "string" } },
        maxResults: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch public URLs. Relevant text uses Parallel and a full page uses Exa. Results keep input order, per-URL errors, and the shared character budget. The modes do not fall back to each other.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        objective: { type: "string" },
        mode: { type: "string", enum: ["relevant", "full"] },
        maxCharsTotal: { type: "integer" },
      },
      required: ["urls"],
    },
  },
] as const;

export async function callTool(
  name: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const path = process.env.WEB_RETRIEVAL_CONFIG;
  if (!path) throw new Error("WEB_RETRIEVAL_CONFIG is required");
  const config = await loadWebRetrievalRuntimeConfig(path, signal);
  if (name === "web_search") {
    const router = createSearchRouter(defaultSearchRouterDependencies(readFile));
    return router.search(config, parseWebSearchInput(args), signal);
  }
  if (name === "web_fetch")
    return routeWebFetch(
      parseWebFetchInput(args),
      config,
      {
        fetch: globalThis.fetch.bind(globalThis),
        now: () => Date.now(),
        readTextFile: (file) => readFile(file, "utf8"),
        sleep: defaultSleep,
      },
      signal,
    );
  throw new Error(`Unknown tool ${name}`);
}

function isId(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isInteger(value));
}

export function serve(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  execute: typeof callTool = callTool,
): void {
  const lines = createInterface({ input });
  const running = new Map<string | number, AbortController>();
  const send = (message: unknown) => output.write(`${JSON.stringify(message)}\n`);
  const reply = (id: string | number, result: unknown) => send({ jsonrpc: "2.0", id, result });
  const fail = (id: string | number | null, code: number, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });
  lines.on("close", () => {
    for (const controller of running.values()) controller.abort();
    running.clear();
  });
  lines.on("line", (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, "Parse error");
      return;
    }
    if (
      !isRecord(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      ("id" in message && !isId(message.id))
    ) {
      fail(isRecord(message) && isId(message.id) ? message.id : null, -32600, "Invalid request");
      return;
    }
    const { id, method, params } = message;
    if (id === undefined) {
      if (method === "notifications/cancelled" && isRecord(params) && isId(params.requestId)) {
        running.get(params.requestId)?.abort();
      }
      return;
    }
    // The envelope guard above excludes every other ID shape.
    if (!isId(id)) return;
    if (params !== undefined && !isRecord(params)) {
      fail(id, -32602, "Invalid params");
      return;
    }
    if (running.has(id)) {
      fail(id, -32600, "Request ID already in use");
      return;
    }
    if (method === "initialize") {
      if (
        !isRecord(params) ||
        typeof params.protocolVersion !== "string" ||
        !isRecord(params.capabilities) ||
        !isRecord(params.clientInfo) ||
        typeof params.clientInfo.name !== "string" ||
        typeof params.clientInfo.version !== "string"
      ) {
        fail(id, -32602, "Invalid initialize params");
        return;
      }
      reply(id, {
        protocolVersion: protocol,
        capabilities: { tools: {} },
        serverInfo: { name: "web", version: "1" },
      });
      return;
    }
    if (method === "ping") {
      reply(id, {});
      return;
    }
    if (method === "tools/list") {
      reply(id, { tools });
      return;
    }
    if (method !== "tools/call") {
      fail(id, -32601, "Method not found");
      return;
    }
    if (!isRecord(params) || (params.name !== "web_search" && params.name !== "web_fetch")) {
      fail(id, -32602, "Unknown or missing tool name");
      return;
    }
    const name = params.name;
    const args = params.arguments === undefined ? {} : params.arguments;
    try {
      if (name === "web_search") parseWebSearchInput(args);
      else parseWebFetchInput(args);
    } catch {
      fail(id, -32602, "Invalid tool arguments");
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    const respond = async () => {
      try {
        const result = await raceWithSignal(
          execute(name, args, controller.signal),
          controller.signal,
        );
        if (!controller.signal.aborted)
          reply(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          reply(id, {
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            isError: true,
          });
      } finally {
        running.delete(id);
      }
    };
    void respond();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();
