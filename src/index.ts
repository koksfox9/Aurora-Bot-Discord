import { Client, Events, GatewayIntentBits } from "discord.js";
import { Kazagumo } from "kazagumo";
import { Connectors } from "shoukaku";
import { config } from "./config.js";
import { registerCommands } from "./discord/registerCommands.js";
import { installInteractionHandler } from "./discord/interactionHandler.js";
import { logger } from "./logger.js";
import { PlayerManager } from "./player/PlayerManager.js";
import { SourceRegistry } from "./sources/SourceRegistry.js";
import { SpotifyClient } from "./sources/SpotifyClient.js";
import { ensureDir } from "./utils/fs.js";
import { startWebServer } from "./web/server.js";

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason)
  });
});

async function main() {
  await ensureDir(config.data.dir);

  const spotify = new SpotifyClient(config);
  await spotify.init();
  const sources = new SourceRegistry(spotify);

  await registerCommands(config);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });

  const kazagumo = new Kazagumo(
    {
      defaultSearchEngine: "youtube",
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) void guild.shard.send(payload);
      }
    },
    new Connectors.DiscordJS(client),
    [{
      name: "aurora-local",
      url: `${config.lavalink.host}:${config.lavalink.port}`,
      auth: config.lavalink.password,
      secure: config.lavalink.secure
    }],
    {
      reconnectTries: 120,
      reconnectInterval: 5,
      restTimeout: 45
    }
  );

  kazagumo.shoukaku.on("ready", (name) => logger.info("Lavalink node ready", { name }));
  kazagumo.shoukaku.on("error", (name, error) => logger.error("Lavalink node error", { name, error: error.message }));
  kazagumo.shoukaku.on("close", (name, code, reason) => logger.warn("Lavalink websocket closed", { name, code, reason }));
  kazagumo.shoukaku.on("disconnect", (name, code) => logger.warn("Lavalink node disconnected", { name, code }));
  kazagumo.shoukaku.on("reconnecting", (name, reconnectsLeft, reconnectIntervalSeconds) => {
    logger.warn("Lavalink node reconnecting", { name, reconnectsLeft, reconnectIntervalSeconds });
  });

  let players: PlayerManager | undefined;

  client.once(Events.ClientReady, (readyClient) => {
    logger.info("discord bot ready", { tag: readyClient.user.tag });
    players = new PlayerManager(client, config, kazagumo);
    installInteractionHandler(client, players, sources);
    startWebServer(config, players, sources, client);
  });

  process.once("SIGINT", () => {
    logger.info("shutting down");
    for (const snapshot of players?.snapshots() ?? []) {
      players?.get(snapshot.guildId).disconnect();
    }
    client.destroy();
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    logger.info("shutting down");
    for (const snapshot of players?.snapshots() ?? []) {
      players?.get(snapshot.guildId).disconnect();
    }
    client.destroy();
    process.exit(0);
  });

  await client.login(config.discord.token);
}

main().catch((error) => {
  logger.error("fatal error", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
