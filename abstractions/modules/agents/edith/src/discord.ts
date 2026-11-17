// The Discord client: each channel is the conversation `discord:<channel id>`, answering the
// allowed users only, who set a channel's model and thinking level with slash commands.
// Replies are delivered at least once across restarts: the input and its pending reply are
// admitted in one commit, and the reply is forgotten once it is posted. Discord deduplicates a
// repeated post by its nonce for a few minutes.
//
// Unless a channel turns it off with /trace, a run's thinking, its text beside tool calls, and
// its code mode calls are posted as they are committed, as silent messages before the answer,
// which alone notifies. A code mode call's message lists the script's calls while it runs and
// is edited once its result is committed. Thinking and scripts are collapsed behind a button.
import type { Context } from "@earendil-works/chord/context";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonStyle,
  Client,
  ComponentType,
  GatewayDispatchEvents,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
  type API,
  type APIContainerComponent,
  type APIInteraction,
  type APIMessage,
  type RESTPutAPIApplicationGuildCommandsJSONBody,
} from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import type { WatchHandle } from "@earendil-works/chord/watch";
import {
  defineDoc,
  type Conversation,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import { describe, followDefault, levels, parseModel, parseThinking, split } from "./commands.ts";
import type { Edith } from "./core.ts";
import {
  itemAt,
  itemsOf,
  liveCalls,
  renderThinking,
  renderTool,
  resultOf,
  type Call,
  type Item,
} from "./trace.ts";

export type DiscordOptions = {
  readonly token: string;
  readonly allowedUsers: readonly string[];
};

const messageLimit = 2000;
// Text a collapsible message shows, below Discord's limit for a message's text displays.
const cardLimit = 3800;
// How long an answer waits for the trace before it to be posted.
const traceWait = 30_000;
// Channel history fetched per channel when the gateway connects again.
const catchUpLimit = 100;

type Pending = { channel: string; submission: number };
// A code mode call's message, edited until its result is committed.
type ToolPost = {
  message: string;
  conversation: number;
  entry: number;
  part: number;
  expanded?: boolean;
};
// A channel's trace: the newest entry handled, whether it is off, and the calls still running.
type Trace = { after: number; off?: boolean; tools: Record<string, ToolPost> };
const State = defineDoc<{
  pending: Record<string, Pending>;
  lastSeen: Record<string, string>;
  trace?: Record<string, Trace>;
}>({
  kind: "edith.discord",
  version: 1,
  scope: "session",
  initial: () => ({ pending: {}, lastSeen: {}, trace: {} }),
  checkpointWhen: () => true,
});

// A button's custom ID: the item and the state a press brings its message to.
const toggleId = (conversation: number, entry: number, part: number, expand: boolean) =>
  `x:${conversation}:${entry}:${part}:${expand ? 1 : 0}`;

function card(text: string, toggle?: { id: string; expanded: boolean }): APIContainerComponent[] {
  return [
    {
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: text },
        ...(toggle
          ? [
              {
                type: ComponentType.ActionRow as const,
                components: [
                  {
                    type: ComponentType.Button as const,
                    style: ButtonStyle.Secondary as const,
                    label: toggle.expanded ? "Collapse" : "Expand",
                    custom_id: toggle.id,
                  },
                ],
              },
            ]
          : []),
      ],
    },
  ];
}

const toolState = (result: { isError: boolean } | undefined) =>
  result === undefined ? "running" : result.isError ? "error" : "ok";

// Registered in every guild the bot is in, where they are available at once.
const commands: RESTPutAPIApplicationGuildCommandsJSONBody = [
  {
    type: ApplicationCommandType.ChatInput,
    name: "status",
    description: "Show this channel's model and thinking level",
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "model",
    description: "Set this channel's model",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "model",
        description: `<provider>/<model id>, or ${followDefault} to follow the profile`,
        required: true,
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "trace",
    description: "Show or hide this channel's thinking and tool calls",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "state",
        description: "on or off",
        required: true,
        choices: ["on", "off"].map((value) => ({ name: value, value })),
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "thinking",
    description: "Set this channel's thinking level",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "level",
        description: `A thinking level, or ${followDefault} to follow the profile`,
        required: true,
        choices: [...levels, followDefault].map((value) => ({ name: value, value })),
      },
    ],
  },
];

const later = (a: string, b: string | undefined) =>
  b === undefined || BigInt(a) > BigInt(b) ? a : b;

export class Discord {
  readonly #edith: Edith;
  readonly #options: DiscordOptions;
  readonly #context: Context;
  readonly #gateway: WebSocketManager;
  readonly #client: Client;
  // Replies being delivered by this process, by Discord message id.
  readonly #delivering = new Set<string>();
  // Channels whose trace is being followed, and its handling of watch values, serialized.
  readonly #traces = new Map<string, Promise<void>>();
  readonly #watches: WatchHandle<unknown>[] = [];
  // The last text each traced message was given, so unchanged renderings are not sent again.
  readonly #rendered = new Map<string, string>();
  // The calls each running code mode call's script made, as last seen live.
  readonly #live = new Map<string, Call[]>();
  #application: string | undefined;

  constructor(edith: Edith, options: DiscordOptions, context: Context) {
    this.#edith = edith;
    this.#options = options;
    this.#context = context;
    const rest = new REST({ version: "10" }).setToken(options.token);
    this.#gateway = new WebSocketManager({
      token: options.token,
      intents:
        GatewayIntentBits.Guilds |
        GatewayIntentBits.GuildMessages |
        GatewayIntentBits.DirectMessages |
        GatewayIntentBits.MessageContent,
      rest,
    });
    this.#client = new Client({ rest, gateway: this.#gateway });
    this.#client.on(GatewayDispatchEvents.MessageCreate, ({ data, api }) =>
      this.#spawn(this.#receive(api, data)),
    );
    this.#client.on(GatewayDispatchEvents.InteractionCreate, ({ data, api }) =>
      this.#spawn(this.#interact(api, data)),
    );
    // Ready follows every new session; events missed while disconnected are not replayed.
    this.#client.on(GatewayDispatchEvents.Ready, ({ data, api }) => {
      console.error(`discord: connected as ${data.user.username}`);
      this.#application = data.application.id;
      this.#spawn(this.#recover(api));
    });
    // Each guild arrives after Ready, and again when the bot joins one. Overwriting the
    // whole set leaves exactly these commands, whatever an earlier version registered.
    this.#client.on(GatewayDispatchEvents.GuildCreate, ({ data, api }) => {
      if (this.#application === undefined) return;
      this.#spawn(
        api.applicationCommands
          .bulkOverwriteGuildCommands(this.#application, data.id, commands)
          .then(() => undefined),
      );
    });
  }

  connect(): Promise<void> {
    return this.#gateway.connect();
  }

  async destroy(): Promise<void> {
    await Promise.allSettled(this.#watches.map((watch) => watch.stop()));
    await this.#gateway.destroy();
  }

  #spawn(work: Promise<void>): void {
    work.catch((error: unknown) => console.error("discord:", error));
  }

  async #recover(api: API): Promise<void> {
    const state = await this.#edith.harness.snapshot(State, this.#context);
    for (const channel of Object.keys(state?.trace ?? {})) this.#spawn(this.#follow(api, channel));
    for (const id of Object.keys(state?.pending ?? {})) this.#spawn(this.#deliver(api, id));
    for (const [channel, after] of Object.entries(state?.lastSeen ?? {})) {
      const missed = await api.channels.getMessages(channel, { after, limit: catchUpLimit });
      missed.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const message of missed) await this.#receive(api, message);
    }
  }

  async #receive(api: API, message: APIMessage): Promise<void> {
    if (message.author.bot || !this.#options.allowedUsers.includes(message.author.id)) return;
    const channel = message.channel_id;
    const address = `discord:${channel}`;
    if (message.content.trim() === "") return;
    // Followed before the input is admitted, so that the trace sees everything it causes.
    await this.#follow(api, channel);
    await this.#edith.submit(
      address,
      {
        content: message.content,
        // A message seen again, live or while catching up, is admitted once.
        requestId: `discord:${message.id}`,
        entry: {
          kind: "discord.message",
          data: { messageId: message.id, author: message.author.username },
        },
      },
      this.#context,
      async (tx, submission) => {
        const state = await tx.doc(State);
        state.pending[message.id] = { channel, submission };
        state.lastSeen[channel] = later(message.id, state.lastSeen[channel]);
      },
    );
    await this.#deliver(api, message.id);
  }

  async #interact(api: API, interaction: APIInteraction): Promise<void> {
    if (interaction.type === InteractionType.MessageComponent)
      return this.#toggle(api, interaction);
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    const data = interaction.data;
    if (data.type !== ApplicationCommandType.ChatInput) return;
    const user = interaction.member?.user ?? interaction.user;
    const channel = interaction.channel?.id;
    const reply = (content: string, flags?: MessageFlags) =>
      api.interactions.reply(interaction.id, interaction.token, {
        content,
        allowed_mentions: { parse: [] },
        ...(flags !== undefined && { flags }),
      });
    if (!user || !this.#options.allowedUsers.includes(user.id) || !channel) {
      await reply("Not available here.", MessageFlags.Ephemeral);
      return;
    }
    const address = `discord:${channel}`;
    const option = (name: string) => {
      const found = data.options?.find((candidate) => candidate.name === name);
      return found?.type === ApplicationCommandOptionType.String ? found.value : "";
    };
    switch (data.name) {
      case "status":
        await reply(describe(await this.#edith.status(address, this.#context)));
        return;
      case "model": {
        const parsed = parseModel(option("model"));
        await reply(
          "error" in parsed
            ? parsed.error
            : describe(
                await this.#edith.configure(address, { model: parsed.value }, this.#context),
              ),
        );
        return;
      }
      case "trace": {
        const off = option("state") === "off";
        await this.#follow(api, channel);
        await this.#edith.harness.commit(async (tx) => {
          const trace = (await tx.doc(State)).trace?.[channel];
          if (!trace) return;
          if (off) trace.off = true;
          else delete trace.off;
        }, this.#context);
        await reply(`trace: ${off ? "off" : "on"}`);
        return;
      }
      case "thinking": {
        const parsed = parseThinking(option("level"));
        await reply(
          "error" in parsed
            ? parsed.error
            : describe(
                await this.#edith.configure(
                  address,
                  { thinkingLevel: parsed.value },
                  this.#context,
                ),
              ),
        );
        return;
      }
      default:
        await reply(`Unknown command /${data.name}.`, MessageFlags.Ephemeral);
    }
  }

  async #deliver(api: API, id: string): Promise<void> {
    if (this.#delivering.has(id)) return;
    this.#delivering.add(id);
    try {
      const pending = (await this.#edith.harness.snapshot(State, this.#context))?.pending[id];
      if (!pending) return;
      const typing = setInterval(
        () => void api.channels.showTyping(pending.channel).catch(() => {}),
        8000,
      );
      void api.channels.showTyping(pending.channel).catch(() => {});
      let answer;
      try {
        answer = await this.#edith.answer(pending.submission as SubmissionId, this.#context);
      } finally {
        clearInterval(typing);
      }
      if (answer.status === "done") await this.#tracedTo(api, pending.channel, answer.entry);
      const text =
        answer.status === "done"
          ? answer.text || "(empty answer)"
          : `⚠️ unanswered: ${answer.reason}`;
      await this.#post(api, pending.channel, id, text);
      await this.#edith.harness.commit(async (tx) => {
        delete (await tx.doc(State)).pending[id];
      }, this.#context);
    } finally {
      this.#delivering.delete(id);
    }
  }

  async #post(api: API, channel: string, replyTo: string, text: string): Promise<void> {
    const chunks = split(text, messageLimit);
    for (const [index, content] of chunks.entries()) {
      await api.channels.createMessage(channel, {
        content,
        // At most 25 characters: a snowflake has at most 20 digits.
        nonce: `${replyTo}-${index}`,
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
        ...(index === 0 && {
          message_reference: { message_id: replyTo, fail_if_not_exists: false },
        }),
      });
    }
  }

  // Starts following a channel's trace once per process. A channel traced for the first time
  // starts after its newest entry, so earlier history is not posted.
  #follow(api: API, channel: string): Promise<void> {
    const started = this.#traces.get(channel);
    if (started) return started;
    const starting = (async () => {
      const conversation = await this.#edith.conversation(`discord:${channel}`, this.#context);
      let after = (await this.#edith.harness.snapshot(State, this.#context))?.trace?.[channel]
        ?.after;
      if (after === undefined) {
        const newest = await conversation.entries({}, 1, undefined, this.#context);
        const start = newest.items[0]?.id ?? 0;
        await this.#edith.harness.commit(async (tx) => {
          const state = await tx.doc(State);
          // Assigned, then read back, so the channel is added through the draft rather than to
          // the plain object assigned.
          state.trace ??= {};
          state.trace[channel] ??= { after: start, tools: {} };
        }, this.#context);
        after = start;
      }
      const watch = await conversation.watch(this.#context, { from: (after + 1) as EntryId });
      this.#watches.push(watch as WatchHandle<unknown>);
      let chain = this.#handle(api, channel, conversation, watch.value);
      watch.start(async (call) => {
        if (call.kind !== "value") return;
        const view = call.value;
        chain = chain.then(() => this.#handle(api, channel, conversation, view));
        await chain;
      });
      await chain;
    })();
    starting.catch(() => this.#traces.delete(channel));
    this.#traces.set(channel, starting);
    return starting;
  }

  async #handle(
    api: API,
    channel: string,
    conversation: Conversation,
    view: {
      readonly entries: readonly EntryRecord[];
      readonly docs: Readonly<Record<string, unknown>>;
    },
  ): Promise<void> {
    try {
      await this.#handleEntries(api, channel, conversation, view.entries);
      await this.#handleLive(
        api,
        channel,
        view.docs["pi.live"] as Record<string, unknown> | undefined,
      );
    } catch (error) {
      console.error("discord trace:", error);
    }
  }

  async #trace(channel: string): Promise<Trace | undefined> {
    return (await this.#edith.harness.snapshot(State, this.#context))?.trace?.[channel];
  }

  async #handleEntries(
    api: API,
    channel: string,
    conversation: Conversation,
    entries: readonly EntryRecord[],
  ): Promise<void> {
    for (const entry of entries) {
      const trace = await this.#trace(channel);
      if (!trace || entry.id <= trace.after) continue;
      const posted: Record<string, ToolPost> = {};
      if (!trace.off)
        for (const item of itemsOf(entry)) {
          const message = await this.#postItem(api, channel, conversation.id, entry.id, item);
          if (item.kind === "tool" && message)
            posted[item.callId] = {
              message,
              conversation: conversation.id,
              entry: entry.id,
              part: item.part,
            };
        }
      const result = resultOf(entry);
      const post = result && (trace.tools[result.callId] ?? posted[result.callId]);
      if (result && post) {
        const item = await this.#itemOf(post);
        if (item?.kind === "tool")
          await this.#edit(
            api,
            channel,
            post.message,
            renderTool(item, toolState(result), result.calls, post.expanded ?? false, cardLimit),
            item.code === undefined
              ? undefined
              : {
                  id: toggleId(post.conversation, post.entry, post.part, !post.expanded),
                  expanded: post.expanded ?? false,
                },
          );
        this.#live.delete(result.callId);
      }
      await this.#edith.harness.commit(async (tx) => {
        const current = (await tx.doc(State)).trace?.[channel];
        if (!current) return;
        current.after = entry.id;
        Object.assign(current.tools, posted);
        if (result) delete current.tools[result.callId];
      }, this.#context);
    }
  }

  async #handleLive(
    api: API,
    channel: string,
    live: Record<string, unknown> | undefined,
  ): Promise<void> {
    const trace = await this.#trace(channel);
    for (const [callId, post] of Object.entries(trace?.tools ?? {})) {
      const calls = liveCalls(live as never, callId);
      if (calls.length === 0) continue;
      this.#live.set(callId, calls);
      const item = await this.#itemOf(post);
      if (item?.kind !== "tool") continue;
      await this.#edit(
        api,
        channel,
        post.message,
        renderTool(item, "running", calls, post.expanded ?? false, cardLimit),
        item.code === undefined
          ? undefined
          : {
              id: toggleId(post.conversation, post.entry, post.part, !post.expanded),
              expanded: post.expanded ?? false,
            },
      );
    }
  }

  async #entry(conversationId: number, entryId: number): Promise<EntryRecord | undefined> {
    const conversation = await this.#edith.harness.conversation(
      conversationId as ConversationId,
      this.#context,
    );
    const page = await conversation?.entries(
      { minEntryId: entryId as EntryId, maxEntryId: entryId as EntryId },
      1,
      undefined,
      this.#context,
    );
    return page?.items[0];
  }

  async #itemOf(post: {
    conversation: number;
    entry: number;
    part: number;
  }): Promise<Item | undefined> {
    const entry = await this.#entry(post.conversation, post.entry);
    return entry && itemAt(entry, post.part);
  }

  // Posts an item silently and returns its message's ID.
  async #postItem(
    api: API,
    channel: string,
    conversation: number,
    entry: number,
    item: Item,
  ): Promise<string | undefined> {
    const flags = MessageFlags.SuppressNotifications;
    if (item.kind === "commentary") {
      let last: string | undefined;
      for (const [index, content] of split(item.text, messageLimit).entries())
        last = (
          await api.channels.createMessage(channel, {
            content,
            nonce: `c${entry}-${item.part}-${index}`,
            enforce_nonce: true,
            allowed_mentions: { parse: [] },
            flags,
          })
        ).id;
      return last;
    }
    const text =
      item.kind === "thinking"
        ? renderThinking(item.text, false, cardLimit)
        : renderTool(item, "running", [], false, cardLimit);
    const expandable = item.kind === "thinking" || item.code !== undefined;
    const message = await api.channels.createMessage(channel, {
      components: card(
        text,
        expandable
          ? { id: toggleId(conversation, entry, item.part, true), expanded: false }
          : undefined,
      ),
      nonce: `${item.kind === "thinking" ? "t" : "u"}${entry}-${item.part}`,
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
      flags: flags | MessageFlags.IsComponentsV2,
    });
    this.#rendered.set(message.id, text);
    return message.id;
  }

  async #edit(
    api: API,
    channel: string,
    message: string,
    text: string,
    toggle: { id: string; expanded: boolean } | undefined,
  ): Promise<void> {
    if (this.#rendered.get(message) === text) return;
    await api.channels.editMessage(channel, message, { components: card(text, toggle) });
    this.#rendered.set(message, text);
  }

  // Waits until the trace has handled `entry`, so the answer follows what led to it; gives up
  // after a while rather than holding the answer back.
  async #tracedTo(api: API, channel: string, entry: number): Promise<void> {
    await this.#follow(api, channel).catch(() => {});
    const deadline = Date.now() + traceWait;
    while (Date.now() < deadline) {
      const trace = await this.#trace(channel);
      if (!trace || trace.after >= entry) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Expands or collapses a traced message, rebuilt from the conversation's entries.
  async #toggle(api: API, interaction: APIInteraction): Promise<void> {
    if (interaction.type !== InteractionType.MessageComponent) return;
    const user = interaction.member?.user ?? interaction.user;
    const deny = () =>
      api.interactions.reply(interaction.id, interaction.token, {
        content: "Not available here.",
        flags: MessageFlags.Ephemeral,
      });
    if (!user || !this.#options.allowedUsers.includes(user.id)) {
      await deny();
      return;
    }
    const match = /^x:(\d+):(\d+):(\d+):([01])$/.exec(interaction.data.custom_id);
    if (!match) {
      await deny();
      return;
    }
    const [conversation, entryId, part] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const expanded = match[4] === "1";
    const toggle = { id: toggleId(conversation, entryId, part, !expanded), expanded };
    const item = await this.#itemOf({ conversation, entry: entryId, part });
    if (!item || item.kind === "commentary") {
      await deny();
      return;
    }
    let text: string;
    if (item.kind === "thinking") text = renderThinking(item.text, expanded, cardLimit);
    else {
      const later = await (
        await this.#edith.harness.conversation(conversation as ConversationId, this.#context)
      )?.entries(
        { minEntryId: (entryId + 1) as EntryId, order: "ascending" },
        100,
        undefined,
        this.#context,
      );
      const result = later?.items.map(resultOf).find((found) => found?.callId === item.callId);
      text = renderTool(
        item,
        toolState(result),
        result?.calls ?? this.#live.get(item.callId) ?? [],
        expanded,
        cardLimit,
      );
      if (!result && interaction.channel?.id) {
        const channel = interaction.channel.id;
        await this.#edith.harness.commit(async (tx) => {
          const post = (await tx.doc(State)).trace?.[channel]?.tools[item.callId];
          if (post) post.expanded = expanded;
        }, this.#context);
      }
    }
    await api.interactions.updateMessage(interaction.id, interaction.token, {
      components: card(text, toggle),
    });
    this.#rendered.set(interaction.message.id, text);
  }
}
