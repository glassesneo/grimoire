// Reads a streamed answer as it grows: the text each thinking and text block of the running
// generation's committed partial gained since the last read, and the rest once its entry commits.
// Clients that show an answer before it is done, such as `edith dev`, render these pieces.

export type Piece = {
  readonly kind: "thinking" | "text";
  // The block's index in the message's content.
  readonly index: number;
  readonly text: string;
  // Whether the block got its first text in this read.
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
  // Characters already read per block of the current message.
  #read = new Map<number, number>();
  #attempt: number | undefined;

  // The new text of a message, in content order. A different attempt, a retry of the generation,
  // starts over; its pieces then restart the blocks.
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

  // Ends the message: the next read is of a new generation.
  reset(): void {
    this.#read.clear();
    this.#attempt = undefined;
  }
}

// Waits for a client's cursor to reach an entry; each wait gives up after a while.
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

  // The cursor has reached `entry`.
  release(entry: number): void {
    const ready = this.#waiting.filter((waiter) => waiter.entry <= entry);
    this.#waiting = this.#waiting.filter((waiter) => waiter.entry > entry);
    for (const waiter of ready) waiter.resolve();
  }
}
