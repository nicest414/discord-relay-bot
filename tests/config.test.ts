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

it("parses named keys and keeps the single key", () => {
  const config = loadConfig({
    DISCORD_TOKEN: "t",
    API_KEYS: "devin=aaaaaaaaaaaaaaaa,tarou=bbbbbbbbbbbbbbbb",
    API_KEY: "0123456789abcdef",
  });
  expect(config.apiKeys!.map((k) => k.label)).toEqual(["default", "devin", "tarou"]);
});

it("rejects bad labels and short named keys", () => {
  const base = { DISCORD_TOKEN: "t" };
  expect(() => loadConfig(base)).toThrow(/API_KEYS/);
  expect(() => loadConfig({ ...base, API_KEYS: "a b=0123456789abcdef0123" })).toThrow(/bad label/);
  expect(() => loadConfig({ ...base, API_KEYS: "devin=short" })).toThrow(/16 characters/);
  expect(() => loadConfig({ ...base, API_KEYS: "a=0123456789abcdef0123,a=9876543210abcdef9876" })).toThrow(/duplicate/);
});
