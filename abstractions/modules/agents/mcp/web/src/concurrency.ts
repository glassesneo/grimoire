import { raceWithSignal } from "./web_retrieval_runtime.ts";

export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be a positive integer");
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  const results = Array.from({ length: values.length }, () => undefined as R);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      if (signal?.aborted) throw signal.reason ?? new Error("aborted");
      const index = nextIndex;
      nextIndex += 1;
      const mapped = mapper(values[index]!, index);
      results[index] = await (signal === undefined ? mapped : raceWithSignal(mapped, signal));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
