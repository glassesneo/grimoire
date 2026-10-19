/**
 * The runtime process the hub starts: `keel-runtime --config-dir DIR
 * [--session-dir DIR]` in the agent's working directory. stdin and stdout
 * carry the wire's LF-delimited JSON records and nothing else; anything code
 * would print goes to stderr, which the hub logs. The process ends when the
 * hub closes stdin or sends TERM; Pi is aborted first.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { RECORD_LIMIT } from "../../shield/client/protocol";
import { bundledExtensions } from "../extensions";
import type { RuntimeInput, RuntimeOutput } from "../protocol/wire";
import { Runtime } from "./host";
import { StoreError } from "./store";

const write = process.stdout.write.bind(process.stdout);
// Only `emit` writes the protocol stream; everything else goes to stderr.
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
for (const method of ["log", "info", "debug"] as const) console[method] = console.error;
process.emitWarning = () => {};

function emit(record: RuntimeOutput): void {
  let line = JSON.stringify(record);
  if (Buffer.byteLength(line) + 1 > RECORD_LIMIT) {
    if (record.type === "snapshot") {
      line = JSON.stringify({ type: "snapshot_error", id: record.id, code: "snapshot_too_large" });
    } else {
      write(`${JSON.stringify({ type: "fail", code: `${record.type}_too_large` })}\n`);
      process.exit(1);
    }
  }
  write(`${line}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { "config-dir": { type: "string" }, "session-dir": { type: "string" } },
  });
  const configDir = values["config-dir"];
  if (!configDir) throw new StoreError("usage", "--config-dir is required");
  let runtime: Runtime;
  try {
    runtime = await Runtime.start({
      cwd: process.cwd(),
      configDir,
      sessionDir: values["session-dir"],
      emit,
      bundled: bundledExtensions(),
    });
  } catch (error) {
    const code = error instanceof StoreError ? error.code : "start_failed";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`keel: ${message}\n`);
    write(`${JSON.stringify({ type: "fail", code, message })}\n`);
    process.exit(1);
  }
  let ending = false;
  const end = async () => {
    if (ending) return;
    ending = true;
    await runtime.dispose().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void end());
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    let record: RuntimeInput;
    try {
      record = JSON.parse(line);
    } catch {
      process.stderr.write("keel: a stdin record is not JSON\n");
      return;
    }
    runtime.handle(record);
  });
  input.on("close", () => void end());
}

void main().catch((error) => {
  process.stderr.write(`keel: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
