import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { formatGithubEvent, verifyGithubSignature, type GithubPayload } from "./github.js";
import { toTranscript } from "./transcript.js";
import type { DiscordGateway } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord ID");

const guildParams = z.object({ guildId: snowflake });
const channelParams = z.object({ channelId: snowflake });
const messagesQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: snowflake.optional(),
    after: snowflake.optional(),
  })
  .refine((q) => !(q.before && q.after), { message: "use either before or after, not both" });
const sendBody = z.object({ content: z.string().min(1).max(2000) });

export type ServerDeps = {
  config: AppConfig;
  gateway: DiscordGateway;
  logger?: boolean;
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  reply.code(400).send({ error: "bad_request", details: result.error.issues.map((i) => i.message) });
  return undefined;
}

export function buildServer({ config, gateway, logger = false }: ServerDeps): FastifyInstance {
  const app = Fastify({ logger });

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const buffer = body as Buffer;
    request.rawBody = buffer;
    if (buffer.length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse(buffer.toString("utf8")));
    } catch {
      const error = new Error("invalid JSON body") as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  const isGuildAllowed = (guildId: string) =>
    config.allowedGuildIds.length === 0 || config.allowedGuildIds.includes(guildId);

  const resolveAllowedChannel = async (channelId: string): Promise<boolean> => {
    const guildId = await gateway.getChannelGuildId(channelId);
    return guildId !== null && isGuildAllowed(guildId);
  };

  const notFound = (reply: FastifyReply) =>
    reply.code(404).send({ error: "not_found", message: "not found or not accessible to the bot" });

  app.get("/health", async () => ({ ok: true }));

  app.register(
    async (api) => {
      api.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
        const header = request.headers.authorization ?? "";
        const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
        if (!token || !safeEqual(token, config.apiKey)) {
          return reply.code(401).send({ error: "unauthorized" });
        }
      });

      api.get("/guilds", async () => {
        const guilds = await gateway.listGuilds();
        return { guilds: guilds.filter((g) => isGuildAllowed(g.id)) };
      });

      api.get("/guilds/:guildId/channels", async (request, reply) => {
        const params = parseOr400(guildParams, request.params, reply);
        if (!params) return reply;
        if (!isGuildAllowed(params.guildId)) return notFound(reply);
        const channels = await gateway.listChannels(params.guildId);
        if (!channels) return notFound(reply);
        return { channels };
      });

      api.get("/channels/:channelId/messages", async (request, reply) => {
        const params = parseOr400(channelParams, request.params, reply);
        const query = params && parseOr400(messagesQuery, request.query, reply);
        if (!params || !query) return reply;
        if (!(await resolveAllowedChannel(params.channelId))) return notFound(reply);
        const messages = await gateway.fetchMessages(params.channelId, query);
        if (!messages) return notFound(reply);
        return { messages };
      });

      api.get("/channels/:channelId/transcript", async (request, reply) => {
        const params = parseOr400(channelParams, request.params, reply);
        const query = params && parseOr400(messagesQuery, request.query, reply);
        if (!params || !query) return reply;
        if (!(await resolveAllowedChannel(params.channelId))) return notFound(reply);
        const messages = await gateway.fetchMessages(params.channelId, query);
        if (!messages) return notFound(reply);
        return reply.type("text/plain; charset=utf-8").send(toTranscript(messages));
      });

      api.get("/channels/:channelId/threads", async (request, reply) => {
        const params = parseOr400(channelParams, request.params, reply);
        if (!params) return reply;
        if (!(await resolveAllowedChannel(params.channelId))) return notFound(reply);
        const threads = await gateway.listThreads(params.channelId);
        if (!threads) return notFound(reply);
        return { threads };
      });

      api.post("/channels/:channelId/messages", async (request, reply) => {
        if (!config.enableWrite) {
          return reply.code(403).send({ error: "write_disabled", message: "set ENABLE_WRITE=true to allow posting" });
        }
        const params = parseOr400(channelParams, request.params, reply);
        const body = params && parseOr400(sendBody, request.body, reply);
        if (!params || !body) return reply;
        if (!(await resolveAllowedChannel(params.channelId))) return notFound(reply);
        const sent = await gateway.sendMessage(params.channelId, { content: body.content });
        if (!sent) return notFound(reply);
        return reply.code(201).send(sent);
      });
    },
    { prefix: "/api" },
  );

  app.post("/webhooks/github", async (request, reply) => {
    const { githubWebhookSecret: secret, githubNotifyChannelId: channelId } = config;
    if (!secret || !channelId) return reply.code(404).send({ error: "github_webhook_not_configured" });

    const signature = request.headers["x-hub-signature-256"];
    if (!verifyGithubSignature(secret, request.rawBody ?? Buffer.alloc(0), typeof signature === "string" ? signature : undefined)) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const event = request.headers["x-github-event"];
    if (event === "ping") return { ok: true };
    if (typeof event !== "string" || !request.body) return reply.code(400).send({ error: "bad_request" });

    const embed = formatGithubEvent(event, request.body as GithubPayload);
    if (!embed) return reply.code(202).send({ ok: true, relayed: false });

    const sent = await gateway.sendMessage(channelId, { embeds: [embed] });
    if (!sent) return reply.code(502).send({ error: "notify_channel_unavailable" });
    return { ok: true, relayed: true };
  });

  return app;
}
