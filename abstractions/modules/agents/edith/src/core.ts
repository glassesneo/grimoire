// EDITH's core: one Harness whose conversations clients reach by address. An address is
// `<namespace>:<name>`, such as `discord:<channel id>` or `cli`. A conversation runs with a
// profile: the model and thinking level it follows unless it overrides them, and the tools, MCP
// servers and turn limit, which only the configuration sets. The profile is the one a client chose
// for the conversation among the configured ones, or else its namespace's, or else `restricted`.
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

export type Profile = {
  readonly model: ModelRef;
  readonly thinkingLevel: ModelThinkingLevel;
  // Tools of `Options.tools`, by name, and MCP servers whose tools the conversation's code mode
  // scripts may call.
  readonly tools: readonly ToolName[];
  readonly mcpServers: readonly string[];
  readonly maxTurns: number | null;
};

const fallbackProfile = "restricted";

// A null field follows the default: the namespace's profile, or the profile's model and thinking
// level; `configure` sets or clears an override.
export type Overrides = {
  profile: string | null;
  model: ModelRef | null;
  thinkingLevel: ModelThinkingLevel | null;
};

const noOverrides: Overrides = { profile: null, model: null, thinkingLevel: null };

export type Status = {
  readonly address: string;
  readonly profile: string;
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
  readonly profiles: Readonly<Record<string, Profile>> & { readonly restricted: Profile };
  // Profile names by namespace.
  readonly namespaces: Readonly<Record<string, string>>;
  // The code mode extension, through which alone the model reaches tools.
  readonly codemode?: Extension;
  // Extensions of the MCP servers that started, from `connectServer`.
  readonly servers?: readonly Extension[];
  // The extension of the tools profiles select by name, and the environment they run in.
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
  // Version 2 adds `profile`.
  version: 2,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ ...noOverrides }),
  migrate: (value) => ({ ...noOverrides, ...(value as Partial<Overrides>) }),
  checkpointWhen: () => true,
});

export function namespaceOf(address: string): string {
  const index = address.indexOf(":");
  return index < 0 ? address : address.slice(0, index);
}

type Equipment = {
  readonly extensions: readonly Extension[];
  // The selected extensions' tools a profile leaves out.
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

  // The configured profiles' names.
  profiles(): string[] {
    return Object.keys(this.#options.profiles);
  }

  // The profile a conversation runs with, by name: its chosen one while the configuration still
  // has it, else its namespace's, else `restricted`.
  #profile(address: string, chosen: string | null): [string, Profile] {
    for (const name of [chosen, this.#options.namespaces[namespaceOf(address)]]) {
      const profile = name == null ? undefined : this.#options.profiles[name];
      if (name != null && profile) return [name, profile];
    }
    return [fallbackProfile, this.#options.profiles.restricted];
  }

  async #overrides(conversation: Conversation, context: Context): Promise<Overrides> {
    return {
      ...noOverrides,
      ...(await this.harness.snapshot(OverridesDoc, conversation.id, context)),
    };
  }

  // What a profile's conversations run with: nothing callable without tools or servers,
  // otherwise code mode as the model's only tool and the selected tools and the servers' tools
  // behind it. A server that did not start is left out.
  #equipment(profile: Profile): Equipment {
    const codemode = this.#options.codemode;
    const tool = codemode?.tools?.find((candidate) => candidate.name === CODEMODE_TOOL_NAME);
    const servers = profile.mcpServers.flatMap(
      (server) => this.#servers.get(serverExtensionName(server)) ?? [],
    );
    const own = this.#options.tools;
    const selected = (own?.tools ?? []).filter((candidate) =>
      (profile.tools as readonly string[]).includes(candidate.name),
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
    const [name, profile] = this.#profile(address, overrides.profile);
    return {
      address,
      profile: name,
      model: overrides.model ?? profile.model,
      thinkingLevel: overrides.thinkingLevel ?? profile.thinkingLevel,
      tools: profile.tools,
      mcpServers: profile.mcpServers,
      overrides: { ...overrides },
    };
  }

  // Sets or clears a conversation's overrides; a profile must be a configured one.
  async configure(address: string, change: Partial<Overrides>, context: Context): Promise<Status> {
    if (change.profile != null && !(change.profile in this.#options.profiles))
      throw new UnknownProfile(change.profile);
    const conversation = await this.conversation(address, context);
    await conversation.commit(async (tx) => {
      const overrides = await tx.doc(OverridesDoc, conversation.id);
      if (change.profile !== undefined) overrides.profile = change.profile;
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
    const profile = this.#options.profiles[wanted.profile] ?? this.#options.profiles.restricted;
    const equipment = this.#equipment(profile);
    return this.harness.commit(async (tx) => {
      // The profile can change between runs of the daemon, so the agent is brought to the
      // effective choices with each input; writing an equal value changes nothing.
      await configure(tx, conversation.id, {
        model: wanted.model,
        thinkingLevel: wanted.thinkingLevel,
        extensions: equipment.extensions,
        tools: equipment.tools,
        modelTools: equipment.modelTools,
        maxTurns: profile.maxTurns,
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

export class UnknownProfile extends Error {
  constructor(name: string) {
    super(`no profile named ${name}`);
  }
}
