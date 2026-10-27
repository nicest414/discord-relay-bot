import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import type { DiscordGateway, MessageSummary } from "../src/types.js";

const GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const CHANNEL = "333333333333333333";
const OTHER_CHANNEL = "444444444444444444";
const NOTIFY_CHANNEL = "555555555555555555";
const API_KEY = "test-api-key-0123456789";
const WEBHOOK_SECRET = "webhook-secret";

const message: MessageSummary = {
  id: "666666666666666666",
  channelId: CHANNEL,
  url: `https://discord.com/channels/${GUILD}/${CHANNEL}/666666666666666666`,
  author: { id: "777777777777777777", username: "alice", displayName: "Alice", bot: false },
  content: "PR #3 ready to review",
  createdAt: "2026-10-27T01:00:00.000Z",
  editedAt: null,
  replyToMessageId: null,
  threadId: null,
  attachments: [],
  embeds: [],
};

function makeGateway(): DiscordGateway {
  return {
    listGuilds: vi.fn(async () => [
      { id: GUILD, name: "hackathon", memberCount: 5 },
      { id: OTHER_GUILD, name: "other", memberCount: 9 },
    ]),
    listChannels: vi.fn(async () => [{ id: CHANNEL, name: "dev", type: "GuildText", parentId: null, position: 0 }]),
    getChannelGuildId: vi.fn(async (id: string) => (id === CHANNEL || id === NOTIFY_CHANNEL ? GUILD : OTHER_GUILD)),
    fetchMessages: vi.fn(async () => [message]),
    listThreads: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ id: "888888888888888888" })),
  };
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    discordToken: "token",
    apiKey: API_KEY,
    host: "127.0.0.1",
    port: 0,
    rateLimitMax: 60,
    rateLimitWindowMs: 60000,
    allowedGuildIds: [GUILD],
    enableWrite: false,
    githubWebhookSecret: WEBHOOK_SECRET,
    githubNotifyChannelId: NOTIFY_CHANNEL,
    ...overrides,
  };
}

const auth = { authorization: `Bearer ${API_KEY}` };

describe("API auth", () => {
  it("rejects missing and wrong keys", async () => {
    const app = buildServer({ config: makeConfig(), gateway: makeGateway() });
    expect((await app.inject({ url: "/api/guilds" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/guilds", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });

  it("leaves /health open", async () => {
    const app = buildServer({ config: makeConfig(), gateway: makeGateway() });
    expect((await app.inject({ url: "/health" })).json()).toEqual({ ok: true });
  });
});

describe("read endpoints", () => {
  it("filters guilds by allowlist", async () => {
    const app = buildServer({ config: makeConfig(), gateway: makeGateway() });
    const res = await app.inject({ url: "/api/guilds", headers: auth });
    expect(res.json().guilds.map((g: { id: string }) => g.id)).toEqual([GUILD]);
  });

  it("returns every guild when allowlist is empty", async () => {
    const app = buildServer({ config: makeConfig({ allowedGuildIds: [] }), gateway: makeGateway() });
    const res = await app.inject({ url: "/api/guilds", headers: auth });
    expect(res.json().guilds).toHaveLength(2);
  });

  it("hides channels of non-allowed guilds", async () => {
    const app = buildServer({ config: makeConfig(), gateway: makeGateway() });
    expect((await app.inject({ url: `/api/guilds/${OTHER_GUILD}/channels`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/guilds/${GUILD}/channels`, headers: auth })).statusCode).toBe(200);
  });

  it("fetches messages with pagination params", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig(), gateway });
    const res = await app.inject({
      url: `/api/channels/${CHANNEL}/messages?limit=10&before=999999999999999999`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages[0].content).toBe("PR #3 ready to review");
    expect(gateway.fetchMessages).toHaveBeenCalledWith(CHANNEL, { limit: 10, before: "999999999999999999" });
  });

  it("validates query and params", async () => {
    const app = buildServer({ config: makeConfig(), gateway: makeGateway() });
    const bad = [
      `/api/channels/abc/messages`,
      `/api/channels/${CHANNEL}/messages?limit=500`,
      `/api/channels/${CHANNEL}/messages?before=111111111111111111&after=111111111111111111`,
    ];
    for (const url of bad) expect((await app.inject({ url, headers: auth })).statusCode).toBe(400);
  });

  it("refuses channels in non-allowed guilds", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig(), gateway });
    const res = await app.inject({ url: `/api/channels/${OTHER_CHANNEL}/messages`, headers: auth });
    expect(res.statusCode).toBe(404);
    expect(gateway.fetchMessages).not.toHaveBeenCalled();
  });

  it("renders a plain-text transcript", async () => {
    const app = buildServer({ config: makeConfig(), gateway: makeGateway() });
    const res = await app.inject({ url: `/api/channels/${CHANNEL}/transcript`, headers: auth });
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("[2026-10-27 01:00] Alice (666666666666666666): PR #3 ready to review");
  });
});

describe("write endpoint", () => {
  it("is disabled by default", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig(), gateway });
    const res = await app.inject({
      method: "POST",
      url: `/api/channels/${CHANNEL}/messages`,
      headers: auth,
      payload: { content: "hi" },
    });
    expect(res.statusCode).toBe(403);
    expect(gateway.sendMessage).not.toHaveBeenCalled();
  });

  it("posts when enabled", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig({ enableWrite: true }), gateway });
    const res = await app.inject({
      method: "POST",
      url: `/api/channels/${CHANNEL}/messages`,
      headers: auth,
      payload: { content: "hi" },
    });
    expect(res.statusCode).toBe(201);
    expect(gateway.sendMessage).toHaveBeenCalledWith(CHANNEL, { content: "hi" });
  });
});

describe("GitHub webhook", () => {
  const sign = (body: string) => `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
  const prOpened = JSON.stringify({
    action: "opened",
    repository: { full_name: "team/app" },
    sender: { login: "bob" },
    pull_request: { number: 3, title: "Add login", html_url: "https://github.com/team/app/pull/3", body: "desc" },
  });

  const post = (app: ReturnType<typeof buildServer>, body: string, headers: Record<string, string>) =>
    app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { "content-type": "application/json", ...headers },
      payload: body,
    });

  it("rejects bad signatures", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig(), gateway });
    const res = await post(app, prOpened, { "x-github-event": "pull_request", "x-hub-signature-256": "sha256=deadbeef" });
    expect(res.statusCode).toBe(401);
    expect(gateway.sendMessage).not.toHaveBeenCalled();
  });

  it("relays a PR opened event as an embed", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig(), gateway });
    const res = await post(app, prOpened, { "x-github-event": "pull_request", "x-hub-signature-256": sign(prOpened) });
    expect(res.json()).toEqual({ ok: true, relayed: true });
    expect(gateway.sendMessage).toHaveBeenCalledWith(NOTIFY_CHANNEL, {
      embeds: [
        expect.objectContaining({
          title: "[team/app] PR opened: #3 Add login",
          url: "https://github.com/team/app/pull/3",
          description: "desc",
        }),
      ],
    });
  });

  it("answers ping and ignores unhandled events", async () => {
    const gateway = makeGateway();
    const app = buildServer({ config: makeConfig(), gateway });
    const ping = JSON.stringify({ zen: "hi" });
    expect((await post(app, ping, { "x-github-event": "ping", "x-hub-signature-256": sign(ping) })).json()).toEqual({ ok: true });
    const star = JSON.stringify({ action: "created" });
    expect((await post(app, star, { "x-github-event": "star", "x-hub-signature-256": sign(star) })).statusCode).toBe(202);
    expect(gateway.sendMessage).not.toHaveBeenCalled();
  });

  it("is off when not configured", async () => {
    const app = buildServer({ config: makeConfig({ githubWebhookSecret: undefined }), gateway: makeGateway() });
    expect((await post(app, prOpened, { "x-github-event": "pull_request" })).statusCode).toBe(404);
  });
});
