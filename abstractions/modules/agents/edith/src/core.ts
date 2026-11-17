// EDITH's core: one Harness whose conversations clients reach by address. An address is
// `<namespace>:<name>`, such as `discord:<channel id>` or `cli`. Its namespace picks a profile:
// the model and thinking level the conversation follows unless it overrides them, and the MCP
// servers and turn limit, which only the configuration sets. A namespace without a profile of
// its own gets `restricted`.
import type { Context } from "@earendil-works/chord/context";
import type { ModelThinkingLevel, Models } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  AssistantEntry,
  createRegistry,
  defineDoc,
  defineDocFamily,
  Harness,
  type Conversation,
  type ConversationId,
  type Extension,
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

export type Profile = {
  readonly model: ModelRef;
  readonly thinkingLevel: ModelThinkingLevel;
  // MCP servers whose tools the conversation's code mode scripts may call.
  readonly tools: readonly string[];
  readonly maxTurns: number | null;
};

export const fallbackProfile = "restricted";

// A null field follows the profile; `configure` sets or clears an override.
export type Overrides = {
  model: ModelRef | null;
  thinkingLevel: ModelThinkingLevel | null;
};

export type Status = {
  readonly address: string;
  readonly profile: string;
  readonly model: ModelRef;
  readonly thinkingLevel: ModelThinkingLevel;
  readonly tools: readonly string[];
  readonly overrides: Readonly<Overrides>;
};

export type Answer =
  | { readonly status: "done"; readonly text: string }
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
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ model: null, thinkingLevel: null }),
  checkpointWhen: () => true,
});

export function namespaceOf(address: string): string {
  const index = address.indexOf(":");
  return index < 0 ? address : address.slice(0, index);
}

type Equipment = {
  readonly extensions: readonly Extension[];
  readonly modelTools: readonly ToolRegistration[] | null;
};

export class Edith {
  readonly harness: Harness;
  readonly #options: Options;
  // Serializes creation per address, so concurrent first messages share one conversation.
  readonly #opening = new Map<string, Promise<Conversation>>();

  private constructor(harness: Harness, options: Options) {
    this.harness = harness;
    this.#options = options;
  }

  static async open(storage: Storage, options: Options, context: Context): Promise<Edith> {
    const registry = createRegistry();
    for (const extension of [options.codemode ?? [], options.servers ?? []].flat())
      registry.install(extension);
    const harness = await Harness.open(
      storage,
      { models: options.models, registry, ...(options.onReport && { onReport: options.onReport }) },
      context,
    );
    harness.resume();
    return new Edith(harness, options);
  }

  profileName(address: string): string {
    const name = this.#options.namespaces[namespaceOf(address)];
    return name !== undefined && name in this.#options.profiles ? name : fallbackProfile;
  }

  profile(address: string): Profile {
    return this.#options.profiles[this.profileName(address)] ?? this.#options.profiles.restricted;
  }

  // What a profile's conversations run with: nothing callable without servers, otherwise code
  // mode as the model's only tool and the servers' tools behind it. A server that did not
  // start is left out.
  #equipment(profile: Profile): Equipment {
    const codemode = this.#options.codemode;
    const servers = profile.tools.flatMap((server) =>
      (this.#options.servers ?? []).filter(
        (extension) => extension.name === serverExtensionName(server),
      ),
    );
    const tool = codemode?.tools?.find((candidate) => candidate.name === CODEMODE_TOOL_NAME);
    if (!codemode || !tool || servers.length === 0) return { extensions: [], modelTools: null };
    return { extensions: [codemode, ...servers], modelTools: [tool] };
  }

  conversation(address: string, context: Context): Promise<Conversation> {
    const pending = this.#opening.get(address);
    if (pending) return pending;
    const opening = this.#open(address, context).finally(() => this.#opening.delete(address));
    this.#opening.set(address, opening);
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
    const overrides = (await this.harness.snapshot(OverridesDoc, conversation.id, context)) ?? {
      model: null,
      thinkingLevel: null,
    };
    const profile = this.profile(address);
    return {
      address,
      profile: this.profileName(address),
      model: overrides.model ?? profile.model,
      thinkingLevel: overrides.thinkingLevel ?? profile.thinkingLevel,
      tools: profile.tools,
      overrides: { ...overrides },
    };
  }

  async configure(address: string, change: Partial<Overrides>, context: Context): Promise<Status> {
    const conversation = await this.conversation(address, context);
    await conversation.commit(async (tx) => {
      const overrides = await tx.doc(OverridesDoc, conversation.id);
      if (change.model !== undefined) overrides.model = change.model;
      if (change.thinkingLevel !== undefined) overrides.thinkingLevel = change.thinkingLevel;
    }, context);
    return this.status(address, context);
  }

  // The profile can change between runs of the daemon, so the agent is brought to the
  // effective choices before each input rather than when they are set.
  async #align(address: string, conversation: Conversation, context: Context): Promise<void> {
    const wanted = await this.status(address, context);
    const { maxTurns } = this.profile(address);
    const equipment = this.#equipment(this.profile(address));
    const names = (items: readonly { name: string }[] | null) =>
      items && JSON.stringify(items.map((item) => item.name));
    const stored = await this.harness.snapshot(AgentDoc, conversation.id, context);
    const same =
      stored?.model?.provider === wanted.model.provider &&
      stored.model.modelId === wanted.model.modelId &&
      stored.thinkingLevel === wanted.thinkingLevel &&
      JSON.stringify(stored.extensions) === names(equipment.extensions) &&
      (stored.modelTools === undefined ? null : JSON.stringify(stored.modelTools)) ===
        names(equipment.modelTools) &&
      (stored.maxTurns ?? null) === maxTurns;
    if (same) return;
    await conversation.configure(
      {
        model: wanted.model,
        thinkingLevel: wanted.thinkingLevel,
        extensions: equipment.extensions,
        modelTools: equipment.modelTools,
        maxTurns,
      },
      context,
    );
  }

  // Admits an input; `alsoInCommit` writes a client's own state in the same commit.
  async submit(
    address: string,
    draft: Omit<InputSubmissionDraft, "type">,
    context: Context,
    alsoInCommit?: (tx: Tx, submission: SubmissionId) => Promise<void>,
  ): Promise<SubmissionId> {
    const conversation = await this.conversation(address, context);
    await this.#align(address, conversation, context);
    return this.harness.commit(async (tx) => {
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
    const entry = await conversation?.commit(
      (tx) => tx.entry(AssistantEntry, settled.answer),
      context,
    );
    const text = (entry?.model ?? [])
      .flatMap((message) => (message.role === "assistant" ? message.content : []))
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
    return { status: "done", text };
  }

  async ask(address: string, content: string, context: Context): Promise<Answer> {
    return this.answer(await this.submit(address, { content }, context), context);
  }

  close(context: Context): Promise<void> {
    return this.harness.close(context);
  }
}
