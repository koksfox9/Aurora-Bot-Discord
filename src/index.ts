import { Client, Events, GatewayIntentBits } from "discord.js";
import { Kazagumo, Plugins } from "kazagumo";
import { Connectors, Constants } from "shoukaku";
import { config } from "./config.js";
import { installInteractionHandler } from "./discord/interactionHandler.js";
import { logger } from "./logger.js";
import { PlayerManager } from "./player/PlayerManager.js";
import { SpotifyClient } from "./sources/SpotifyClient.js";
import { ensureDir } from "./utils/fs.js";
import { startWebServer } from "./web/server.js";

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason)
  });
});

process.on("uncaughtException", (error, origin) => {
  logger.error("uncaught exception; terminating process", {
    origin,
    error: error.message,
    stack: error.stack
  });
  process.exitCode = 1;
  setImmediate(() => process.exit(1));
});

async function main() {
  await ensureDir(config.data.dir);

  const spotify = new SpotifyClient(config);
  await spotify.init();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });

  client.on(Events.Error, (error) => {
    logger.error("Discord client error", { error: error.message, stack: error.stack });
  });
  client.on(Events.ShardError, (error, shardId) => {
    logger.error("Discord shard error", { shardId, error: error.message, stack: error.stack });
  });
  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    logger.warn("Discord shard disconnected", {
      shardId,
      code: closeEvent.code,
      reason: closeEvent.reason,
      wasClean: closeEvent.wasClean
    });
  });

  const kazagumo = new Kazagumo(
    {
      defaultSearchEngine: "youtube",
      plugins: [new Plugins.PlayerMoved(client)],
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) void guild.shard.send(payload);
      }
    },
    new Connectors.DiscordJS(client),
    [
      {
        name: "aurora-local",
        url: `${config.lavalink.host}:${config.lavalink.port}`,
        auth: config.lavalink.password,
        secure: config.lavalink.secure
      }
    ],
    {
      resume: true,
      resumeTimeout: 60,
      resumeByLibrary: true,
      reconnectTries: 120,
      reconnectInterval: 5,
      restTimeout: 15
    }
  );

  kazagumo.shoukaku.on("ready", (name) => logger.info("Lavalink node ready", { name }));
  kazagumo.shoukaku.on("error", (name, error) => logger.error("Lavalink node error", { name, error: error.message }));
  kazagumo.shoukaku.on("close", (name, code, reason) =>
    logger.warn("Lavalink websocket closed", { name, code, reason })
  );
  kazagumo.shoukaku.on("disconnect", (name, code) => logger.warn("Lavalink node disconnected", { name, code }));
  kazagumo.shoukaku.on("reconnecting", (name, reconnectsLeft, reconnectIntervalSeconds) => {
    logger.warn("Lavalink node reconnecting", { name, reconnectsLeft, reconnectIntervalSeconds });
  });

  // Shoukaku stops retrying after reconnectTries is exhausted. Keep checking so
  // a longer Lavalink outage does not leave the bot disconnected indefinitely.
  const nodeRecoveryInterval = setInterval(() => {
    for (const node of kazagumo.shoukaku.nodes.values()) {
      if (node.state !== Constants.State.DISCONNECTED) continue;

      logger.warn("Lavalink node recovery retry", { name: node.name });
      void node.connect().catch((error: unknown) => {
        logger.error("Lavalink node recovery failed", {
          name: node.name,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }
  }, 30_000);
  nodeRecoveryInterval.unref();

  let players: PlayerManager | undefined;
  let webServer: ReturnType<typeof startWebServer> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info("discord bot ready", { tag: readyClient.user.tag });
    players = new PlayerManager(client, config, kazagumo);
    await players.initializeGuildSettings().catch((error: unknown) => {
      logger.error("Could not load saved guild settings", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    });
    installInteractionHandler(client, players, spotify);
    webServer = startWebServer(config, players, spotify, client);
    void players.restoreSavedPlayback().catch((error: unknown) => {
      logger.error("Could not restore saved playback state", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    });
  });

  const shutdown = (signal: NodeJS.Signals) => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        logger.info("shutting down", { signal });
        clearInterval(nodeRecoveryInterval);
        let failed = false;
        const runStep = async (name: string, action: () => Promise<unknown> | void | undefined) => {
          try {
            await action();
          } catch (error) {
            failed = true;
            logger.error(`shutdown step failed: ${name}`, {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            });
          }
        };

        await runStep("HTTP and Socket.IO servers", () => webServer?.close());
        await runStep("Lavalink players", () => players?.shutdown());
        for (const nodeName of [...kazagumo.shoukaku.nodes.keys()]) {
          await runStep(`Lavalink node ${nodeName}`, () => kazagumo.shoukaku.removeNode(nodeName, "Bot shutting down"));
        }
        await runStep("Discord client", () => client.destroy());

        const exitCode = failed ? 1 : 0;
        logger.info("shutdown complete", { exitCode });
        process.exit(exitCode);
      })();
    }
    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").catch((error: unknown) => {
      logger.error("shutdown failed", { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").catch((error: unknown) => {
      logger.error("shutdown failed", { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    });
  });

  await client.login(config.discord.token);
}

main().catch((error) => {
  logger.error("fatal error", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
