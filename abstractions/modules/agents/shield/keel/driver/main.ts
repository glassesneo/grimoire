/**
 * The driver process the hub starts: `keel-driver --config-dir DIR [--session-dir DIR]` in
 * the agent's working directory. stdin and stdout carry the keel contract's LF-delimited
 * JSON records and nothing else; anything code would print goes to stderr, which the hub
 * logs. stdin is read from the start, before extensions load, so what they ask of the model
 * is answered while they do. The process ends when the hub closes stdin or sends TERM; Pi is
 * aborted first, and nothing more is sent, so what screens show stays as it last was.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { RECORD_LIMIT } from "../../client/protocol";
import { bundledExtensions } from "../extensions";
import type { DriverRecord } from "../protocol/wire";
import { Driver } from "./driver";
import { ModelLink } from "./link";
import { Rejection } from "./outcome";

const write = process.stdout.write.bind(process.stdout);
// Only `emit` writes the protocol stream; everything else goes to stderr.
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
for (const method of ["log", "info", "debug"] as const) console[method] = console.error;
process.emitWarning = () => {};

/** Writes the failure the hub reports and exits. */
function fail(code: string, message: string): never {
  process.stderr.write(`keel: ${message}\n`);
  write(`${JSON.stringify({ type: "fail", code, message })}\n`);
  process.exit(1);
}

function emit(record: DriverRecord): void {
  const line = JSON.stringify(record);
  if (Buffer.byteLength(line) + 1 > RECORD_LIMIT)
    fail(`${record.type}_too_large`, `a ${record.type} record exceeds the record limit`);
  write(`${line}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { "config-dir": { type: "string" }, "session-dir": { type: "string" } },
  });
  const configDir = values["config-dir"];
  if (!configDir) fail("usage", "--config-dir is required");
  const link = new ModelLink(emit, fail);
  let driver: Driver | undefined;
  let ending = false;
  const end = async (reason: string) => {
    if (ending) return;
    ending = true;
    link.end(reason);
    await driver?.dispose(reason).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void end("terminated"));
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => link.receive(line));
  input.on("close", () => void end("stdin closed"));
  try {
    driver = await Driver.start({
      cwd: process.cwd(),
      configDir,
      sessionDir: values["session-dir"],
      link,
      bundled: bundledExtensions(),
    });
  } catch (error) {
    if (ending) return;
    fail(
      error instanceof Rejection ? error.code : "start_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

void main().catch((error) =>
  fail("start_failed", error instanceof Error ? error.message : String(error)),
);
