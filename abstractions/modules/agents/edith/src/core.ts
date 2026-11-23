// EDITH's core: one Harness whose conversations clients reach by address. An address is
// `<namespace>:<name>`, such as `discord:<channel id>` or `cli`. A conversation runs with an
// access and a persona. An access is what it may do: the tools, MCP servers and turn limit, which
// only the configuration defines. A persona is who answers: the model and thinking level the
// conversation follows unless it overrides them. Each is the one a client chose for the
// conversation, or else its namespace's; a chosen access must lie within the namespace's ceiling.
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

// Whether an access grants nothing beyond another: its tools and servers are among the other's,
// and its turn limit is no higher.
export function within(access: Access, ceiling: Access): boolean {
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

const Address = defineDocFamily<{ conversation: number | null }, null>({
  kind: "edith.address",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ conversation: null }),
  checkpointWhen: () => true,
});

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

const unequipped: Equipment = { extensions: [], tools: null, modelTools: null };

export class Edith {
  readonly harness: Harness;
  readonly #options: Options;
  readonly #servers: ReadonlyMap<string, Extension>;
  // Conversations by address, kept once open; sharing the opening promise also makes
  // concurrent first messages share one conversation.
  readonly #conversations = new Map<string, Promise<Conversation>>();

  private constructor(harness: Harness, options: Options) {
    this.harness = harness;
    this.#options = options;
    this.#servers = new Map((options.servers ?? []).map((server) => [server.name, server]));
  }

  static async open(storage: Storage, options: Options, context: Context): Promise<Edith> {
    const registry = createRegistry();
    for (const extension of [
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

  async #overrides(conversation: Conversation, context: Context): Promise<Overrides> {
    return {
      ...noOverrides,
      ...(await this.harness.snapshot(OverridesDoc, conversation.id, context)),
    };
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
      return { extensions: [codemode, ...servers], tools: null, modelTools: [tool] };
    return {
      extensions: [codemode, own, ...servers],
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
      (await tx.doc(Address, address, null)).conversation = created.id;
    }, context);
    return created;
  }

  async status(address: string, context: Context): Promise<Status> {
    const conversation = await this.conversation(address, context);
    const overrides = await this.#overrides(conversation, context);
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
    };
  }

  // Sets or clears a conversation's overrides; an access must be one its namespace may choose,
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
    const conversation = await this.conversation(address, context);
    await conversation.commit(async (tx) => {
      const overrides = await tx.doc(OverridesDoc, conversation.id);
      if (change.access !== undefined) overrides.access = change.access;
      if (change.persona !== undefined) overrides.persona = change.persona;
      if (change.model !== undefined) overrides.model = change.model;
      if (change.thinkingLevel !== undefined) overrides.thinkingLevel = change.thinkingLevel;
    }, context);
    return this.status(address, context);
  }

  // Admits an input; `alsoInCommit` writes a client's own state in the same commit.
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
    return this.harness.commit(async (tx) => {
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
      const id = await conversation.submit(tx, { ...draft, type: "input" } as InputSubmissionDraft);
      await alsoInCommit?.(tx, id);
      return id;
    }, context);
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

  close(context: Context): Promise<void> {
    return this.harness.close(context);
  }
}

// A change `configure` refuses, with a message for the user.
export class Refused extends Error {}
