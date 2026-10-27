import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses lists, booleans and defaults", () => {
    const config = loadConfig({
      DISCORD_TOKEN: "t",
      API_KEY: "0123456789abcdef",
      ALLOWED_GUILD_IDS: " 1, 2 ,,",
      ENABLE_WRITE: "TRUE",
      GITHUB_WEBHOOK_SECRET: "",
    });
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 3000,
      allowedGuildIds: ["1", "2"],
      enableWrite: true,
      githubWebhookSecret: undefined,
    });
  });

  it("rejects short API keys", () => {
    expect(() => loadConfig({ DISCORD_TOKEN: "t", API_KEY: "short" })).toThrow(/API_KEY/);
  });
});
