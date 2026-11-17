// The Discord client: each channel is the conversation `discord:<channel id>`, answering the
// allowed users only, who set a channel's model and thinking level with slash commands. Replies are delivered at least once across restarts: the input and its
// pending reply are admitted in one commit, and the reply is forgotten once it is posted.
// Discord deduplicates a repeated post by its nonce for a few minutes.
import type { Context } from "@earendil-works/chord/context";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Client,
  GatewayDispatchEvents,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
  type API,
  type APIInteraction,
  type APIMessage,
  type RESTPutAPIApplicationGuildCommandsJSONBody,
} from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import { defineDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { describe, followDefault, levels, parseModel, parseThinking, split } from "./commands.ts";
import type { Edith } from "./core.ts";

export type DiscordOptions = {
  readonly token: string;
  readonly allowedUsers: readonly string[];
};

const messageLimit = 2000;
// Channel history fetched per channel when the gateway connects again.
const catchUpLimit = 100;

type Pending = { channel: string; submission: number };
const State = defineDoc<{ pending: Record<string, Pending>; lastSeen: Record<string, string> }>({
  kind: "edith.discord",
  version: 1,
  scope: "session",
  initial: () => ({ pending: {}, lastSeen: {} }),
  checkpointWhen: () => true,
});

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
    await this.#gateway.destroy();
  }

  #spawn(work: Promise<void>): void {
    work.catch((error: unknown) => console.error("discord:", error));
  }

  async #recover(api: API): Promise<void> {
    const state = await this.#edith.harness.snapshot(State, this.#context);
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
}
