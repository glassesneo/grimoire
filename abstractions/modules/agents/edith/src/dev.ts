// edith dev [--session <name>]: EDITH in this process, for trying it out. It serves the `cli`
// address from a terminal, without the socket or Discord, and prints each run as it streams:
// thinking, text, code mode calls and their scripts' calls, each block with the time since the
// input. Without a session the storage is a temporary directory removed on exit; a named session
// is kept under the configuration's `devDirectory` and resumed by its name.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AssistantEntry,
  type EntryId,
  type EntryRecord,
  type LiveState,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import { describe, parseModel, parseThinking } from "./commands.ts";
import { readConfig, start } from "./start.ts";
import { StreamReader } from "./stream.ts";
import { itemsOf, liveCalls, resultOf, type Call } from "./trace.ts";

const address = "cli";
const usage = "usage: edith dev [--session <name>]";
const help = [
  "/status            this conversation's profile, model and thinking level",
  "/profile <name>    run with a configured profile, or `default` for the configuration's",
  "/model <p>/<id>    set the model, or `default` to follow the profile",
  "/thinking <level>  set the thinking level, or `default`",
  "/exit              leave (also Ctrl-D)",
].join("\n");

export async function dev(args: readonly string[]): Promise<void> {
  let session: string | undefined;
  if (args.length === 2 && args[0] === "--session") session = args[1];
  else if (args.length !== 0) throw new UsageError(usage);
  if (session !== undefined && !/^[A-Za-z0-9._-]+$/.test(session))
    throw new UsageError("a session name uses only letters, digits, '.', '_' and '-'");

  const config = readConfig();
  const temporary = session === undefined ? mkdtempSync(join(tmpdir(), "edith-dev-")) : undefined;
  const directory = temporary ?? join(config.devDirectory, "sessions", session ?? "");
  const context = BACKGROUND_CONTEXT;
  const started = await start(
    config,
    {
      storage: join(directory, "session.sqlite"),
      credentials: join(config.devDirectory, "auth.json"),
    },
    context,
  );
  const { edith } = started;
  const conversation = await edith.conversation(address, context);
  console.log(session === undefined ? "session: temporary" : `session: ${session} (${directory})`);
  console.log(describe(await edith.status(address, context)));
  console.log("/help lists commands.");

  const tty = process.stdout.isTTY;
  const dim = (text: string) => (tty ? `\x1b[2m${text}\x1b[22m` : text);
  const out = (text: string) => process.stdout.write(text);

  // The current run's clock, and when it first showed thinking and text.
  let run: { at: number; thinking?: number; text?: number } | undefined;
  const since = () => (run ? ((Date.now() - run.at) / 1000).toFixed(2) : "-");
  const stamp = (label: string) => out(`\n${dim(`[+${since()}s]`)} ${label}`);

  const reader = new StreamReader();
  // The newest entry handled, the newest one each waiter waits for, and the calls shown.
  const newest = await conversation.entries({}, 1, undefined, context);
  let handled = newest.items[0]?.id ?? 0;
  const waiting: { entry: number; resolve: () => void }[] = [];
  const shownCalls = new Map<string, number>();
  let retryShown: number | undefined;

  const pieces = (content: Parameters<StreamReader["read"]>[0], attempt?: number) => {
    const read = reader.read(content, attempt);
    if (read.restarted) stamp("(retrying)");
    for (const piece of read.pieces) {
      if (piece.starts && run) {
        if (piece.kind === "thinking") run.thinking ??= Date.now();
        else run.text ??= Date.now();
      }
      if (piece.starts) stamp(piece.kind === "thinking" ? "💭 " : "💬 ");
      out(piece.kind === "thinking" ? dim(piece.text) : piece.text);
    }
  };
  const showCalls = (callId: string, calls: readonly Call[]) => {
    for (const call of calls.slice(shownCalls.get(callId) ?? 0)) {
      if (call.status === "pending" || call.status === "running") break;
      stamp(
        `   ${call.status === "ok" ? "✓" : "✗"} ${call.name} ${call.args.replace(/\s+/g, " ").slice(0, 100)}`,
      );
      shownCalls.set(callId, (shownCalls.get(callId) ?? 0) + 1);
    }
  };

  const handle = (entries: readonly EntryRecord[], live: LiveState | undefined) => {
    for (const entry of entries.filter((candidate) => candidate.id > handled)) {
      if (AssistantEntry.is(entry)) {
        const message = (entry.model ?? []).find((candidate) => candidate.role === "assistant");
        if (message?.role === "assistant") pieces(message.content);
        reader.reset();
        for (const item of itemsOf(entry))
          if (item.kind === "tool")
            stamp(`🔧 ${item.name}${item.code === undefined ? "" : `\n${dim(item.code)}`}`);
      }
      const result = resultOf(entry);
      if (result) {
        showCalls(result.callId, result.calls);
        stamp(`🔧 ${result.isError ? "✗" : "✓"}`);
        shownCalls.delete(result.callId);
      }
      handled = entry.id;
      for (const waiter of waiting.splice(0).filter((candidate) => {
        if (candidate.entry > handled) waiting.push(candidate);
        return candidate.entry <= handled;
      }))
        waiter.resolve();
    }
    const generation = live?.generation;
    if (generation?.message) pieces(generation.message.content, generation.attempt);
    if (generation?.retry && generation.retry.at !== retryShown) {
      retryShown = generation.retry.at;
      stamp(`(retry after error: ${generation.retry.error})`);
    }
    for (const slot of live?.tools ?? []) showCalls(slot.callId, liveCalls(live, slot.callId));
  };

  const watch = await conversation.watch(context, { from: (handled + 1) as EntryId });
  let chain = Promise.resolve();
  watch.start(async (call) => {
    if (call.kind !== "value") return;
    const view = call.value;
    chain = chain.then(() => handle(view.entries, view.docs["pi.live"] as LiveState | undefined));
    await chain;
  });

  // Waits for the watch to show an entry, or gives up after a while.
  const shown = (entry: number) =>
    new Promise<void>((resolve) => {
      if (entry <= handled) return resolve();
      const timer = setTimeout(resolve, 5000);
      waiting.push({ entry, resolve: () => (clearTimeout(timer), resolve()) });
    });

  const lines = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  // Input piped in may end while a run is still answering.
  let closed = false;
  lines.once("close", () => (closed = true));
  const prompt = () => {
    if (!closed) lines.prompt();
  };
  prompt();
  for await (const line of lines) {
    const text = line.trim();
    const [command, ...rest] = text.split(/\s+/);
    const argument = rest.join(" ");
    if (text === "") {
      prompt();
      continue;
    }
    if (command === "/exit") break;
    if (command === "/help") console.log(help);
    else if (command === "/status") console.log(describe(await edith.status(address, context)));
    else if (command === "/model") {
      const parsed = parseModel(argument);
      console.log(
        "error" in parsed
          ? parsed.error
          : describe(await edith.configure(address, { model: parsed.value }, context)),
      );
    } else if (command === "/profile") {
      if (argument === "") console.log(`profiles: ${edith.profiles().join(", ")}`);
      else
        console.log(
          describe(
            await edith
              .configure(address, { profile: argument === "default" ? null : argument }, context)
              .catch(async (error: unknown) => {
                console.log(error instanceof Error ? error.message : String(error));
                return edith.status(address, context);
              }),
          ),
        );
    } else if (command === "/thinking") {
      const parsed = parseThinking(argument);
      console.log(
        "error" in parsed
          ? parsed.error
          : describe(await edith.configure(address, { thinkingLevel: parsed.value }, context)),
      );
    } else if (command?.startsWith("/"))
      console.log(`unknown command ${command}; /help lists them`);
    else {
      run = { at: Date.now() };
      const submission: SubmissionId = await edith.submit(address, { content: text }, context);
      const answer = await edith.answer(submission, context);
      if (answer.status === "done") await shown(answer.entry);
      const firsts = (["thinking", "text"] as const)
        .map((kind) =>
          run?.[kind] === undefined
            ? `no ${kind}`
            : `first ${kind} +${((run[kind] - run.at) / 1000).toFixed(2)}s`,
        )
        .join(", ");
      stamp(answer.status === "done" ? `done: ${firsts}` : `unanswered: ${answer.reason}`);
      out("\n");
      run = undefined;
    }
    prompt();
  }
  lines.close();
  await watch.stop();
  await started.close();
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}

export class UsageError extends Error {}
