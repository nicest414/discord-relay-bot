import "dotenv/config";
import { Events } from "discord.js";
import { loadConfig } from "./config.js";
import { DiscordJsGateway, createDiscordClient } from "./discord.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const client = createDiscordClient();
const app = buildServer({ config, gateway: new DiscordJsGateway(client), logger: true });

client.once(Events.ClientReady, (ready) => {
  app.log.info(`Discord: logged in as ${ready.user.tag} (${ready.guilds.cache.size} servers)`);
});

await client.login(config.discordToken);
await app.listen({ host: config.host, port: config.port });

const shutdown = async () => {
  await app.close();
  await client.destroy();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
