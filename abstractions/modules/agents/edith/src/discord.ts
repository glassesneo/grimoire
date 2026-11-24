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
  describeHold,
  describeSessions,
  followDefault,
  levels,
  parseModel,
  parseThinking,
  sessionLabel,
  messageOf,
  sessionStarted,
  split,
} from "./commands.ts";
import { type Edith, Refused, type Status } from "./core.ts";
import { completePrefix } from "./paragraphs.ts";
import { EntryWaiters } from "./stream.ts";
import {
  itemAt,
  itemsOf,
  liveCalls,
  renderThinking,
  renderTool,
  resultOf,
  type Call,
  type Item,
  type ToolState,
} from "./trace.ts";

export type DiscordOptions = {
  readonly token: string;
  readonly allowedUsers: readonly string[];
};

const messageLimit = 2000;
const cardLimit = 3800;
const traceWait = 30_000;
const gatherWait = 2_500;
const thinkingEditWait = 1_500;
const holdPoll = 1_000;
const waitingMark = "⏳";
const catchUpLimit = 100;

type Pending = { channel: string; submission: number; replied?: boolean; waiting?: boolean };
type ToolPost = {
  message: string;
  conversation: number;
  entry: number;
  part: number;
  expanded?: boolean;
};
type Stream = {
  key: string;
  consumed: number;
  sent: number;
  thinking?: { part: number; message: string };
};
type Streamed = Pick<Stream, "consumed" | "sent">;
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
  version: 2,
  scope: "session",
  initial: () => ({ pending: {}, lastSeen: {}, trace: {} }),
  migrate: (value) => ({ trace: {}, ...(value as Partial<DiscordState>) }) as DiscordState,
  checkpointWhen: () => true,
});

type ToolItem = Extract<Item, { kind: "tool" }>;

type StreamPart = { readonly type: string; readonly text?: string; readonly thinking?: string };

const textOf = (content: readonly StreamPart[]) =>
  content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("");

const entryContent = (entry: EntryRecord): readonly StreamPart[] =>
  (entry.model ?? []).flatMap((message) => (message.role === "assistant" ? message.content : []));
type Toggle = { id: string; expanded: boolean };

const toggleId = (conversation: number, entry: number, part: number, expand: boolean) =>
  `x:${conversation}:${entry}:${part}:${expand ? 1 : 0}`;

const controlButtons = (names: readonly ("pause" | "resume" | "stop")[]) =>
  names.map((name) => ({
    type: ComponentType.Button as const,
    style: name === "stop" ? (ButtonStyle.Danger as const) : (ButtonStyle.Secondary as const),
    label: { pause: "⏸️ Pause", resume: "▶️ Resume", stop: "⏹️ Stop" }[name],
    custom_id: `c:${name}`,
  }));

function card(
  text: string,
  toggle?: { id: string; expanded: boolean },
  controls: readonly ("pause" | "resume" | "stop")[] = [],
): APIContainerComponent[] {
  const buttons = [
    ...(toggle
      ? [
          {
            type: ComponentType.Button as const,
            style: ButtonStyle.Secondary as const,
            label: toggle.expanded ? "Collapse" : "Expand",
            custom_id: toggle.id,
          },
        ]
      : []),
    ...controlButtons(controls),
  ];
  return [
    {
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: text },
        ...(buttons.length > 0
          ? [{ type: ComponentType.ActionRow as const, components: buttons }]
          : []),
      ],
    },
  ];
}

const toolState = (result: { isError: boolean } | undefined): ToolState =>
  result === undefined ? "running" : result.isError ? "error" : "ok";

const controlsOf = (state: ToolState) =>
  state === "running"
    ? (["pause", "stop"] as const)
    : state === "paused"
      ? (["resume", "stop"] as const)
      : [];

const toolToggle = (post: ToolPost, item: ToolItem): Toggle | undefined =>
  item.code === undefined
    ? undefined
    : {
        id: toggleId(post.conversation, post.entry, post.part, !post.expanded),
        expanded: post.expanded ?? false,
      };

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
    description: "Start a new conversation here, or in a new channel beside this one when named",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "name",
        description: "A new channel's name; without one, the conversation starts here",
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
  simple("sessions", "Switch this channel back to one of its earlier conversations"),
];

const simple = (name: string, description: string) => ({
  type: ApplicationCommandType.ChatInput as const,
  name,
  description,
});

const divider = (text: string) => ({ content: text, allowed_mentions: { parse: [] } });

const topicOf = (status: Status) => `EDITH · access: ${status.access} · persona: ${status.persona}`;

const later = (a: string, b: string | undefined) =>
  b === undefined || BigInt(a) > BigInt(b) ? a : b;

export class Discord {
  readonly #edith: Edith;
  readonly #options: DiscordOptions;
  readonly #context: Context;
  readonly #gateway: WebSocketManager;
  readonly #client: Client;
  readonly #delivering = new Set<string>();
  readonly #traces = new Map<string, Promise<void>>();
  readonly #watches = new Map<string, WatchHandle<unknown>>();
  readonly #rendered = new Map<string, string>();
  readonly #items = new Map<string, ToolItem>();
  readonly #live = new Map<string, { calls: Call[]; seen: string }>();
  readonly #waiting = new Map<string, EntryWaiters>();
  readonly #lastPost = new Map<string, number>();
  readonly #streaming = new Map<string, string>();
  readonly #thinkingEdited = new Map<string, number>();
  readonly #holds = new Map<
    string,
    | { kind: "card"; callId: string; post: ToolPost }
    | { kind: "message"; message: string; text: string }
  >();
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
    this.#client.on(GatewayDispatchEvents.Ready, ({ data, api }) => {
      console.error(`discord: connected as ${data.user.username}`);
      this.#application = data.application.id;
      this.#spawn(this.#recover(api));
    });
    // Each guild arrives after Ready, and again when the bot joins one. Overwriting the whole set
    // leaves exactly these commands, whatever an earlier version registered.
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
    const paused = await this.#edith.paused(address, this.#context);
    let submission: SubmissionId;
    try {
      submission = await this.#edith.submit(
        address,
        {
          content: message.content,
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
    if (paused) await this.#endHold(api, channel, "💬 resumed with your message");
    await this.#markWaiting(api, channel, message.id, submission);
    await this.#deliver(api, message.id);
  }

  async #markWaiting(
    api: API,
    channel: string,
    id: string,
    submission: SubmissionId,
  ): Promise<void> {
    const handle = await this.#edith.harness.submission(submission, this.#context);
    const queued = async () => (await handle?.status(this.#context))?.status === "queued";
    if (!(await queued())) return;
    await api.channels.addMessageReaction(channel, id, waitingMark);
    await this.#edith.harness.commit(async (tx) => {
      const pending = (await tx.doc(State)).pending[id];
      if (pending) pending.waiting = true;
    }, this.#context);
    // Given to the model meanwhile, before the trace could see the mark.
    if (!(await queued())) await this.#unmarkWaiting(api, channel, id);
  }

  async #unmarkWaiting(api: API, channel: string, id: string, waiting?: boolean): Promise<void> {
    const marked =
      waiting ?? (await this.#edith.harness.snapshot(State, this.#context))?.pending[id]?.waiting;
    if (!marked) return;
    await api.channels
      .deleteOwnMessageReaction(channel, id, waitingMark)
      .catch((error: unknown) => console.error("discord reaction:", error));
    await this.#edith.harness.commit(async (tx) => {
      const current = (await tx.doc(State)).pending[id];
      if (current) delete current.waiting;
    }, this.#context);
  }

  async #interact(api: API, interaction: APIInteraction): Promise<void> {
    if (
      interaction.type !== InteractionType.MessageComponent &&
      interaction.type !== InteractionType.ApplicationCommand
    )
      return;
    const user = interaction.member?.user ?? interaction.user;
    if (!user || !this.#options.allowedUsers.includes(user.id) || !interaction.channel) {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: "Not available here.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.type === InteractionType.MessageComponent) {
      const id = interaction.data.custom_id;
      if (id.startsWith("x:")) return this.#toggle(api, interaction);
      if (id.startsWith("c:")) return this.#control(api, interaction);
      return this.#switchFrom(api, interaction);
    }
    const data = interaction.data;
    if (data.type !== ApplicationCommandType.ChatInput) return;
    const channel = interaction.channel.id;
    const reply = (content: string, flags?: MessageFlags) =>
      api.interactions.reply(interaction.id, interaction.token, {
        content,
        allowed_mentions: { parse: [] },
        ...(flags !== undefined && { flags }),
      });
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
        const chosen = Object.fromEntries(
          (["access", "persona"] as const).flatMap((name) =>
            option(name) === "" ? [] : [[name, option(name)]],
          ),
        );
        try {
          this.#edith.check(address, chosen);
        } catch (error) {
          if (!(error instanceof Refused)) throw error;
          await reply(error.message, MessageFlags.Ephemeral);
          return;
        }
        if (option("name") === "") {
          await api.interactions.defer(interaction.id, interaction.token);
          await this.#move(api, channel, () => this.#edith.reset(address, this.#context, chosen));
          await this.#endHold(api, channel, "⏹️ stopped");
          const status = await this.#edith.status(address, this.#context);
          if (Object.keys(chosen).length > 0) await this.#showChoices(api, channel);
          await api.interactions.editReply(
            interaction.application_id,
            interaction.token,
            divider(
              `**── New session ──** with access ${status.access} as ${status.persona}\nThe previous one is kept; /sessions lists them.`,
            ),
          );
          return;
        }
        const guild = interaction.guild_id;
        if (guild === undefined) {
          await reply("Channels are created in a server only.", MessageFlags.Ephemeral);
          return;
        }
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
          await reply(`Could not create the channel: ${messageOf(error)}`, MessageFlags.Ephemeral);
          return;
        }
        const status = await this.#edith.configure(`discord:${created.id}`, chosen, this.#context);
        await this.#showChoices(api, created.id);
        await reply(`<#${created.id}> runs with access ${status.access} as ${status.persona}.`);
        return;
      }
      case "pause":
        await reply(describe(await this.#edith.pause(address, this.#context)));
        this.#spawn(this.#showHold(api, channel));
        return;
      case "resume":
        await reply(describe(await this.#edith.resume(address, this.#context)));
        await this.#endHold(api, channel, "▶️ resumed");
        return;
      case "stop":
        await api.interactions.defer(interaction.id, interaction.token);
        await api.interactions.editReply(interaction.application_id, interaction.token, {
          content: `⏹️ stopped\n${describe(await this.#edith.stop(address, this.#context))}`,
        });
        await this.#endHold(api, channel, "⏹️ stopped");
        return;
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
                    options: earlier.map((session, index) => {
                      const started = sessionStarted(session);
                      return {
                        label: sessionLabel(session, index + 1).slice(0, 100),
                        value: String(session.conversation),
                        ...(started !== undefined && { description: started }),
                      };
                    }),
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

  // Discord allows two topic changes in ten minutes, so a change it refuses is left for /status to
  // show.
  async #showChoices(api: API, channel: string): Promise<void> {
    const status = await this.#edith.status(`discord:${channel}`, this.#context);
    await api.channels
      .edit(channel, { topic: topicOf(status) })
      .catch((error: unknown) => console.error("discord topic:", error));
  }

  async #showHold(api: API, channel: string): Promise<void> {
    const held = await this.#edith.whenHeld(`discord:${channel}`, holdPoll, this.#context);
    if (!held) return;
    if (held.kind === "tool") {
      await this.#tracedTo(api, channel, held.assistant);
      const post = (await this.#trace(channel))?.tools[held.callId];
      const item = post && (await this.#toolItem(held.callId, post));
      if (post && item) {
        await this.#editTool(api, channel, post, item, "paused", []);
        this.#holds.set(channel, { kind: "card", callId: held.callId, post });
        return;
      }
    }
    const text = `${describeHold(held)}; /resume goes on.`;
    const message = await api.channels.createMessage(channel, {
      content: text,
      allowed_mentions: { parse: [] },
      flags: MessageFlags.SuppressNotifications,
      components: [
        { type: ComponentType.ActionRow, components: controlButtons(["resume", "stop"]) },
      ],
    });
    this.#holds.set(channel, { kind: "message", message: message.id, text });
  }

  async #endHold(api: API, channel: string, how: string): Promise<void> {
    const hold = this.#holds.get(channel);
    if (!hold) return;
    this.#holds.delete(channel);
    if (hold.kind === "card") {
      const item = await this.#toolItem(hold.callId, hold.post);
      if (item && (await this.#trace(channel))?.tools[hold.callId])
        await this.#editTool(api, channel, hold.post, item, "running", []).catch((error: unknown) =>
          console.error("discord hold:", error),
        );
      return;
    }
    await api.channels
      .editMessage(channel, hold.message, { content: `~~${hold.text}~~ ${how}`, components: [] })
      .catch((error: unknown) => console.error("discord hold:", error));
  }

  async #move<Moved extends { previous: number }>(
    api: API,
    channel: string,
    move: () => Promise<Moved>,
  ): Promise<Moved> {
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

  async #control(api: API, interaction: APIMessageComponentInteraction): Promise<void> {
    const channel = interaction.channel.id;
    const address = `discord:${channel}`;
    await api.interactions.deferMessageUpdate(interaction.id, interaction.token);
    switch (interaction.data.custom_id) {
      case "c:pause":
        await this.#edith.pause(address, this.#context);
        this.#spawn(this.#showHold(api, channel));
        return;
      case "c:resume":
        await this.#edith.resume(address, this.#context);
        await this.#endHold(api, channel, "▶️ resumed");
        return;
      case "c:stop":
        await this.#edith.stop(address, this.#context);
        await this.#endHold(api, channel, "⏹️ stopped");
        return;
    }
  }

  async #switchFrom(api: API, interaction: APIMessageComponentInteraction): Promise<void> {
    const channel = interaction.channel.id;
    const data = interaction.data;
    const value =
      data.component_type === ComponentType.StringSelect && data.custom_id === "sessions"
        ? data.values[0]
        : undefined;
    if (value === undefined) return;
    await api.interactions.defer(interaction.id, interaction.token);
    let session;
    try {
      session = await this.#move(api, channel, () =>
        this.#edith.switchTo(`discord:${channel}`, Number(value), this.#context),
      );
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      await api.interactions.editReply(interaction.application_id, interaction.token, {
        content: error.message,
      });
      return;
    }
    await this.#endHold(api, channel, "⏹️ stopped");
    const when =
      session.started === null ? "" : ` from <t:${Math.floor(session.started / 1000)}:f>`;
    await api.interactions.editReply(
      interaction.application_id,
      interaction.token,
      divider(`**── Switched to the session${when} ──**\n${session.preview || "(empty)"}`),
    );
  }

  async #deliver(api: API, id: string): Promise<void> {
    if (this.#delivering.has(id)) return;
    this.#delivering.add(id);
    try {
      const pending = (await this.#edith.harness.snapshot(State, this.#context))?.pending[id];
      if (!pending) return;
      const typing = setInterval(
        () =>
          void this.#edith
            .paused(`discord:${pending.channel}`, this.#context)
            .then((paused) => (paused ? undefined : api.channels.showTyping(pending.channel)))
            .catch(() => {}),
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
      const state = await this.#edith.harness.snapshot(State, this.#context);
      const streamed =
        answer.status === "done"
          ? state?.trace[pending.channel]?.streamed?.[answer.entry]
          : undefined;
      const text =
        answer.status === "done"
          ? answer.text.slice(streamed?.consumed ?? 0).trim() || (streamed ? "" : "(empty answer)")
          : answer.status === "stopped"
            ? "⏹️ stopped"
            : `⚠️ unanswered: ${answer.reason}`;
      const replied = state?.pending[id]?.replied;
      if (text !== "")
        await this.#post(api, pending.channel, text, {
          nonce: (index) => `${id}-${index}`,
          ...(!replied && { replyTo: id }),
        });
      await this.#unmarkWaiting(api, pending.channel, id, state?.pending[id]?.waiting ?? false);
      await this.#edith.harness.commit(async (tx) => {
        const state = await tx.doc(State);
        delete state.pending[id];
        if (answer.status === "done") delete state.trace[pending.channel]?.streamed?.[answer.entry];
      }, this.#context);
    } finally {
      this.#delivering.delete(id);
    }
  }

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

  async #handleEntries(
    api: API,
    channel: string,
    conversation: Conversation,
    entries: readonly EntryRecord[],
    trace: Trace,
  ): Promise<Trace> {
    for (const entry of entries.filter((candidate) => candidate.id > trace.after)) {
      if (entry.kind === "discord.message") {
        const placed = (entry.data as { messageId?: string } | undefined)?.messageId;
        if (placed) await this.#unmarkWaiting(api, channel, placed);
      }
      const posted: Record<string, ToolPost> = {};
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
      trace = await this.#edith.harness.commit(async (tx) => {
        const current = (await tx.doc(State)).trace[channel];
        if (!current) return trace;
        current.after = entry.id;
        Object.assign(current.tools, posted);
        if (result) delete current.tools[result.callId];
        if (assistant) {
          delete current.stream;
          if (finished !== undefined) current.finished = finished;
          if (answers && stream && stream.consumed > 0)
            (current.streamed ??= {})[entry.id] = { consumed: stream.consumed, sent: stream.sent };
        }
        return JSON.parse(JSON.stringify(current)) as Trace;
      }, this.#context);
      if (assistant) this.#lastPost.delete(channel);
      this.#release(channel, entry.id);
    }
    return trace;
  }

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
      const seen = JSON.stringify(calls);
      if (seen === this.#live.get(callId)?.seen) continue;
      this.#live.set(callId, { calls, seen });
      const item = await this.#toolItem(callId, post);
      if (item) await this.#editTool(api, channel, post, item, "running", calls);
    }
  }

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
          components: card(rendered, undefined, controlsOf("running")),
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
          components: card(rendered, undefined, controlsOf("running")),
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

  async #toolItem(callId: string, post: ToolPost): Promise<ToolItem | undefined> {
    const known = this.#items.get(callId);
    if (known) return known;
    const item = await this.#itemOf(await this.#conversationOf(post.conversation), post);
    if (item?.kind !== "tool") return undefined;
    this.#items.set(callId, item);
    return item;
  }

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
        item.kind === "tool" ? controlsOf("running") : [],
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
    state: ToolState,
    calls: readonly Call[],
  ): Promise<void> {
    const text = renderTool(item, state, calls, post.expanded ?? false, cardLimit);
    if (this.#rendered.get(post.message) === text) return;
    await api.channels.editMessage(channel, post.message, {
      components: card(text, toolToggle(post, item), controlsOf(state)),
    });
    this.#rendered.set(post.message, text);
  }

  #release(channel: string, entry: number): void {
    this.#waiting.get(channel)?.release(entry);
  }

  // Gives up after a while rather than holding the answer back.
  async #tracedTo(api: API, channel: string, entry: number): Promise<void> {
    await this.#follow(api, channel).catch(() => {});
    const trace = await this.#trace(channel);
    if (!trace || trace.after >= entry) return;
    let waiting = this.#waiting.get(channel);
    if (!waiting) this.#waiting.set(channel, (waiting = new EntryWaiters()));
    await waiting.wait(entry, traceWait);
  }

  async #toggle(api: API, interaction: APIMessageComponentInteraction): Promise<void> {
    const match = /^x:(\d+):(\d+):(\d+):([01])$/.exec(interaction.data.custom_id);
    const [id, entry, part] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
    const conversation = match ? await this.#conversationOf(id) : undefined;
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
    let running = false;
    let paused = false;
    if (item.kind === "thinking") text = renderThinking(item.text, expanded, cardLimit);
    else {
      const later = await conversation.entries(
        { minEntryId: (entry + 1) as EntryId, order: "ascending" },
        100,
        undefined,
        this.#context,
      );
      const result = later.items.map(resultOf).find((found) => found?.callId === item.callId);
      const channel = interaction.channel.id;
      const hold = this.#holds.get(channel);
      running = !result;
      paused = running && hold?.kind === "card" && hold.callId === item.callId;
      text = renderTool(
        item,
        paused ? "paused" : toolState(result),
        result?.calls ?? this.#live.get(item.callId)?.calls ?? [],
        expanded,
        cardLimit,
      );
      if (!result)
        await this.#edith.harness.commit(async (tx) => {
          const post = (await tx.doc(State)).trace[channel]?.tools[item.callId];
          if (post) post.expanded = expanded;
        }, this.#context);
    }
    await api.interactions.updateMessage(interaction.id, interaction.token, {
      components: card(
        text,
        { id: toggleId(id, entry, part, !expanded), expanded },
        controlsOf(paused ? "paused" : running ? "running" : "ok"),
      ),
    });
    this.#rendered.set(interaction.message.id, text);
  }
}
