import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const bool = z
  .string()
  .optional()
  .transform((value) => ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase()));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  API_KEY: z.string().min(16, "API_KEY must be at least 16 characters"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ALLOWED_GUILD_IDS: csv,
  ENABLE_WRITE: bool,
  GITHUB_WEBHOOK_SECRET: optionalString,
  GITHUB_NOTIFY_CHANNEL_ID: optionalString,
});

export type AppConfig = {
  discordToken: string;
  apiKey: string;
  host: string;
  port: number;
  allowedGuildIds: string[];
  enableWrite: boolean;
  githubWebhookSecret?: string;
  githubNotifyChannelId?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n${issues.join("\n")}`);
  }
  const c = parsed.data;
  return {
    discordToken: c.DISCORD_TOKEN,
    apiKey: c.API_KEY,
    host: c.HOST,
    port: c.PORT,
    allowedGuildIds: c.ALLOWED_GUILD_IDS,
    enableWrite: c.ENABLE_WRITE,
    githubWebhookSecret: c.GITHUB_WEBHOOK_SECRET,
    githubNotifyChannelId: c.GITHUB_NOTIFY_CHANNEL_ID,
  };
}
