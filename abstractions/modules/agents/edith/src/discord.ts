// The Discord client: each channel is the conversation `discord:<channel id>`, answering the
// allowed users only, who set a channel's access, persona, model and thinking level with slash
// commands and create channels with their own. A channel's topic shows its access and persona.
// Replies are delivered at least once across restarts: the input and its pending reply are
// admitted in one commit, and the reply is forgotten once it is posted. Discord deduplicates a
// repeated post by its nonce for a few minutes.
//
// Unless a channel turns it off with /trace, a run is posted as it streams: thinking as a card
// edited while it grows, text in complete units (paragraphs, a heading with what follows it,
// whole lists, tables and code blocks; see `paragraphs.ts`) gathered for a few seconds into one
// message, and code mode calls once committed. All of it is silent but the answer's last unit,
// which is held until the answer is done and alone notifies. A code mode call's message lists the
// script's calls while it runs and is edited once its result is committed. Thinking and scripts
// are collapsed behind a button. With the trace off, the whole answer is posted once done.
//
// /pause holds a channel's conversation before its next step and /resume lets it go on; /stop ends
// what it is doing. /reset starts a new conversation in the channel and /sessions switches back to
// an earlier one; either posts a divider whose button switches back, and the trace follows the
// channel to its new conversation.
import type { Context } from "@earendil-works/chord/context";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonStyle,
  ChannelType,
  Client,
  ComponentType,
  GatewayDispatchEvents,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
  type API,
  type APIContainerComponent,
  type APIInteraction,
  type APIMessageComponentInteraction,
  type APIMessage,
  type RESTPutAPIApplicationGuildCommandsJSONBody,
} from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import type { WatchHandle } from "@earendil-works/chord/watch";
import {
  AssistantEntry,
  defineDoc,
  type Conversation,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type LiveState,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import {
  describe,
  describeSessions,
  followDefault,
  levels,
  parseModel,
  parseThinking,
  split,
} from "./commands.ts";
import { type Edith, Refused, type Status } from "./core.ts";
import { completePrefix } from "./paragraphs.ts";
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
// How long complete units gather after a post before the next one, and how often a thinking card
// is edited at most.
const gatherWait = 2_500;
const thinkingEditWait = 1_500;
// Channel history fetched per channel when the gateway connects again.
const catchUpLimit = 100;

// An input's reply, and whether a message already replies to its message.
type Pending = { channel: string; submission: number; replied?: boolean };
// A code mode call's message, edited until its result is committed.
type ToolPost = {
  message: string;
  conversation: number;
  entry: number;
  part: number;
  expanded?: boolean;
};
// The streaming generation's posts, by its key (its task and attempt): how much of its text and
// how many messages are posted, and its thinking card. Kept for an answer once committed, so the
// answer posts only the rest.
type Stream = {
  key: string;
  consumed: number;
  sent: number;
  thinking?: { part: number; message: string };
};
type Streamed = Pick<Stream, "consumed" | "sent">;
// A channel's trace: the newest entry handled, whether it is off, the calls still running, the
// generation streaming, the last one committed, and what answers already posted, by entry.
type Trace = {
  after: number;
  off?: boolean;
  tools: Record<string, ToolPost>;
  stream?: Stream;
  finished?: string;
  streamed?: Record<string, Streamed>;
};
type DiscordState = {
  pending: Record<string, Pending>;
  lastSeen: Record<string, string>;
  trace: Record<string, Trace>;
};
const State = defineDoc<DiscordState>({
  kind: "edith.discord",
  // Version 2 adds `trace`.
  version: 2,
  scope: "session",
  initial: () => ({ pending: {}, lastSeen: {}, trace: {} }),
  migrate: (value) => ({ trace: {}, ...(value as Partial<DiscordState>) }) as DiscordState,
  checkpointWhen: () => true,
});

type ToolItem = Extract<Item, { kind: "tool" }>;

// A content part of a message, as streamed or committed.
type StreamPart = { readonly type: string; readonly text?: string; readonly thinking?: string };

// The text of a message's text parts, as an answer joins them.
const textOf = (content: readonly StreamPart[]) =>
  content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("");

const entryContent = (entry: EntryRecord): readonly StreamPart[] =>
  (entry.model ?? []).flatMap((message) => (message.role === "assistant" ? message.content : []));
type Toggle = { id: string; expanded: boolean };

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

// The button of a tool message, which only a script makes expandable.
const toolToggle = (post: ToolPost, item: ToolItem): Toggle | undefined =>
  item.code === undefined
    ? undefined
    : {
        id: toggleId(post.conversation, post.entry, post.part, !post.expanded),
        expanded: post.expanded ?? false,
      };

// Registered in every guild the bot is in, where they are available at once. The choices are the
// accesses within Discord's ceiling and the configured personas, which a restart registers again.
const commandsFor = (
  accesses: readonly string[],
  personas: readonly string[],
): RESTPutAPIApplicationGuildCommandsJSONBody => [
  {
    type: ApplicationCommandType.ChatInput,
    name: "status",
    description: "Show this channel's access, persona, model and thinking level",
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "model",
    description: "Set this channel's model",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "model",
        description: `<provider>/<model id>, or ${followDefault} to follow the persona`,
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
        description: `A thinking level, or ${followDefault} to follow the persona`,
        required: true,
        choices: [...levels, followDefault].map((value) => ({ name: value, value })),
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "access",
    description: "Set what this channel's conversation may do",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "access",
        description: `An access, or ${followDefault} to follow the configuration`,
        required: true,
        choices: [...accesses, followDefault].map((value) => ({ name: value, value })),
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "persona",
    description: "Set who answers in this channel",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "persona",
        description: `A persona, or ${followDefault} to follow the configuration`,
        required: true,
        choices: [...personas, followDefault].map((value) => ({ name: value, value })),
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "new",
    description: "Create a channel beside this one, with its own access and persona",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "name",
        description: "The channel's name",
        required: true,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: "access",
        description: "An access; without one, the configuration's",
        choices: accesses.map((value) => ({ name: value, value })),
      },
      {
        type: ApplicationCommandOptionType.String,
        name: "persona",
        description: "A persona; without one, the configuration's",
        choices: personas.map((value) => ({ name: value, value })),
      },
    ],
  },
  simple("pause", "Hold this channel's conversation before its next step"),
  simple("resume", "Let this channel's paused conversation go on"),
  simple("stop", "Stop what this channel's conversation is doing and drop input not yet read"),
  simple("reset", "Start a new conversation in this channel; the current one is kept"),
  simple("sessions", "Switch this channel back to one of its earlier conversations"),
];

// A divider between a channel's conversations, whose button switches back to the one it left.
const divider = (text: string, back: number) => ({
  content: text,
  allowed_mentions: { parse: [] },
  components: [
    {
      type: ComponentType.ActionRow as const,
      components: [
        {
          type: ComponentType.Button as const,
          style: ButtonStyle.Secondary as const,
          label: "Switch back",
          custom_id: `v:${back}`,
        },
      ],
    },
  ],
});

// Commands that take no option.
const simple = (name: string, description: string) => ({
  type: ApplicationCommandType.ChatInput as const,
  name,
  description,
});

const topicOf = (status: Status) => `EDITH · access: ${status.access} · persona: ${status.persona}`;

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
  readonly #watches = new Map<string, WatchHandle<unknown>>();
  // The last text each traced message was given, so unchanged renderings are not sent again.
  readonly #rendered = new Map<string, string>();
  // Per running code mode call: its item, once read, and its script's calls as last seen live.
  readonly #items = new Map<string, ToolItem>();
  readonly #live = new Map<string, Call[]>();
  // Answers waiting for the trace to reach their entry, by channel.
  readonly #waiting = new Map<string, { entry: number; resolve: () => void }[]>();
  // Per channel: when streamed text was last posted, and the key of the generation last seen
  // streaming, which the next assistant entry finishes. Per thinking card: when it was edited.
  readonly #lastPost = new Map<string, number>();
  readonly #streaming = new Map<string, string>();
  readonly #thinkingEdited = new Map<string, number>();
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
          .bulkOverwriteGuildCommands(
            this.#application,
            data.id,
            commandsFor(this.#edith.accessChoices("discord"), this.#edith.personas()),
          )
          .then(() => undefined),
      );
    });
  }

  connect(): Promise<void> {
    return this.#gateway.connect();
  }

  async destroy(): Promise<void> {
    await Promise.allSettled([...this.#watches.values()].map((watch) => watch.stop()));
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
    try {
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
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      // Seen, so that catching up does not admit it later.
      await this.#edith.harness.commit(async (tx) => {
        const state = await tx.doc(State);
        state.lastSeen[channel] = later(message.id, state.lastSeen[channel]);
      }, this.#context);
      await this.#post(api, channel, `⚠️ not taken: ${error.message}`, {
        nonce: (index) => `p${message.id}-${index}`,
        replyTo: message.id,
      });
      return;
    }
    await this.#deliver(api, message.id);
  }

  async #interact(api: API, interaction: APIInteraction): Promise<void> {
    if (interaction.type === InteractionType.MessageComponent) {
      const id = interaction.data.custom_id;
      if (id.startsWith("x:")) return this.#toggle(api, interaction);
      return this.#switchFrom(api, interaction);
    }
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
          const trace = (await tx.doc(State)).trace[channel];
          if (!trace) return;
          if (off) trace.off = true;
          else delete trace.off;
        }, this.#context);
        await reply(`trace: ${off ? "off" : "on"}`);
        return;
      }
      case "access":
      case "persona": {
        const value = option(data.name);
        let status;
        try {
          status = await this.#edith.configure(
            address,
            { [data.name]: value === followDefault ? null : value },
            this.#context,
          );
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          await reply(error.message, MessageFlags.Ephemeral);
          return;
        }
        await reply(describe(status));
        await this.#showChoices(api, channel);
        return;
      }
      case "new": {
        const guild = interaction.guild_id;
        if (guild === undefined) {
          await reply("Channels are created in a server only.", MessageFlags.Ephemeral);
          return;
        }
        // Checked before the channel exists, so that a refused choice leaves no channel behind.
        const chosen = { access: option("access") || null, persona: option("persona") || null };
        if (
          (chosen.access !== null &&
            !this.#edith.accessChoices("discord").includes(chosen.access)) ||
          (chosen.persona !== null && !this.#edith.personas().includes(chosen.persona))
        ) {
          await reply("Not a choice this server offers.", MessageFlags.Ephemeral);
          return;
        }
        // Beside this channel: in its category, if it has one.
        const here = await api.channels.get(channel);
        const parent = "parent_id" in here ? here.parent_id : null;
        let created;
        try {
          created = await api.guilds.createChannel(guild, {
            name: option("name"),
            type: ChannelType.GuildText,
            ...(parent && { parent_id: parent }),
          });
        } catch (error) {
          await reply(
            `Could not create the channel: ${error instanceof Error ? error.message : String(error)}`,
            MessageFlags.Ephemeral,
          );
          return;
        }
        const status = await this.#edith.configure(`discord:${created.id}`, chosen, this.#context);
        await this.#showChoices(api, created.id);
        await reply(`<#${created.id}> runs with access ${status.access} as ${status.persona}.`);
        return;
      }
      case "pause":
        await reply(describe(await this.#edith.pause(address, this.#context)));
        return;
      case "resume":
        await reply(describe(await this.#edith.resume(address, this.#context)));
        return;
      case "stop":
        await api.interactions.defer(interaction.id, interaction.token);
        await api.interactions.editReply(interaction.application_id, interaction.token, {
          content: `⏹️ stopped\n${describe(await this.#edith.stop(address, this.#context))}`,
        });
        return;
      case "reset": {
        await api.interactions.defer(interaction.id, interaction.token);
        const { previous } = await this.#move(api, channel, () =>
          this.#edith.reset(address, this.#context),
        );
        await api.interactions.editReply(
          interaction.application_id,
          interaction.token,
          divider(
            "**── New session ──**\nThe previous one is kept; /sessions lists them.",
            previous,
          ),
        );
        return;
      }
      case "sessions": {
        const sessions = await this.#edith.sessions(address, this.#context);
        const earlier = sessions.slice(1, 26);
        await api.interactions.reply(interaction.id, interaction.token, {
          content: describeSessions(sessions).slice(0, messageLimit),
          flags: MessageFlags.Ephemeral,
          allowed_mentions: { parse: [] },
          ...(earlier.length > 0 && {
            components: [
              {
                type: ComponentType.ActionRow,
                components: [
                  {
                    type: ComponentType.StringSelect,
                    custom_id: "sessions",
                    placeholder: "Switch to…",
                    options: earlier.map((session, index) => ({
                      label:
                        `${index + 2}. ${session.allowed ? "" : "🔒 "}${session.preview || "(empty)"}`.slice(
                          0,
                          100,
                        ),
                      value: String(session.conversation),
                      ...(session.started !== null && {
                        description: new Date(session.started).toISOString().slice(0, 16),
                      }),
                    })),
                  },
                ],
              },
            ],
          }),
        });
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

  // Shows a channel's access and persona in its topic; Discord allows two topic changes in ten
  // minutes, so a change it refuses is left for /status to show.
  async #showChoices(api: API, channel: string): Promise<void> {
    const status = await this.#edith.status(`discord:${channel}`, this.#context);
    await api.channels
      .edit(channel, { topic: topicOf(status) })
      .catch((error: unknown) => console.error("discord topic:", error));
  }

  // Moves a channel to another conversation: once the trace has posted what the stopped one
  // committed, it follows the channel's new conversation.
  async #move(
    api: API,
    channel: string,
    move: () => Promise<{ previous: number; current: number }>,
  ): Promise<{ previous: number; current: number }> {
    const moved = await move();
    const left = await this.#conversationOf(moved.previous);
    const newest = (await left?.entries({}, 1, undefined, this.#context))?.items[0]?.id;
    if (newest !== undefined) await this.#tracedTo(api, channel, newest);
    await this.#watches.get(channel)?.stop();
    this.#watches.delete(channel);
    this.#traces.delete(channel);
    this.#streaming.delete(channel);
    await this.#edith.harness.commit(async (tx) => {
      const trace = (await tx.doc(State)).trace[channel];
      if (!trace) return;
      delete trace.stream;
      trace.tools = {};
    }, this.#context);
    await this.#follow(api, channel);
    return moved;
  }

  // Switches a channel to the conversation a divider's button or the sessions menu names.
  async #switchFrom(api: API, interaction: APIMessageComponentInteraction): Promise<void> {
    const user = interaction.member?.user ?? interaction.user;
    const channel = interaction.channel.id;
    const data = interaction.data;
    const value =
      data.component_type === ComponentType.StringSelect
        ? data.values[0]
        : /^v:(\d+)$/.exec(data.custom_id)?.[1];
    if (!user || !this.#options.allowedUsers.includes(user.id) || value === undefined) {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: "Not available here.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const address = `discord:${channel}`;
    const target = Number(value);
    const known = (await this.#edith.sessions(address, this.#context)).find(
      (session) => session.conversation === target,
    );
    if (!known || known.current || !known.allowed) {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: !known
          ? "Not a session of this channel."
          : known.current
            ? "Already the current session."
            : "That session ran with more than this channel may reach.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await api.interactions.defer(interaction.id, interaction.token);
    let moved;
    try {
      moved = await this.#move(api, channel, () =>
        this.#edith.switchTo(address, target, this.#context),
      );
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      await api.interactions.editReply(interaction.application_id, interaction.token, {
        content: error.message,
      });
      return;
    }
    const when = known.started === null ? "" : ` from <t:${Math.floor(known.started / 1000)}:f>`;
    await api.interactions.editReply(
      interaction.application_id,
      interaction.token,
      divider(
        `**── Switched to the session${when} ──**\n${known.preview || "(empty)"}`,
        moved.previous,
      ),
    );
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
      // What the trace already streamed of the answer is not posted again.
      const streamed =
        answer.status === "done"
          ? (await this.#trace(pending.channel))?.streamed?.[answer.entry]
          : undefined;
      const text =
        answer.status === "done"
          ? answer.text.slice(streamed?.consumed ?? 0).trim() || (streamed ? "" : "(empty answer)")
          : answer.reason.startsWith("aborted")
            ? "⏹️ stopped"
            : `⚠️ unanswered: ${answer.reason}`;
      const replied = (await this.#edith.harness.snapshot(State, this.#context))?.pending[id]
        ?.replied;
      if (text !== "")
        await this.#post(api, pending.channel, text, {
          nonce: (index) => `${id}-${index}`,
          ...(!replied && { replyTo: id }),
        });
      await this.#edith.harness.commit(async (tx) => {
        const state = await tx.doc(State);
        delete state.pending[id];
        if (answer.status === "done") delete state.trace[pending.channel]?.streamed?.[answer.entry];
      }, this.#context);
    } finally {
      this.#delivering.delete(id);
    }
  }

  // Posts text in chunks and returns the last message's ID. A nonce is at most 25 characters,
  // and a snowflake has at most 20 digits.
  async #post(
    api: API,
    channel: string,
    text: string,
    options: { nonce: (index: number) => string; replyTo?: string; flags?: MessageFlags },
  ): Promise<string | undefined> {
    let last: string | undefined;
    for (const [index, content] of split(text, messageLimit).entries())
      last = (
        await api.channels.createMessage(channel, {
          content,
          nonce: options.nonce(index),
          enforce_nonce: true,
          allowed_mentions: { parse: [] },
          ...(options.flags !== undefined && { flags: options.flags }),
          ...(index === 0 &&
            options.replyTo !== undefined && {
              message_reference: { message_id: options.replyTo, fail_if_not_exists: false },
            }),
        })
      ).id;
    return last;
  }

  // Starts following a channel's trace once per process. A channel traced for the first time
  // starts after its newest entry, so earlier history is not posted.
  #follow(api: API, channel: string): Promise<void> {
    const started = this.#traces.get(channel);
    if (started) return started;
    const starting = (async () => {
      const conversation = await this.#edith.conversation(`discord:${channel}`, this.#context);
      let after = (await this.#trace(channel))?.after;
      if (after === undefined) {
        const newest = await conversation.entries({}, 1, undefined, this.#context);
        const start = newest.items[0]?.id ?? 0;
        await this.#edith.harness.commit(async (tx) => {
          (await tx.doc(State)).trace[channel] ??= { after: start, tools: {} };
        }, this.#context);
        after = start;
      }
      const watch = await conversation.watch(this.#context, { from: (after + 1) as EntryId });
      this.#watches.set(channel, watch as WatchHandle<unknown>);
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
      const trace = await this.#trace(channel);
      if (!trace) return;
      const handled = await this.#handleEntries(api, channel, conversation, view.entries, trace);
      await this.#handleLive(api, channel, view.docs["pi.live"] as LiveState | undefined, handled);
    } catch (error) {
      console.error("discord trace:", error);
    }
  }

  async #trace(channel: string): Promise<Trace | undefined> {
    return (await this.#edith.harness.snapshot(State, this.#context))?.trace[channel];
  }

  // Handles the entries after the trace's cursor and returns the trace as it committed it.
  async #handleEntries(
    api: API,
    channel: string,
    conversation: Conversation,
    entries: readonly EntryRecord[],
    trace: Trace,
  ): Promise<Trace> {
    for (const entry of entries.filter((candidate) => candidate.id > trace.after)) {
      const posted: Record<string, ToolPost> = {};
      // The generation that streamed this entry, if it posted anything.
      const assistant = AssistantEntry.is(entry);
      const stream = assistant ? trace.stream : undefined;
      const finished = assistant ? this.#streaming.get(channel) : undefined;
      const text = assistant ? textOf(entryContent(entry)) : "";
      const items = itemsOf(entry);
      const answers = assistant && !items.some((item) => item.kind === "tool");
      if (!trace.off) {
        for (const item of items) {
          if (item.kind === "thinking" && stream?.thinking?.part === item.part) {
            await this.#finishThinking(
              api,
              channel,
              conversation.id,
              entry.id,
              item,
              stream.thinking.message,
            );
            continue;
          }
          if (item.kind === "commentary" && stream && stream.consumed > 0) continue;
          const message = await this.#postItem(api, channel, conversation.id, entry.id, item);
          if (item.kind !== "tool" || !message) continue;
          posted[item.callId] = {
            message,
            conversation: conversation.id,
            entry: entry.id,
            part: item.part,
          };
          this.#items.set(item.callId, item);
        }
        // Text beside tool calls that streamed only in part posts its rest.
        const rest = text.slice(stream?.consumed ?? 0).trim();
        if (stream && stream.consumed > 0 && !answers && rest !== "")
          await this.#post(api, channel, rest, {
            nonce: (index) => `r${entry.id}-${index}`,
            flags: MessageFlags.SuppressNotifications,
          });
      }
      const result = resultOf(entry);
      const post = result && (trace.tools[result.callId] ?? posted[result.callId]);
      if (result && post) {
        const item = await this.#toolItem(result.callId, post);
        if (item) await this.#editTool(api, channel, post, item, toolState(result), result.calls);
        this.#rendered.delete(post.message);
      }
      if (result) {
        this.#items.delete(result.callId);
        this.#live.delete(result.callId);
      }
      await this.#edith.harness.commit(async (tx) => {
        const current = (await tx.doc(State)).trace[channel];
        if (!current) return;
        current.after = entry.id;
        Object.assign(current.tools, posted);
        if (result) delete current.tools[result.callId];
        if (!assistant) return;
        delete current.stream;
        if (finished !== undefined) current.finished = finished;
        if (answers && stream && stream.consumed > 0)
          (current.streamed ??= {})[entry.id] = { consumed: stream.consumed, sent: stream.sent };
      }, this.#context);
      if (assistant) this.#lastPost.delete(channel);
      const { stream: _finishedStream, ...kept } = trace;
      trace = {
        ...(assistant ? kept : trace),
        ...(assistant && finished !== undefined && { finished }),
        after: entry.id,
        tools: Object.fromEntries(
          Object.entries({ ...trace.tools, ...posted }).filter(([id]) => id !== result?.callId),
        ),
      };
      this.#release(channel, entry.id);
    }
    return trace;
  }

  // Posts what the streaming generation added, and edits running code mode calls whose script
  // made new calls since they were last seen.
  async #handleLive(
    api: API,
    channel: string,
    live: LiveState | undefined,
    trace: Trace,
  ): Promise<void> {
    await this.#stream(api, channel, live, trace);
    for (const [callId, post] of Object.entries(trace.tools)) {
      const calls = liveCalls(live, callId);
      if (calls.length === 0) continue;
      if (JSON.stringify(calls) === JSON.stringify(this.#live.get(callId))) continue;
      this.#live.set(callId, calls);
      const item = await this.#toolItem(callId, post);
      if (item) await this.#editTool(api, channel, post, item, "running", calls);
    }
  }

  // The streaming generation's thinking card, posted at once and edited at most every few
  // seconds, and its complete text units once they have gathered for a while.
  async #stream(
    api: API,
    channel: string,
    live: LiveState | undefined,
    trace: Trace,
  ): Promise<void> {
    const run = live?.run;
    const generation = live?.generation;
    const message = generation?.message;
    if (trace.off || !run || !generation || !message) return;
    const key = `${run.taskId}.${generation.attempt}`;
    if (key === trace.finished) return;
    this.#streaming.set(channel, key);
    const before = trace.stream?.key === key ? trace.stream : undefined;
    let stream: Stream = before ?? { key, consumed: 0, sent: 0 };
    const content = message.content as readonly StreamPart[];

    const part = content.findIndex(
      (candidate) => candidate.type === "thinking" && (candidate.thinking ?? "").trim() !== "",
    );
    if (part >= 0) {
      const rendered = renderThinking((content[part]?.thinking ?? "").trim(), false, cardLimit);
      if (!stream.thinking) {
        const posted = await api.channels.createMessage(channel, {
          components: card(rendered),
          nonce: `k${key}`,
          enforce_nonce: true,
          allowed_mentions: { parse: [] },
          flags: MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2,
        });
        this.#rendered.set(posted.id, rendered);
        this.#thinkingEdited.set(posted.id, Date.now());
        stream = { ...stream, thinking: { part, message: posted.id } };
      } else if (
        this.#rendered.get(stream.thinking.message) !== rendered &&
        Date.now() - (this.#thinkingEdited.get(stream.thinking.message) ?? 0) >= thinkingEditWait
      ) {
        await api.channels.editMessage(channel, stream.thinking.message, {
          components: card(rendered),
        });
        this.#rendered.set(stream.thinking.message, rendered);
        this.#thinkingEdited.set(stream.thinking.message, Date.now());
      }
    }

    const text = textOf(content);
    const end = completePrefix(text);
    const ready = text.slice(stream.consumed, end).trim();
    const gathered = Date.now() - (this.#lastPost.get(channel) ?? 0) >= gatherWait;
    let replied: string | undefined;
    if (ready !== "" && (gathered || ready.length >= messageLimit)) {
      // The first message a run posts replies to the input it answers.
      const state = await this.#edith.harness.snapshot(State, this.#context);
      const input = Object.entries(state?.pending ?? {}).find(
        ([, pending]) =>
          pending.channel === channel && run.inputs.includes(pending.submission as SubmissionId),
      );
      const replyTo = input && !input[1].replied ? input[0] : undefined;
      const sent = stream.sent;
      await this.#post(api, channel, ready, {
        nonce: (index) => `s${key}.${sent + index}`,
        flags: MessageFlags.SuppressNotifications,
        ...(replyTo !== undefined && { replyTo }),
      });
      replied = replyTo;
      stream = { ...stream, consumed: end, sent: sent + split(ready, messageLimit).length };
      this.#lastPost.set(channel, Date.now());
    }
    if (stream === before) return;
    await this.#edith.harness.commit(async (tx) => {
      const state = await tx.doc(State);
      const current = state.trace[channel];
      if (current) current.stream = stream;
      const pending = replied === undefined ? undefined : state.pending[replied];
      if (pending) pending.replied = true;
    }, this.#context);
  }

  // A thinking card posted while it streamed, edited to its final rendering with its button.
  async #finishThinking(
    api: API,
    channel: string,
    conversation: number,
    entry: number,
    item: Extract<Item, { kind: "thinking" }>,
    message: string,
  ): Promise<void> {
    const text = renderThinking(item.text, false, cardLimit);
    await api.channels.editMessage(channel, message, {
      components: card(text, {
        id: toggleId(conversation, entry, item.part, true),
        expanded: false,
      }),
    });
    this.#rendered.set(message, text);
    this.#thinkingEdited.delete(message);
  }

  async #conversationOf(id: number): Promise<Conversation | undefined> {
    return this.#edith.harness.conversation(id as ConversationId, this.#context);
  }

  async #itemOf(
    conversation: Conversation | undefined,
    post: Pick<ToolPost, "entry" | "part">,
  ): Promise<Item | undefined> {
    const page = await conversation?.entries(
      { minEntryId: post.entry as EntryId, maxEntryId: post.entry as EntryId },
      1,
      undefined,
      this.#context,
    );
    const entry = page?.items[0];
    return entry && itemAt(entry, post.part);
  }

  // A code mode call's item, kept from when it was posted, or read again after a restart.
  async #toolItem(callId: string, post: ToolPost): Promise<ToolItem | undefined> {
    const known = this.#items.get(callId);
    if (known) return known;
    const item = await this.#itemOf(await this.#conversationOf(post.conversation), post);
    if (item?.kind !== "tool") return undefined;
    this.#items.set(callId, item);
    return item;
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
    if (item.kind === "commentary")
      return this.#post(api, channel, item.text, {
        nonce: (index) => `c${entry}-${item.part}-${index}`,
        flags,
      });
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

  async #editTool(
    api: API,
    channel: string,
    post: ToolPost,
    item: ToolItem,
    state: "running" | "ok" | "error",
    calls: readonly Call[],
  ): Promise<void> {
    const text = renderTool(item, state, calls, post.expanded ?? false, cardLimit);
    if (this.#rendered.get(post.message) === text) return;
    await api.channels.editMessage(channel, post.message, {
      components: card(text, toolToggle(post, item)),
    });
    this.#rendered.set(post.message, text);
  }

  // Wakes the answers waiting for the trace to reach `entry`.
  #release(channel: string, entry: number): void {
    const waiting = this.#waiting.get(channel) ?? [];
    for (const waiter of waiting.filter((candidate) => candidate.entry <= entry)) waiter.resolve();
    this.#waiting.set(
      channel,
      waiting.filter((candidate) => candidate.entry > entry),
    );
  }

  // Waits until the trace has handled `entry`, so the answer follows what led to it; gives up
  // after a while rather than holding the answer back.
  async #tracedTo(api: API, channel: string, entry: number): Promise<void> {
    await this.#follow(api, channel).catch(() => {});
    const trace = await this.#trace(channel);
    if (!trace || trace.after >= entry) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, traceWait);
      const waiting = this.#waiting.get(channel) ?? [];
      waiting.push({
        entry,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
      this.#waiting.set(channel, waiting);
    });
  }

  // Expands or collapses a traced message, rebuilt from the conversation's entries.
  async #toggle(api: API, interaction: APIMessageComponentInteraction): Promise<void> {
    const user = interaction.member?.user ?? interaction.user;
    const match = /^x:(\d+):(\d+):(\d+):([01])$/.exec(interaction.data.custom_id);
    const allowed = user !== undefined && this.#options.allowedUsers.includes(user.id);
    const [id, entry, part] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
    const conversation = allowed && match ? await this.#conversationOf(id) : undefined;
    const item = await this.#itemOf(conversation, { entry, part });
    if (!conversation || !item || item.kind === "commentary") {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: "Not available here.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const expanded = match?.[4] === "1";
    let text: string;
    if (item.kind === "thinking") text = renderThinking(item.text, expanded, cardLimit);
    else {
      const later = await conversation.entries(
        { minEntryId: (entry + 1) as EntryId, order: "ascending" },
        100,
        undefined,
        this.#context,
      );
      const result = later.items.map(resultOf).find((found) => found?.callId === item.callId);
      text = renderTool(
        item,
        toolState(result),
        result?.calls ?? this.#live.get(item.callId) ?? [],
        expanded,
        cardLimit,
      );
      const channel = interaction.channel.id;
      if (!result)
        await this.#edith.harness.commit(async (tx) => {
          const post = (await tx.doc(State)).trace[channel]?.tools[item.callId];
          if (post) post.expanded = expanded;
        }, this.#context);
    }
    await api.interactions.updateMessage(interaction.id, interaction.token, {
      components: card(text, { id: toggleId(id, entry, part, !expanded), expanded }),
    });
    this.#rendered.set(interaction.message.id, text);
  }
}
