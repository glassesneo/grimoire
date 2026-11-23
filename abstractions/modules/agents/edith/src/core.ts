// EDITH's core: one Harness whose conversations clients reach by address. An address is
// `<namespace>:<name>`, such as `discord:<channel id>` or `cli`. A conversation runs with an
// access and a persona. An access is what it may do: the tools, MCP servers and turn limit, which
// only the configuration defines. A persona is who answers: the model and thinking level the
// conversation follows unless it overrides them. Each is the one a client chose for the
// address, or else its namespace's; a chosen access must lie within the namespace's ceiling. These
// choices belong to the address, and outlive its sessions: an address can start a new conversation
// and switch back to an earlier one, but only to one whose label, the greatest access it ever ran
// with, lies within the namespace's ceiling, so that nothing a higher access reached is shown where
// that access is not allowed. A conversation can be paused (see `control.ts`) and stopped.
import type { Context } from "@earendil-works/chord/context";
import type { ModelThinkingLevel, Models } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  configure,
  createRegistry,
  defineDoc,
  defineDocFamily,
  Harness,
  type Conversation,
  type ConversationId,
  type Extension,
  type HarnessOptions,
  type InputSubmissionDraft,
  type ModelRef,
  type Report,
  type Storage,
  type SubmissionId,
  type ToolRegistration,
  type Tx,
} from "@earendil-works/pi-durable";
import { CODEMODE_TOOL_NAME } from "@earendil-works/pi-durable/codemode";
import { controlExtension, heldStep, PauseDoc, wake } from "./control.ts";
import { serverExtensionName } from "./mcp.ts";
import type { ToolName } from "./tools.ts";

export type Access = {
  // Tools of `Options.tools`, by name, and MCP servers whose tools the conversation's code mode
  // scripts may call.
  readonly tools: readonly ToolName[];
  readonly mcpServers: readonly string[];
  readonly maxTurns: number | null;
};

export type Persona = {
  readonly model: ModelRef;
  readonly thinkingLevel: ModelThinkingLevel;
};

// A namespace's access and persona, and the greatest access its conversations may choose.
export type Namespace = {
  readonly access: string;
  readonly ceiling: string;
  readonly persona: string;
};

const fallbackAccess = "restricted";
const fallbackPersona = "edith";
const fallbackNamespace: Namespace = {
  access: fallbackAccess,
  ceiling: fallbackAccess,
  persona: fallbackPersona,
};

// What an access grants, as compared; a label is one too.
type Grant = {
  readonly tools: readonly string[];
  readonly mcpServers: readonly string[];
  readonly maxTurns: number | null;
};

// Whether an access grants nothing beyond another: its tools and servers are among the other's,
// and its turn limit is no higher.
export function within(access: Grant, ceiling: Grant): boolean {
  return (
    access.tools.every((tool) => ceiling.tools.includes(tool)) &&
    access.mcpServers.every((server) => ceiling.mcpServers.includes(server)) &&
    (ceiling.maxTurns === null || (access.maxTurns !== null && access.maxTurns <= ceiling.maxTurns))
  );
}

// A null field follows the default: the namespace's access or persona, or the persona's model and
// thinking level; `configure` sets or clears an override.
export type Overrides = {
  access: string | null;
  persona: string | null;
  model: ModelRef | null;
  thinkingLevel: ModelThinkingLevel | null;
};

const noOverrides: Overrides = { access: null, persona: null, model: null, thinkingLevel: null };

export type Status = {
  readonly address: string;
  readonly access: string;
  readonly persona: string;
  readonly model: ModelRef;
  readonly thinkingLevel: ModelThinkingLevel;
  readonly tools: readonly string[];
  readonly mcpServers: readonly string[];
  readonly overrides: Readonly<Overrides>;
  readonly paused: boolean;
};

// A conversation an address has had: the current one first.
export type SessionInfo = {
  readonly conversation: number;
  readonly current: boolean;
  // When the address started it, if known.
  readonly started: number | null;
  // Its title, once it has one, else the start of its first input.
  readonly preview: string;
  // Whether the address may switch to it.
  readonly allowed: boolean;
};

export type Answer =
  | { readonly status: "done"; readonly text: string; readonly entry: number }
  | { readonly status: "unanswered"; readonly reason: string };

export type Options = {
  readonly models: Models;
  readonly access: Readonly<Record<string, Access>> & { readonly restricted: Access };
  readonly personas: Readonly<Record<string, Persona>> & { readonly edith: Persona };
  // A namespace not listed has `restricted` as its access and ceiling and `edith` as its persona.
  readonly namespaces: Readonly<Record<string, Namespace>>;
  // The code mode extension, through which alone the model reaches tools.
  readonly codemode?: Extension;
  // Extensions of the MCP servers that started, from `connectServer`.
  readonly servers?: readonly Extension[];
  // The extension of the tools accesses select by name, and the environment they run in.
  readonly tools?: Extension;
  readonly env?: HarnessOptions["env"];
  readonly onReport?: (report: Report) => void;
};

// A title is given once the address leaves the conversation.
type Started = { conversation: number; started: number | null; title?: string };
// An address's conversation and its earlier ones, newest first.
type AddressState = {
  conversation: number | null;
  started: number | null;
  sessions: Started[];
};

const Address = defineDocFamily<AddressState, null>({
  kind: "edith.address",
  // Version 2 adds `started` and `sessions`.
  version: 2,
  scope: "session",
  family: true,
  initial: () => ({ conversation: null, started: null, sessions: [] }),
  migrate: (value) => ({
    started: null,
    sessions: [],
    ...(value as { conversation: number | null }),
  }),
  checkpointWhen: () => true,
});

// An address's overrides.
const Settings = defineDocFamily<Overrides, null>({
  kind: "edith.settings",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ ...noOverrides }),
  checkpointWhen: () => true,
});

type Label = { tools: string[]; mcpServers: string[]; maxTurns: number | null };

// The greatest access a conversation ran with: every tool and server it was given, and the highest
// turn limit, `null` for none.
const LabelDoc = defineDoc<Label>({
  kind: "edith.label",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ tools: [], mcpServers: [], maxTurns: 0 }),
  checkpointWhen: () => true,
});

// Written after a stopped run, in a user message, since the model reads instructions there; it
// says who wrote it, so that the model does not take it for the user's words.
export const stoppedNote =
  "[Chat client note, not the user's words: the user stopped you while you were working on the request above. Treat that request as closed. Respond to the user's next message, and take the stopped work up again only if that message asks for it.]";

const titleLimit = 60;
const excerptLimit = 6000;

// Asks for a session's title: the excerpt is the conversation as data, the reply the title alone.
const titlePrompt = (excerpt: string) =>
  [
    "Write a title for the conversation below. It names the conversation in a list the user picks past conversations from.",
    "Use the conversation's language and at most 40 characters. Reply with the title alone.",
    "",
    "<conversation>",
    excerpt,
    "</conversation>",
  ].join("\n");

const raise = (label: Label, access: Grant) => {
  for (const tool of access.tools) if (!label.tools.includes(tool)) label.tools.push(tool);
  for (const server of access.mcpServers)
    if (!label.mcpServers.includes(server)) label.mcpServers.push(server);
  label.maxTurns =
    label.maxTurns === null || access.maxTurns === null
      ? null
      : Math.max(label.maxTurns, access.maxTurns);
};

// Where overrides were kept before they belonged to the address: read once to carry them over.
const OverridesDoc = defineDoc<Overrides>({
  kind: "edith.overrides",
  // Version 2 added `profile`; version 3 replaces it with `access` and `persona`, leaving both
  // to follow the namespace.
  version: 3,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ ...noOverrides }),
  migrate: (value) => {
    const { model, thinkingLevel } = value as Partial<Overrides>;
    return { ...noOverrides, model: model ?? null, thinkingLevel: thinkingLevel ?? null };
  },
  checkpointWhen: () => true,
});

export function namespaceOf(address: string): string {
  const index = address.indexOf(":");
  return index < 0 ? address : address.slice(0, index);
}

type Equipment = {
  readonly extensions: readonly Extension[];
  // The selected extensions' tools an access leaves out.
  readonly tools: { readonly remove: readonly ToolRegistration[] } | null;
  readonly modelTools: readonly ToolRegistration[] | null;
};

const unequipped: Equipment = { extensions: [controlExtension], tools: null, modelTools: null };

export class Edith {
  readonly harness: Harness;
  readonly #options: Options;
  readonly #servers: ReadonlyMap<string, Extension>;
  // Conversations by address, kept once open; sharing the opening promise also makes
  // concurrent first messages share one conversation.
  readonly #conversations = new Map<string, Promise<Conversation>>();
  // Titles being written, which closing waits for.
  readonly #titling = new Set<Promise<void>>();

  private constructor(harness: Harness, options: Options) {
    this.harness = harness;
    this.#options = options;
    this.#servers = new Map((options.servers ?? []).map((server) => [server.name, server]));
  }

  static async open(storage: Storage, options: Options, context: Context): Promise<Edith> {
    const registry = createRegistry();
    for (const extension of [
      controlExtension,
      options.codemode ?? [],
      options.tools ?? [],
      options.servers ?? [],
    ].flat())
      registry.install(extension);
    const harness = await Harness.open(
      storage,
      {
        models: options.models,
        registry,
        ...(options.env && { env: options.env }),
        ...(options.onReport && { onReport: options.onReport }),
      },
      context,
    );
    harness.resume();
    return new Edith(harness, options);
  }

  #namespace(namespace: string): Namespace {
    return this.#options.namespaces[namespace] ?? fallbackNamespace;
  }

  // The accesses a namespace's conversations may choose: those within its ceiling.
  accessChoices(namespace: string): string[] {
    const ceiling = this.#options.access[this.#namespace(namespace).ceiling];
    return Object.entries(this.#options.access).flatMap(([name, access]) =>
      ceiling && within(access, ceiling) ? [name] : [],
    );
  }

  // The configured personas' names.
  personas(): string[] {
    return Object.keys(this.#options.personas);
  }

  // The access a conversation runs with, by name: its chosen one while the configuration still
  // has it within the namespace's ceiling, else its namespace's, else `restricted`.
  #access(address: string, chosen: string | null): [string, Access] {
    const namespace = namespaceOf(address);
    const allowed = this.accessChoices(namespace);
    for (const name of [chosen, this.#namespace(namespace).access]) {
      const access = name == null ? undefined : this.#options.access[name];
      if (name != null && access && allowed.includes(name)) return [name, access];
    }
    return [fallbackAccess, this.#options.access.restricted];
  }

  // The persona a conversation runs with, by name: its chosen one while the configuration still
  // has it, else its namespace's, else `edith`.
  #persona(address: string, chosen: string | null): [string, Persona] {
    for (const name of [chosen, this.#namespace(namespaceOf(address)).persona]) {
      const persona = name == null ? undefined : this.#options.personas[name];
      if (name != null && persona) return [name, persona];
    }
    return [fallbackPersona, this.#options.personas.edith];
  }

  // An address's overrides, or, until it has its own, those its conversation kept.
  async #overrides(address: string, context: Context): Promise<Overrides> {
    const own = await this.harness.snapshot(Settings, address, context);
    if (own) return { ...noOverrides, ...own };
    const conversation = await this.conversation(address, context);
    return {
      ...noOverrides,
      ...(await this.harness.snapshot(OverridesDoc, conversation.id, context)),
    };
  }

  #ceiling(address: string): Access {
    return (
      this.#options.access[this.#namespace(namespaceOf(address)).ceiling] ??
      this.#options.access.restricted
    );
  }

  // What an access's conversations run with: nothing callable without tools or servers,
  // otherwise code mode as the model's only tool and the selected tools and the servers' tools
  // behind it. A server that did not start is left out.
  #equipment(access: Access): Equipment {
    const codemode = this.#options.codemode;
    const tool = codemode?.tools?.find((candidate) => candidate.name === CODEMODE_TOOL_NAME);
    const servers = access.mcpServers.flatMap(
      (server) => this.#servers.get(serverExtensionName(server)) ?? [],
    );
    const own = this.#options.tools;
    const selected = (own?.tools ?? []).filter((candidate) =>
      (access.tools as readonly string[]).includes(candidate.name),
    );
    if (!codemode || !tool || (selected.length === 0 && servers.length === 0)) return unequipped;
    if (!own || selected.length === 0)
      return {
        extensions: [controlExtension, codemode, ...servers],
        tools: null,
        modelTools: [tool],
      };
    return {
      extensions: [controlExtension, codemode, own, ...servers],
      tools: { remove: (own.tools ?? []).filter((candidate) => !selected.includes(candidate)) },
      modelTools: [tool],
    };
  }

  conversation(address: string, context: Context): Promise<Conversation> {
    const known = this.#conversations.get(address);
    if (known) return known;
    const opening = this.#open(address, context);
    opening.catch(() => this.#conversations.delete(address));
    this.#conversations.set(address, opening);
    return opening;
  }

  async #open(address: string, context: Context): Promise<Conversation> {
    const stored = await this.harness.snapshot(Address, address, context);
    if (stored?.conversation != null) {
      const found = await this.harness.conversation(stored.conversation as ConversationId, context);
      if (found) return found;
    }
    const created = await this.harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    await this.harness.commit(async (tx) => {
      const state = await tx.doc(Address, address, null);
      state.conversation = created.id;
      state.started = Date.now();
    }, context);
    return created;
  }

  async status(address: string, context: Context): Promise<Status> {
    const conversation = await this.conversation(address, context);
    const overrides = await this.#overrides(address, context);
    const pause = await this.harness.snapshot(PauseDoc, conversation.id, context);
    const [accessName, access] = this.#access(address, overrides.access);
    const [personaName, persona] = this.#persona(address, overrides.persona);
    return {
      address,
      access: accessName,
      persona: personaName,
      model: overrides.model ?? persona.model,
      thinkingLevel: overrides.thinkingLevel ?? persona.thinkingLevel,
      tools: access.tools,
      mcpServers: access.mcpServers,
      overrides: { ...overrides },
      paused: pause?.paused ?? false,
    };
  }

  // Sets or clears an address's overrides; an access must be one its namespace may choose,
  // and a persona a configured one.
  async configure(address: string, change: Partial<Overrides>, context: Context): Promise<Status> {
    if (change.access != null) {
      if (!(change.access in this.#options.access))
        throw new Refused(`no access named ${change.access}`);
      if (!this.accessChoices(namespaceOf(address)).includes(change.access))
        throw new Refused(
          `access ${change.access} exceeds what ${namespaceOf(address)} may choose`,
        );
    }
    if (change.persona != null && !(change.persona in this.#options.personas))
      throw new Refused(`no persona named ${change.persona}`);
    const current = await this.#overrides(address, context);
    await this.harness.commit(async (tx) => {
      const overrides = Object.assign(await tx.doc(Settings, address, null), current);
      if (change.access !== undefined) overrides.access = change.access;
      if (change.persona !== undefined) overrides.persona = change.persona;
      if (change.model !== undefined) overrides.model = change.model;
      if (change.thinkingLevel !== undefined) overrides.thinkingLevel = change.thinkingLevel;
    }, context);
    return this.status(address, context);
  }

  // Admits an input; `alsoInCommit` writes a client's own state in the same commit. Input to a
  // paused conversation ends the pause: a run under way takes it in where it holds, and a tool call
  // held there is not run.
  async submit(
    address: string,
    draft: Omit<InputSubmissionDraft, "type">,
    context: Context,
    alsoInCommit?: (tx: Tx, submission: SubmissionId) => Promise<void>,
  ): Promise<SubmissionId> {
    const conversation = await this.conversation(address, context);
    const wanted = await this.status(address, context);
    const access = this.#options.access[wanted.access] ?? this.#options.access.restricted;
    const equipment = this.#equipment(access);
    const ceiling = this.#ceiling(address);
    const interjects = wanted.paused && (await this.busy(address, context));
    const steer = interjects ? { whenBusy: "steer" as const } : {};
    const id = await this.harness.commit(async (tx) => {
      if (wanted.paused) (await tx.doc(PauseDoc, conversation.id)).paused = false;
      const label = await tx.doc(LabelDoc, conversation.id);
      if (!within(label, ceiling))
        throw new Refused(
          `this session ran with more than ${namespaceOf(address)} may reach; start a new one`,
        );
      raise(label, access);
      // The configuration can change between runs of the daemon, so the agent is brought to the
      // effective choices with each input; writing an equal value changes nothing.
      await configure(tx, conversation.id, {
        model: wanted.model,
        thinkingLevel: wanted.thinkingLevel,
        extensions: equipment.extensions,
        tools: equipment.tools,
        modelTools: equipment.modelTools,
        maxTurns: access.maxTurns,
      });
      const id = await conversation.submit(tx, {
        ...draft,
        ...steer,
        type: "input",
      } as InputSubmissionDraft);
      await alsoInCommit?.(tx, id);
      return id;
    }, context);
    // Only once the input is in: a held step woken without it would only park again.
    if (interjects) {
      const pause = await this.harness.snapshot(PauseDoc, conversation.id, context);
      if (pause) await wake(this.harness, conversation.id, pause, "interject", context);
    }
    return id;
  }

  // Pauses an address's conversation: no new step starts until it is resumed or stopped.
  async pause(address: string, context: Context): Promise<Status> {
    const conversation = await this.conversation(address, context);
    await this.harness.commit(async (tx) => {
      const pause = await tx.doc(PauseDoc, conversation.id);
      if (pause.paused) return;
      pause.paused = true;
      pause.epoch += 1;
    }, context);
    return this.status(address, context);
  }

  async resume(address: string, context: Context): Promise<Status> {
    const conversation = await this.conversation(address, context);
    const pause = await this.harness.commit(async (tx) => {
      const pause = await tx.doc(PauseDoc, conversation.id);
      pause.paused = false;
      return { ...pause };
    }, context);
    await wake(this.harness, conversation.id, pause, "resume", context);
    return this.status(address, context);
  }

  // Whether an address's conversation is running or has input waiting.
  async busy(address: string, context: Context): Promise<boolean> {
    const conversation = await this.conversation(address, context);
    const inspection = await this.harness.inspect(context);
    return (
      inspection.tasks.some(
        (task) => task.record.conversationId === conversation.id && !task.record.background,
      ) ||
      inspection.submissions.some((submission) => submission.conversationId === conversation.id)
    );
  }

  // Where an address's paused conversation holds, once it does: before a tool call the model
  // asked for, or before its next model request.
  async held(address: string, context: Context): Promise<"tool" | "request" | undefined> {
    const conversation = await this.conversation(address, context);
    return heldStep(await this.harness.inspect(context), conversation.id);
  }

  // Stops what an address's conversation is doing and withdraws the input not yet given to the
  // model; a pause ends with it. What already happened, such as a file written, stays. The stopped
  // request stays in the context unanswered, so a note after it tells the model not to take it up
  // again on its own.
  async stop(address: string, context: Context): Promise<Status> {
    const conversation = await this.conversation(address, context);
    const busy = await this.busy(address, context);
    await conversation.abort(context);
    if (busy)
      await conversation.submit(
        {
          type: "write",
          entry: {
            kind: "edith.stopped",
            model: [{ role: "user", content: stoppedNote, timestamp: Date.now() }],
          },
        },
        context,
      );
    await this.harness.commit(async (tx) => {
      (await tx.doc(PauseDoc, conversation.id)).paused = false;
    }, context);
    return this.status(address, context);
  }

  // The conversations an address has had, the current one first.
  async sessions(address: string, context: Context): Promise<SessionInfo[]> {
    const current = await this.conversation(address, context);
    const state = await this.harness.snapshot(Address, address, context);
    const ceiling = this.#ceiling(address);
    const all: Started[] = [
      { conversation: current.id, started: state?.started ?? null },
      ...(state?.sessions ?? []),
    ];
    return Promise.all(
      all.map(async (session, index) => ({
        ...session,
        current: index === 0,
        preview: session.title ?? (await this.#preview(session.conversation, context)),
        allowed:
          index === 0 || within(await this.#label(address, session.conversation, context), ceiling),
      })),
    );
  }

  // Starts a new conversation at an address, stopping the current one, which stays among its
  // sessions.
  async reset(address: string, context: Context): Promise<{ previous: number; current: number }> {
    const previous = await this.conversation(address, context);
    await this.stop(address, context);
    const created = await this.harness.createConversation(
      { ownership: { kind: "ownerless" } },
      context,
    );
    await this.#rebind(address, previous.id, created.id, Date.now(), context);
    this.#conversations.set(address, Promise.resolve(created));
    this.#titleLater(address, previous.id, context);
    return { previous: previous.id, current: created.id };
  }

  // Switches an address back to one of its earlier conversations, stopping the current one.
  async switchTo(
    address: string,
    target: number,
    context: Context,
  ): Promise<{ previous: number; current: number }> {
    const previous = await this.conversation(address, context);
    if (target === previous.id) return { previous: previous.id, current: target };
    const state = await this.harness.snapshot(Address, address, context);
    const found = state?.sessions.find((session) => session.conversation === target);
    const conversation =
      found && (await this.harness.conversation(target as ConversationId, context));
    if (!found || !conversation) throw new Refused("not a session of this address");
    if (!within(await this.#label(address, target, context), this.#ceiling(address)))
      throw new Refused(`that session ran with more than ${namespaceOf(address)} may reach`);
    await this.stop(address, context);
    await this.#rebind(address, previous.id, target, found.started, context);
    this.#conversations.set(address, Promise.resolve(conversation));
    this.#titleLater(address, previous.id, context);
    return { previous: previous.id, current: target };
  }

  // Titles a conversation the address left, in the background, with the address's model; one with
  // a title, or nothing to title, keeps what it has.
  #titleLater(address: string, conversation: number, context: Context): void {
    const titling = (async () => {
      const state = await this.harness.snapshot(Address, address, context);
      if (state?.sessions.find((session) => session.conversation === conversation)?.title) return;
      const excerpt = await this.#excerpt(conversation, context);
      if (excerpt === "") return;
      const wanted = await this.status(address, context);
      const model = this.#options.models.getModel(wanted.model.provider, wanted.model.modelId);
      if (!model) return;
      const reply = await this.#options.models.completeSimple(model, {
        messages: [{ role: "user", content: titlePrompt(excerpt), timestamp: Date.now() }],
      });
      const title = reply.content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, titleLimit);
      if (title === "") return;
      await this.harness.commit(async (tx) => {
        const session = (await tx.doc(Address, address, null)).sessions.find(
          (candidate) => candidate.conversation === conversation,
        );
        if (session) session.title = title;
      }, context);
    })();
    this.#titling.add(titling);
    titling
      .catch((error: unknown) => console.error("session title:", error))
      .finally(() => this.#titling.delete(titling));
  }

  // The conversation's text, as the title prompt shows it: who said what, up to a length.
  async #excerpt(conversation: number, context: Context): Promise<string> {
    const found = await this.harness.conversation(conversation as ConversationId, context);
    const page = await found?.entries({ order: "ascending" }, 200, undefined, context);
    const lines: string[] = [];
    for (const entry of page?.items ?? [])
      for (const message of entry.model ?? []) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        const text = (
          typeof message.content === "string"
            ? [message.content]
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
        )
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text !== "" && text !== stoppedNote)
          lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${text}`);
      }
    return lines.join("\n").slice(0, excerptLimit);
  }

  // Points an address at another conversation, keeping the one it leaves, labelled, and its
  // overrides with the address.
  async #rebind(
    address: string,
    leaving: number,
    next: number,
    started: number | null,
    context: Context,
  ): Promise<void> {
    const overrides = await this.#overrides(address, context);
    const label = await this.#label(address, leaving, context);
    await this.harness.commit(async (tx) => {
      Object.assign(await tx.doc(Settings, address, null), overrides);
      Object.assign(await tx.doc(LabelDoc, leaving as ConversationId), label);
      const state = await tx.doc(Address, address, null);
      const kept = state.sessions.find((session) => session.conversation === leaving);
      const left = { ...kept, conversation: leaving, started: state.started };
      state.sessions = [
        left,
        ...state.sessions.filter(
          (session) => session.conversation !== next && session.conversation !== leaving,
        ),
      ];
      state.conversation = next;
      state.started = started;
    }, context);
  }

  // A conversation's label; one that ran before labels were kept counts as having run with the
  // address's access.
  async #label(address: string, conversation: number, context: Context): Promise<Label> {
    const stored = await this.harness.snapshot(LabelDoc, conversation as ConversationId, context);
    if (stored) return stored;
    const [, access] = this.#access(address, (await this.#overrides(address, context)).access);
    return {
      tools: [...access.tools],
      mcpServers: [...access.mcpServers],
      maxTurns: access.maxTurns,
    };
  }

  async #preview(conversation: number, context: Context): Promise<string> {
    const found = await this.harness.conversation(conversation as ConversationId, context);
    const page = await found?.entries({ order: "ascending" }, 20, undefined, context);
    for (const entry of page?.items ?? [])
      for (const message of entry.model ?? []) {
        if (message.role !== "user") continue;
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join(" ");
        return text.replace(/\s+/g, " ").trim().slice(0, 80);
      }
    return "";
  }

  async answer(submission: SubmissionId, context: Context): Promise<Answer> {
    const handle = await this.harness.submission(submission, context);
    if (!handle) return { status: "unanswered", reason: "unknown submission" };
    const settled = await handle.wait(context);
    if (settled.type !== "input") return { status: "unanswered", reason: "not an input" };
    if (settled.status !== "done") {
      const detail = settled.detail === undefined ? "" : ` ${JSON.stringify(settled.detail)}`;
      return { status: "unanswered", reason: `${settled.reason}${detail}` };
    }
    const conversation = await this.harness.conversation(settled.conversationId, context);
    const page = await conversation?.entries(
      { minEntryId: settled.answer, maxEntryId: settled.answer },
      1,
      undefined,
      context,
    );
    const entry = page?.items.find((found) => AssistantEntry.is(found));
    const text = (entry?.model ?? [])
      .flatMap((message) => (message.role === "assistant" ? message.content : []))
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
    return { status: "done", text, entry: settled.answer };
  }

  async ask(address: string, content: string, context: Context): Promise<Answer> {
    return this.answer(await this.submit(address, { content }, context), context);
  }

  async close(context: Context): Promise<void> {
    await Promise.allSettled(this.#titling);
    await this.harness.close(context);
  }
}

// A change `configure` refuses, with a message for the user.
export class Refused extends Error {}
