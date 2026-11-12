import assert from "node:assert/strict";
import test from "node:test";
import { buildExaSearchBody } from "./search_adapters.ts";
import { createSearchRouter, selectSearchAdapter } from "./search_router.ts";
import { routeWebFetch } from "./web_fetch_router.ts";
import type {
  WebRetrievalProviderConfig,
  NormalizedSearchRequest,
  SearchAdapter,
  WebRetrievalRuntimeConfig,
} from "./web_retrieval_types.ts";

const endpoints = {
  "parallel-search": "https://parallel.example/search",
  "brave-llm-context": "https://brave.example/context",
  "brave-web-search": "https://brave.example/web",
  "exa-search": "https://exa.example/search",
  "parallel-extract": "https://parallel.example/extract",
  "exa-contents": "https://exa.example/contents",
} as const;

function config(apiKeyFile: string | null = "/key"): WebRetrievalRuntimeConfig {
  return {
    schemaVersion: 2,
    providers: (Object.entries(endpoints) as Array<[keyof typeof endpoints, string]>).map(
      // id and kind are the same name, which the per-provider union cannot correlate.
      ([id, endpoint]) => ({ id, kind: id, endpoint, apiKeyFile }) as WebRetrievalProviderConfig,
    ),
    routing: {
      generalFamilies: { parallel: 5, brave: 1 },
      braveProviders: { "brave-llm-context": 2, "brave-web-search": 1 },
    },
    deadlinesMs: { search: 30_000, fetch: 60_000 },
    retry: { maxRetries: 1, defaultWaitMs: 1_000 },
  };
}

function adapter(id: SearchAdapter["id"], family: SearchAdapter["family"]): SearchAdapter {
  return {
    id,
    family,
    capabilities: { lanes: ["general"], freshness: false, domains: false, objective: false },
    search: async () => {
      throw new Error("unused");
    },
  };
}

const request: NormalizedSearchRequest = { query: "web retrieval", intent: "auto", maxResults: 10 };

void test("general routing keeps Parallel:Brave at 5:1 and Brave providers at 2:1", () => {
  const choices = [
    adapter("parallel-search", "parallel"),
    adapter("brave-llm-context", "brave"),
    adapter("brave-web-search", "brave"),
  ];
  const draws = (values: number[]) => {
    let index = 0;
    return () => values[index++]!;
  };
  const runtime = config();
  assert.equal(
    selectSearchAdapter(choices, "general", runtime, draws([5 / 6 - Number.EPSILON])).id,
    "parallel-search",
  );
  assert.equal(
    selectSearchAdapter(choices, "general", runtime, draws([5 / 6, 2 / 3 - Number.EPSILON])).id,
    "brave-llm-context",
  );
  assert.equal(
    selectSearchAdapter(choices, "general", runtime, draws([5 / 6, 2 / 3])).id,
    "brave-web-search",
  );
});

void test("a successful empty search does not fall back to another provider", async () => {
  const seen: string[] = [];
  const router = createSearchRouter({
    fetch: async (input) => {
      seen.push(String(input));
      return Response.json({ results: [] });
    },
    readTextFile: async () => "synthetic-key",
    sleep: async () => {},
    now: () => 0,
    rng: () => 0,
    requestId: () => "req",
  });
  const result = await router.search(config(), request);
  assert.equal(result.provider, "parallel-search");
  assert.equal(result.results.length, 0);
  assert.equal(result.fallback, false);
  assert.deepEqual(seen, [endpoints["parallel-search"]]);
});

void test("fetch uses Parallel for relevant and Exa for full, without the other mode", async () => {
  const seen: string[] = [];
  const deps = {
    fetch: async (input: string) => {
      seen.push(input);
      return Response.json({ results: [] });
    },
    now: () => 0,
    readTextFile: async () => "synthetic-key",
    sleep: async () => {},
  };
  await routeWebFetch(
    { urls: ["https://example.com"], mode: "relevant", maxCharsTotal: 24_000 },
    config(),
    deps,
  );
  await routeWebFetch(
    { urls: ["https://example.com"], mode: "full", maxCharsTotal: 24_000 },
    config(),
    deps,
  );
  assert.deepEqual(seen, [endpoints["parallel-extract"], endpoints["exa-contents"]]);
});

void test("Exa month and year windows do not overflow past the target month", () => {
  const month = buildExaSearchBody({ ...request, freshness: "month" }, Date.UTC(2026, 2, 31));
  const year = buildExaSearchBody({ ...request, freshness: "year" }, Date.UTC(2024, 1, 29));
  const day = buildExaSearchBody({ ...request, freshness: "day" }, Date.UTC(2026, 2, 31));
  assert.equal(month.startPublishedDate, "2026-02-28T00:00:00.000Z");
  assert.equal(year.startPublishedDate, "2023-02-28T00:00:00.000Z");
  assert.equal(day.startPublishedDate, "2026-03-30T00:00:00.000Z");
});

for (const phase of ["credential", "fetch", "body", "retry"] as const) {
  for (const stop of ["cancel", "deadline"] as const) {
    void test(
      `search settles on ${stop} during started ${phase} work, without fallback`,
      { timeout: 2000 },
      async () => {
        const runtime = config();
        runtime.deadlinesMs.search = stop === "deadline" ? 30 : 1000;
        const controller = new AbortController();
        let started!: () => void;
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        let rejectLate!: (error: Error) => void;
        const stalled = new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        });
        const block = () => {
          started();
          return stalled;
        };
        const seen: string[] = [];
        const router = createSearchRouter({
          readTextFile: async () => (phase === "credential" ? block() : "synthetic-key"),
          fetch: async (url) => {
            seen.push(String(url));
            if (phase === "fetch") return block();
            if (phase === "body") return { ok: true, json: block } as unknown as Response;
            return new Response("", { status: 503, headers: { "Retry-After": "0" } });
          },
          sleep: block,
          now: () => 0,
          rng: () => 0,
          requestId: () => "req",
        });
        const pending = router.search(runtime, request, controller.signal);
        const rejected = assert.rejects(
          pending,
          stop === "cancel" ? /aborted/ : /deadline|timeout/,
        );
        await entered;
        if (stop === "cancel") controller.abort();
        await rejected;
        rejectLate(new Error("late dependency failure"));
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.ok(seen.length <= 1);
      },
    );
  }
}

void test("search retries eligible HTTP failures once before falling back without repeats", async () => {
  const seen: string[] = [];
  const waits: number[] = [];
  const router = createSearchRouter({
    fetch: async (url) => {
      seen.push(String(url));
      return String(url) === endpoints["parallel-search"]
        ? new Response("", { status: 503, headers: { "Retry-After": "0.002" } })
        : Response.json({ grounding: { generic: [] } });
    },
    readTextFile: async () => "synthetic-key",
    sleep: async (ms) => {
      waits.push(ms);
    },
    now: () => 0,
    rng: () => 0,
    requestId: () => "req",
  });
  const result = await router.search(config(), request);
  assert.equal(result.fallback, true);
  assert.equal(result.provider, "brave-llm-context");
  assert.deepEqual(seen, [
    endpoints["parallel-search"],
    endpoints["parallel-search"],
    endpoints["brave-llm-context"],
  ]);
  assert.deepEqual(waits, [2]);
});

void test("search eligibility honors credential, lane and domain restrictions", async () => {
  const seen: string[] = [];
  const runtime = config();
  runtime.providers.find((provider) => provider.id === "parallel-search")!.apiKeyFile = null;
  const router = createSearchRouter({
    fetch: async (url) => {
      seen.push(String(url).split("?")[0]!);
      return Response.json({ results: [], grounding: { generic: [] }, web: { results: [] } });
    },
    readTextFile: async () => "synthetic-key",
    sleep: async () => {},
    now: () => 0,
    rng: () => 0,
    requestId: () => "req",
  });
  await router.search(runtime, request);
  await router.search(runtime, { ...request, includeDomains: ["example.test"] });
  await router.search(runtime, { ...request, intent: "discovery" });
  assert.deepEqual(seen, [
    endpoints["brave-llm-context"],
    endpoints["brave-web-search"],
    endpoints["exa-search"],
  ]);
});

void test("fetch retains input order, duplicates and URL failures under a shared UTF-16 budget", async () => {
  const urls = [
    "https://example.test/a",
    "https://example.test/b",
    "https://example.test/a",
    "https://example.test/missing",
  ];
  const result = await routeWebFetch({ urls, mode: "full", maxCharsTotal: 7 }, config(), {
    fetch: async () =>
      Response.json({
        results: [
          { url: urls[1], text: "abcd" },
          { url: urls[0], text: "😀xy" },
        ],
      }),
    readTextFile: async () => "synthetic-key",
    sleep: async () => {},
    now: () => 0,
  });
  assert.deepEqual(
    result.items.map((item) => item.url),
    urls,
  );
  assert.deepEqual(
    result.items.map((item) => item.content),
    ["😀xy", "abc", undefined, undefined],
  );
  assert.equal(result.items[3]!.error?.category, "not-found");
  assert.equal(result.items[1]!.truncated, true);
  assert.equal(result.items[2]!.truncated, true);
});

void test("fetch failure never switches modes", async () => {
  const seen: string[] = [];
  for (const mode of ["full", "relevant"] as const) {
    await assert.rejects(
      routeWebFetch({ urls: ["https://example.test"], mode, maxCharsTotal: 100 }, config(), {
        fetch: async (url) => {
          seen.push(url);
          return new Response("", { status: 403 });
        },
        readTextFile: async () => "synthetic-key",
        sleep: async () => {},
        now: () => 0,
      }),
    );
  }
  assert.deepEqual(seen, [endpoints["exa-contents"], endpoints["parallel-extract"]]);
});

void test("pre-cancelled search performs no provider request", async () => {
  let calls = 0;
  const router = createSearchRouter({
    fetch: async () => {
      calls++;
      throw new Error("unused");
    },
    readTextFile: async () => {
      throw new Error("late read failure");
    },
    sleep: async () => {},
    now: () => 0,
    rng: () => 0,
    requestId: () => "req",
  });
  await assert.rejects(router.search(config(), request, AbortSignal.abort()), /aborted/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
