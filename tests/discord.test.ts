import { afterEach, describe, expect, it } from "vitest";
import { LimitedCollection, type Client } from "discord.js";
import { createDiscordClient } from "../src/discord.js";

describe("createDiscordClient", () => {
  let client: Client | undefined;
  afterEach(async () => {
    await client?.destroy();
  });

  it("disables caches that the API never reads", () => {
    client = createDiscordClient();
    expect(client.users.cache).toBeInstanceOf(LimitedCollection);
    expect((client.users.cache as LimitedCollection<string, unknown>).maxSize).toBe(0);
  });
});
