export type Piece = {
  readonly kind: "thinking" | "text";
  readonly index: number;
  readonly text: string;
  readonly starts: boolean;
};

type Part = { readonly type: string; readonly thinking?: unknown; readonly text?: unknown };

const textOf = (part: Part): [Piece["kind"], string] | undefined => {
  if (part.type === "thinking" && typeof part.thinking === "string")
    return ["thinking", part.thinking];
  if (part.type === "text" && typeof part.text === "string") return ["text", part.text];
  return undefined;
};

export class StreamReader {
  #read = new Map<number, number>();
  #attempt: number | undefined;

  read(
    content: readonly Part[],
    attempt?: number,
  ): { readonly restarted: boolean; readonly pieces: Piece[] } {
    const restarted =
      attempt !== undefined && this.#attempt !== undefined && attempt !== this.#attempt;
    if (attempt !== undefined) this.#attempt = attempt;
    if (restarted) this.#read.clear();
    const pieces: Piece[] = [];
    content.forEach((part, index) => {
      const found = textOf(part);
      if (!found) return;
      const [kind, text] = found;
      const read = this.#read.get(index) ?? 0;
      if (text.length <= read) return;
      pieces.push({ kind, index, text: text.slice(read), starts: read === 0 });
      this.#read.set(index, text.length);
    });
    return { restarted, pieces };
  }

  reset(): void {
    this.#read.clear();
    this.#attempt = undefined;
  }
}

export class EntryWaiters {
  #waiting: { entry: number; resolve: () => void }[] = [];

  wait(entry: number, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeout);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.#waiting.push({ entry, resolve: done });
    });
  }

  release(entry: number): void {
    const ready = this.#waiting.filter((waiter) => waiter.entry <= entry);
    this.#waiting = this.#waiting.filter((waiter) => waiter.entry > entry);
    for (const waiter of ready) waiter.resolve();
  }
}
