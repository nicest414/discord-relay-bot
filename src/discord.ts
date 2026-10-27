import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  type Channel,
  type Message,
  type ThreadChannel,
} from "discord.js";
import type {
  ChannelSummary,
  DiscordGateway,
  FetchMessagesOptions,
  GuildSummary,
  MessageSummary,
  OutgoingMessage,
  ThreadSummary,
} from "./types.js";

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
}

export function serializeMessage(message: Message): MessageSummary {
  return {
    id: message.id,
    channelId: message.channelId,
    url: message.url,
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName ?? message.author.displayName,
      bot: message.author.bot,
    },
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    replyToMessageId: message.reference?.messageId ?? null,
    threadId: message.thread?.id ?? null,
    attachments: [...message.attachments.values()].map((a) => ({
      name: a.name,
      url: a.url,
      contentType: a.contentType,
      size: a.size,
    })),
    embeds: message.embeds.map((e) => ({ title: e.title, description: e.description, url: e.url })),
  };
}

function serializeThread(thread: ThreadChannel): ThreadSummary {
  return {
    id: thread.id,
    name: thread.name,
    parentId: thread.parentId,
    ownerId: thread.ownerId,
    archived: thread.archived ?? false,
    messageCount: thread.messageCount,
    createdAt: thread.createdAt?.toISOString() ?? null,
  };
}

export class DiscordJsGateway implements DiscordGateway {
  constructor(private readonly client: Client) {}

  async listGuilds(): Promise<GuildSummary[]> {
    return this.client.guilds.cache.map((g) => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
  }

  async listChannels(guildId: string): Promise<ChannelSummary[] | null> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;
    const channels = await guild.channels.fetch();
    const me = guild.members.me ?? (await guild.members.fetchMe());
    return [...channels.values()]
      .filter((c) => c !== null)
      .filter((c) => c.permissionsFor(me).has(PermissionFlagsBits.ViewChannel))
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: ChannelType[c.type],
        parentId: c.parentId,
        position: "position" in c ? c.position : null,
      }))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  async getChannelGuildId(channelId: string): Promise<string | null> {
    const channel = await this.fetchChannel(channelId);
    if (!channel || channel.isDMBased()) return null;
    return channel.guildId;
  }

  async fetchMessages(channelId: string, options: FetchMessagesOptions): Promise<MessageSummary[] | null> {
    const channel = await this.fetchChannel(channelId);
    if (!channel || !channel.isTextBased()) return null;
    const messages = await channel.messages.fetch({
      limit: options.limit,
      ...(options.before ? { before: options.before } : {}),
      ...(options.after ? { after: options.after } : {}),
    });
    return [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(serializeMessage);
  }

  async listThreads(channelId: string): Promise<ThreadSummary[] | null> {
    const channel = await this.fetchChannel(channelId);
    if (!channel || channel.isDMBased() || channel.isThread() || !("threads" in channel)) return null;
    const active = await channel.threads.fetchActive();
    const archived = await channel.threads.fetchArchived({ type: "public" }).catch(() => null);
    const threads = new Map<string, ThreadChannel>();
    for (const thread of active.threads.values()) threads.set(thread.id, thread);
    for (const thread of archived?.threads.values() ?? []) threads.set(thread.id, thread);
    return [...threads.values()].map(serializeThread);
  }

  async sendMessage(channelId: string, message: OutgoingMessage): Promise<{ id: string } | null> {
    const channel = await this.fetchChannel(channelId);
    if (!channel || !channel.isSendable()) return null;
    const sent = await channel.send({ ...message, allowedMentions: { parse: [] } });
    return { id: sent.id };
  }

  private async fetchChannel(channelId: string): Promise<Channel | null> {
    try {
      return await this.client.channels.fetch(channelId);
    } catch {
      return null;
    }
  }
}
