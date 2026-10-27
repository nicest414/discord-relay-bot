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

const labelPattern = /^[a-zA-Z0-9_.-]{1,32}$/;

const configSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
    API_KEY: z.string().optional(),
    API_KEYS: z.string().optional(),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
    ALLOWED_GUILD_IDS: csv,
    ENABLE_WRITE: bool,
    GITHUB_WEBHOOK_SECRET: optionalString,
    GITHUB_NOTIFY_CHANNEL_ID: optionalString,
  })
  .superRefine((value, ctx) => {
    const named = parseKeyList(value.API_KEYS ?? "");
    const single = value.API_KEY?.trim();
    if (named.length === 0 && !single) {
      ctx.addIssue({ code: "custom", path: ["API_KEYS"], message: "set API_KEYS or API_KEY" });
      return;
    }
    named.forEach(([label, key], i) => {
      if (!labelPattern.test(label)) {
        ctx.addIssue({ code: "custom", path: ["API_KEYS"], message: `entry ${i + 1}: bad label "${label}"` });
      } else if (key.length < 16) {
        ctx.addIssue({ code: "custom", path: ["API_KEYS"], message: `entry ${i + 1} (${label}): key must be at least 16 characters` });
      }
    });
    const labels = new Set(named.map(([label]) => label));
    if (labels.size !== named.length) {
      ctx.addIssue({ code: "custom", path: ["API_KEYS"], message: "duplicate labels" });
    }
    if (single && single.length < 16) {
      ctx.addIssue({ code: "custom", path: ["API_KEY"], message: "API_KEY must be at least 16 characters" });
    }
  });

function parseKeyList(raw: string): [string, string][] {
  const entries: [string, string][] = [];
  for (const item of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = item.indexOf("=");
    if (eq === -1) {
      entries.push(["default", item]);
    } else {
      entries.push([item.slice(0, eq).trim(), item.slice(eq + 1).trim()]);
    }
  }
  return entries;
}

export type AppConfig = {
  discordToken: string;
  /** First key, kept for single-key configs. */
  apiKey: string;
  /** Named keys. When absent, auth uses `apiKey` alone. */
  apiKeys?: { label: string; key: string }[];
  host: string;
  port: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
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
  const named = parseKeyList(c.API_KEYS ?? "");
  const single = c.API_KEY?.trim();
  const apiKeys = named.map(([label, key]) => ({ label, key }));
  if (single) apiKeys.unshift({ label: "default", key: single });
  return {
    discordToken: c.DISCORD_TOKEN,
    apiKey: apiKeys[0]?.key ?? "",
    apiKeys,
    host: c.HOST,
    port: c.PORT,
    rateLimitMax: c.RATE_LIMIT_MAX,
    rateLimitWindowMs: c.RATE_LIMIT_WINDOW_MS,
    allowedGuildIds: c.ALLOWED_GUILD_IDS,
    enableWrite: c.ENABLE_WRITE,
    githubWebhookSecret: c.GITHUB_WEBHOOK_SECRET,
    githubNotifyChannelId: c.GITHUB_NOTIFY_CHANNEL_ID,
  };
}
