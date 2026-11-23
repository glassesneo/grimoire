// edith dev [--session <name>]: EDITH in this process, for trying it out. It serves the `cli`
// address from a terminal, without the socket or Discord, and prints each run as it streams:
// thinking, text, code mode calls and their scripts' calls, each block with the time since the
// input. Input may be typed while a run answers; Ctrl-C stops the run. Without a session the storage is a temporary directory removed on exit; a named session
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
import {
  describe,
  describeHold,
  describeSessions,
  followDefault,
  messageOf,
  parseModel,
  parseThinking,
} from "./commands.ts";
import type { Status } from "./core.ts";
import { readConfig, start } from "./start.ts";
import { EntryWaiters, StreamReader } from "./stream.ts";
import { itemsOf, liveCalls, resultOf, type Call } from "./trace.ts";

const address = "cli";
const usage = "usage: edith dev [--session <name>]";
// How soon a second Ctrl-C leaves.
const exitWindow = 2_000;
// How long a finished run waits for the watch to show its answer.
const shownWait = 5_000;
// How often a pause is looked at until it holds.
const holdPoll = 500;
const help = [
  "/status            this conversation's access, persona, model and thinking level",
  "/access [name]     run with an access `cli` may choose, or `default`; alone, lists them",
  "/persona [name]    answer as a configured persona, or `default`; alone, lists them",
  "/model <p>/<id>    set the model, or `default` to follow the persona",
  "/thinking <level>  set the thinking level, or `default`",
  "/pause, /resume    hold the conversation before its next step, and let it go on",
  "/stop              stop the run and drop input not yet read (also Ctrl-C; twice leaves)",
  "/new               start a new conversation; the current one is kept",
  "/sessions [n]      list this session's conversations, or switch to the n-th",
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
  console.log(session === undefined ? "session: temporary" : `session: ${session} (${directory})`);
  console.log(describe(await edith.status(address, context)));
  console.log("/help lists commands.");

  const tty = process.stdout.isTTY;
  const dim = (text: string) => (tty ? `\x1b[2m${text}\x1b[22m` : text);
  const out = (text: string) => process.stdout.write(text);

  // The current run's clock, and when it first showed thinking and text.
  let current: { at: number; thinking?: number; text?: number } | undefined;
  const since = () => (current ? ((Date.now() - current.at) / 1000).toFixed(2) : "-");
  const stamp = (label: string) => out(`\n${dim(`[+${since()}s]`)} ${label}`);

  const reader = new StreamReader();
  // The newest entry handled, the newest one each waiter waits for, and the calls shown.
  const newest = await (
    await edith.conversation(address, context)
  ).entries({}, 1, undefined, context);
  let handled = newest.items[0]?.id ?? 0;
  const waiting = new EntryWaiters();
  const shownCalls = new Map<string, number>();
  let retryShown: number | undefined;

  const pieces = (content: Parameters<StreamReader["read"]>[0], attempt?: number) => {
    const read = reader.read(content, attempt);
    if (read.restarted) stamp("(retrying)");
    for (const piece of read.pieces) {
      if (piece.starts && current) {
        if (piece.kind === "thinking") current.thinking ??= Date.now();
        else current.text ??= Date.now();
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
      waiting.release(handled);
    }
    const generation = live?.generation;
    if (generation?.message) pieces(generation.message.content, generation.attempt);
    if (generation?.retry && generation.retry.at !== retryShown) {
      retryShown = generation.retry.at;
      stamp(`(retry after error: ${generation.retry.error})`);
    }
    for (const slot of live?.tools ?? []) showCalls(slot.callId, liveCalls(live, slot.callId));
  };

  // Follows the address's conversation, again after it moves to another one.
  let chain = Promise.resolve();
  const follow = async () => {
    const conversation = await edith.conversation(address, context);
    const watch = await conversation.watch(context, { from: (handled + 1) as EntryId });
    watch.start(async (call) => {
      if (call.kind !== "value") return;
      const view = call.value;
      chain = chain.then(() => handle(view.entries, view.docs["pi.live"] as LiveState | undefined));
      await chain;
    });
    return watch;
  };
  let watch = await follow();
  const moved = async (to: { current: number }) => {
    await chain;
    await watch.stop();
    reader.reset();
    watch = await follow();
    console.log(`now in conversation ${to.current}`);
  };

  // Waits for the watch to show an entry, or gives up after a while.
  const shown = (entry: number) =>
    entry <= handled ? Promise.resolve() : waiting.wait(entry, shownWait);

  const lines = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  // Input piped in may end while a run is still answering.
  let closed = false;
  lines.once("close", () => (closed = true));
  const prompt = () => {
    if (!closed) lines.prompt();
  };
  // Runs answering, each finishing in the background so that commands can be typed meanwhile.
  const runs = new Set<Promise<void>>();
  const show = (status: Promise<Status>) =>
    status.then(
      (value) => console.log(describe(value)),
      (error: unknown) => console.log(messageOf(error)),
    );
  // Ctrl-C stops a run; pressed again soon after, or with nothing running, it leaves.
  let interrupted = 0;
  lines.on("SIGINT", () => {
    if (runs.size === 0 || Date.now() - interrupted < exitWindow) return lines.close();
    interrupted = Date.now();
    console.log("\nstopping; Ctrl-C again to leave");
    void show(edith.stop(address, context));
  });
  // Once a pause holds, shows where, in the run's output.
  const showHold = async () => {
    const held = await edith.whenHeld(address, holdPoll, context);
    if (held && !closed) stamp(describeHold(held));
  };
  const run = async (text: string) => {
    // An input taken in by a run under way shares that run's clock.
    const clock = current ?? { at: Date.now() };
    current = clock;
    let submission: SubmissionId;
    try {
      submission = await edith.submit(address, { content: text }, context);
    } catch (error) {
      console.log(messageOf(error));
      return;
    }
    const answer = await edith.answer(submission, context);
    if (answer.status === "done") await shown(answer.entry);
    const firsts = (["thinking", "text"] as const)
      .map((kind) =>
        clock[kind] === undefined
          ? `no ${kind}`
          : `first ${kind} +${((clock[kind] - clock.at) / 1000).toFixed(2)}s`,
      )
      .join(", ");
    stamp(
      answer.status === "done"
        ? `done: ${firsts}`
        : answer.status === "stopped"
          ? "⏹️ stopped"
          : `unanswered: ${answer.reason}`,
    );
    out("\n");
    if (current === clock) current = undefined;
    prompt();
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
    else if (command === "/status") await show(edith.status(address, context));
    else if (command === "/model") {
      const parsed = parseModel(argument);
      if ("error" in parsed) console.log(parsed.error);
      else await show(edith.configure(address, { model: parsed.value }, context));
    } else if (command === "/access" || command === "/persona") {
      const kind = command === "/access" ? "access" : "persona";
      if (argument === "")
        console.log(
          `${kind}: ${(kind === "access" ? edith.accessChoices(address) : edith.personas()).join(", ")}`,
        );
      else
        await show(
          edith.configure(
            address,
            { [kind]: argument === followDefault ? null : argument },
            context,
          ),
        );
    } else if (command === "/thinking") {
      const parsed = parseThinking(argument);
      if ("error" in parsed) console.log(parsed.error);
      else await show(edith.configure(address, { thinkingLevel: parsed.value }, context));
    } else if (command === "/pause") {
      await show(edith.pause(address, context));
      void showHold();
    } else if (command === "/resume") await show(edith.resume(address, context));
    else if (command === "/stop") await show(edith.stop(address, context));
    else if (command === "/new") await moved(await edith.reset(address, context));
    else if (command === "/sessions") {
      const sessions = await edith.sessions(address, context);
      const index = Number(argument) - 1;
      const target = argument === "" ? undefined : sessions[index];
      if (argument === "") console.log(describeSessions(sessions));
      else if (!target) console.log(`no session ${argument}`);
      else
        await edith
          .switchTo(address, target.conversation, context)
          .then(moved, (error: unknown) => console.log(messageOf(error)));
    } else if (command?.startsWith("/"))
      console.log(`unknown command ${command}; /help lists them`);
    else {
      const answering = run(text).finally(() => runs.delete(answering));
      runs.add(answering);
      continue;
    }
    prompt();
  }
  await Promise.all(runs);
  lines.close();
  await watch.stop();
  await started.close();
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}

export class UsageError extends Error {}
