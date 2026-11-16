// EDITH's core: one Harness whose conversations clients reach by address. An address is
// `<namespace>:<name>`, such as `discord:<channel id>` or `cli`, and its namespace picks the
// profile whose model and thinking level the conversation follows unless it overrides them.
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
  type Tx,
} from "@earendil-works/pi-durable";

export type Profile = {
  readonly model?: ModelRef;
  readonly thinkingLevel?: ModelThinkingLevel;
};

// A null field follows the profile; `configure` sets or clears an override.
export type Overrides = {
  model: ModelRef | null;
  thinkingLevel: ModelThinkingLevel | null;
};

export type Status = {
  readonly address: string;
  readonly model?: ModelRef;
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly overrides: Readonly<Overrides>;
};

export type Answer =
  | { readonly status: "done"; readonly text: string }
  | { readonly status: "unanswered"; readonly reason: string };

export type Options = {
  readonly models: Models;
  // Profiles by namespace; `default` serves every namespace without its own.
  readonly profiles: Readonly<Record<string, Profile>> & { readonly default: Profile };
  readonly extensions?: readonly Extension[];
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

export class Edith {
  readonly harness: Harness;
  readonly #profiles: Options["profiles"];
  // Serializes creation per address, so concurrent first messages share one conversation.
  readonly #opening = new Map<string, Promise<Conversation>>();

  private constructor(harness: Harness, profiles: Options["profiles"]) {
    this.harness = harness;
    this.#profiles = profiles;
  }

  static async open(storage: Storage, options: Options, context: Context): Promise<Edith> {
    const registry = createRegistry();
    for (const extension of options.extensions ?? []) registry.install(extension);
    const harness = await Harness.open(
      storage,
      { models: options.models, registry, ...(options.onReport && { onReport: options.onReport }) },
      context,
    );
    harness.resume();
    return new Edith(harness, options.profiles);
  }

  profile(address: string): Profile {
    return this.#profiles[namespaceOf(address)] ?? this.#profiles.default;
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
    const model = overrides.model ?? profile.model;
    const thinkingLevel = overrides.thinkingLevel ?? profile.thinkingLevel;
    return {
      address,
      overrides: { ...overrides },
      ...(model && { model }),
      ...(thinkingLevel && { thinkingLevel }),
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
    const stored = await this.harness.snapshot(AgentDoc, conversation.id, context);
    const sameModel =
      stored?.model?.provider === wanted.model?.provider &&
      stored?.model?.modelId === wanted.model?.modelId;
    if (sameModel && stored?.thinkingLevel === wanted.thinkingLevel) return;
    await conversation.configure(
      { model: wanted.model ?? null, thinkingLevel: wanted.thinkingLevel ?? null },
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
