export type GuildSummary = {
  id: string;
  name: string;
  memberCount: number;
};

export type ChannelSummary = {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number | null;
};

export type ThreadSummary = {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string | null;
  archived: boolean;
  messageCount: number | null;
  createdAt: string | null;
};

export type MessageSummary = {
  id: string;
  channelId: string;
  url: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    bot: boolean;
  };
  content: string;
  createdAt: string;
  editedAt: string | null;
  replyToMessageId: string | null;
  threadId: string | null;
  attachments: { name: string; url: string; contentType: string | null; size: number }[];
  embeds: { title: string | null; description: string | null; url: string | null }[];
};

export type FetchMessagesOptions = {
  limit: number;
  before?: string;
  after?: string;
};

export type OutgoingEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  author?: { name: string; icon_url?: string; url?: string };
  timestamp?: string;
};

export type OutgoingMessage = {
  content?: string;
  embeds?: OutgoingEmbed[];
};

/**
 * Everything the HTTP layer needs from Discord. Methods return null when the
 * resource does not exist or the bot cannot see it.
 */
export interface DiscordGateway {
  listGuilds(): Promise<GuildSummary[]>;
  listChannels(guildId: string): Promise<ChannelSummary[] | null>;
  getChannelGuildId(channelId: string): Promise<string | null>;
  fetchMessages(channelId: string, options: FetchMessagesOptions): Promise<MessageSummary[] | null>;
  listThreads(channelId: string): Promise<ThreadSummary[] | null>;
  sendMessage(channelId: string, message: OutgoingMessage): Promise<{ id: string } | null>;
}
