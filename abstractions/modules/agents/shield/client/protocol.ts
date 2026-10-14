import { createConnection, type Socket } from "node:net";

// The hub's limits; see Shield.Protocol.

export const RECORD_LIMIT = 64 * 1024 * 1024;
export const LIVE_LIMIT = 16 * 1024 * 1024;
export interface Envelope {
  v: 1;
  type: string;
  id?: string;
  "agent-id": string | null;
  engine: string | null;
  success?: boolean;
  payload?: any;
  error?: { code: string };
  "hub-instance"?: string;
  seq?: number;
}

// Byte framing preserves split UTF-8 codepoints and Unicode separators.
export class JsonLines {
  private chunks: Buffer[] = [];
  private size = 0;
  feed(bytes: Uint8Array): unknown[] {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const records: unknown[] = [];
    let start = 0;
    while (start < buffer.length) {
      const end = buffer.indexOf(10, start);
      const chunk = buffer.subarray(start, end === -1 ? buffer.length : end);
      this.size += chunk.length;
      if (this.size > RECORD_LIMIT) throw new Error("frame_limit");
      this.chunks.push(chunk);
      if (end === -1) break;
      const line = Buffer.concat(this.chunks, this.size);
      this.chunks = []; this.size = 0;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
      const value = JSON.parse(text.endsWith("\r") ? text.slice(0, -1) : text);
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_record");
      records.push(value);
      start = end + 1;
    }
    return records;
  }
}

export class HubClient {
  private next = 0;
  private pending = new Map<string, { resolve: (r: Envelope) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private socket: Socket;
  private decoder = new JsonLines();
  onRecord: (r: Envelope) => void = () => {};
  onDisconnect: (e: Error) => void = () => {};
  private closed = false;
  readonly connected: Promise<void>;
  constructor(path: string) {
    this.socket = createConnection({ path });
    this.connected = new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("data", bytes => {
      try {
        for (const value of this.decoder.feed(typeof bytes === "string" ? Buffer.from(bytes) : bytes)) {
          const r = value as Envelope;
          if (r.v !== 1 || !("agent-id" in r) || !("engine" in r)) throw new Error("invalid_protocol");
          if (r.type === "response" && r.id) {
            const pending = this.pending.get(r.id);
            if (pending) { clearTimeout(pending.timer); this.pending.delete(r.id); pending.resolve(r); }
          } else this.onRecord(r);
        }
      } catch (e) { this.fail(e instanceof Error ? e : new Error(String(e))); this.socket.destroy(); }
    });
    this.socket.on("error", e => this.fail(e));
    this.socket.on("close", () => this.fail(new Error("disconnected; pending requests have unknown acceptance (not resent)")));
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.onDisconnect(error);
  }
  async request(type: "hub_request" | "engine_request", agent: string | null, payload: unknown, method?: string, id = `c${this.next++}`): Promise<Envelope> {
    await this.connected;
    if (this.closed) throw new Error("disconnected");
    if (this.pending.has(id) || this.pending.size >= 64) throw new Error("request_limit_or_duplicate");
    const record = { v: 1, type, id, "agent-id": agent, engine: "pi", method, payload };
    const frame = JSON.stringify(record) + "\n";
    if (Buffer.byteLength(frame) > RECORD_LIMIT || this.socket.writableLength + Buffer.byteLength(frame) > LIVE_LIMIT) throw new Error("outgoing_frame_or_queue_limit");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("request_timeout; acceptance unknown (not resent)")); }, 65_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(frame, e => { if (e) this.fail(e); });
    });
  }
  hub(method: string, payload: unknown = {}) { return this.request("hub_request", null, payload, method); }
  engine(agent: string, payload: unknown) { return this.request("engine_request", agent, payload); }
  close() { this.socket.destroy(); }
}
