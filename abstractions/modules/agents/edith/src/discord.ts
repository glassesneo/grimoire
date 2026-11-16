// The Discord client: each channel is the conversation `discord:<channel id>`, answering the
// allowed users only. Replies are delivered at least once across restarts: the input and its
// pending reply are admitted in one commit, and the reply is forgotten once it is posted.
// Discord deduplicates a repeated post by its nonce for a few minutes.
import type { Context } from "@earendil-works/chord/context";
import {
  Client,
  GatewayDispatchEvents,
  GatewayIntentBits,
  type API,
  type APIMessage,
} from "@discordjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager } from "@discordjs/ws";
import { defineDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { describe, help, parseCommand, split } from "./commands.ts";
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
    // Ready follows every new session; events missed while disconnected are not replayed.
    this.#client.on(GatewayDispatchEvents.Ready, ({ data, api }) => {
      console.error(`discord: connected as ${data.user.username}`);
      this.#spawn(this.#recover(api));
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
    const command = parseCommand(message.content);
    if (command) {
      const reply = await this.#command(address, command);
      await this.#post(api, channel, message.id, reply);
      await this.#edith.harness.commit(async (tx) => {
        const state = await tx.doc(State);
        state.lastSeen[channel] = later(message.id, state.lastSeen[channel]);
      }, this.#context);
      return;
    }
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

  async #command(
    address: string,
    command: NonNullable<ReturnType<typeof parseCommand>>,
  ): Promise<string> {
    switch (command.kind) {
      case "help":
        return help;
      case "invalid":
        return command.message;
      case "status":
        return describe(await this.#edith.status(address, this.#context));
      case "model":
        return describe(
          await this.#edith.configure(address, { model: command.value }, this.#context),
        );
      case "thinking":
        return describe(
          await this.#edith.configure(address, { thinkingLevel: command.value }, this.#context),
        );
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
