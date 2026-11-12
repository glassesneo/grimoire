import { readFile } from "node:fs/promises";
import {
  validateWebRetrievalRuntimeConfig,
  WebRetrievalReadinessError,
  type WebRetrievalRuntimeConfig,
} from "./web_retrieval_types.ts";

export async function loadWebRetrievalRuntimeConfig(
  path: string,
  signal?: AbortSignal,
): Promise<WebRetrievalRuntimeConfig> {
  let raw: string;
  try {
    raw = await readFile(path, { encoding: "utf8", signal });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw new WebRetrievalReadinessError("configuration-unavailable");
  }
  try {
    return validateWebRetrievalRuntimeConfig(JSON.parse(raw));
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw new WebRetrievalReadinessError("configuration-invalid");
  }
}

export async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  // A caller that already aborted must still observe the original rejection.
  // Other handlers attached to that promise continue to see it.
  promise.catch(() => {});
  if (signal.aborted) throw signal.reason ?? new Error("aborted");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function parseRetryWaitMs(
  headers: Headers,
  defaultWaitMs: number,
  nowMs = Date.now(),
): number {
  const retryAfter = headers.get("Retry-After")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - nowMs);
  }
  const reset = headers.get("X-RateLimit-Reset")?.split(",")[0]?.trim();
  if (reset) {
    const seconds = Number(reset);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  }
  return defaultWaitMs;
}

export async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
