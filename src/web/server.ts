import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { Server } from "socket.io";
import { PermissionFlagsBits, type Client, type VoiceBasedChannel } from "discord.js";
import type { AppConfig } from "../config.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import type { SourceRegistry } from "../sources/SourceRegistry.js";
import { assertSingleMediaLink } from "../sources/SourceRegistry.js";
import { logger } from "../logger.js";

export function startWebServer(config: AppConfig, players: PlayerManager, sources: SourceRegistry, client: Client) {
  const app = express();
  const server = http.createServer(app);

  // Callback OAuth Spotify działa zawsze (chroni go jednorazowy `state`).
  app.get("/auth/spotify/callback", async (req, res, next) => {
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code || !state) throw new Error("Missing Spotify OAuth code/state");
      await sources.spotify.finishAuthorization(code, state);
      res.type("html").send("<h1>Spotify polaczone</h1><p>Możesz wrócić do Discorda.</p>");
    } catch (error) {
      next(error);
    }
  });

  // Panel (pliki statyczne, API i Socket.IO) wstaje tylko z ustawionym tokenem – bez niego nic z panelu nie jest wystawione.
  if (config.web.panelToken) {
    mountPanel(app, server, config, players, client);
  } else {
    logger.warn("WEB_PANEL_TOKEN nie jest ustawiony (lub ma wartość z .env.example) – panel webowy wyłączony, działa tylko callback Spotify");
  }

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: error.message });
  });

  server.listen(config.web.port, config.web.host, () => {
    logger.info("web panel ready", { url: `http://${config.web.host}:${config.web.port}`, panelEnabled: Boolean(config.web.panelToken) });
  });

  return server;
}

function mountPanel(app: express.Express, server: http.Server, config: AppConfig, players: PlayerManager, client: Client) {
  // Panel jest serwowany z tego samego origin, więc CORS nie jest potrzebny. WebSocket nie podlega CORS,
  // dlatego dodatkowo odrzucamy połączenia z przeglądarki, których Origin różni się od hosta panelu.
  const io = new Server(server, {
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      try {
        callback(null, new URL(origin).host === req.headers.host);
      } catch {
        callback(null, false);
      }
    }
  });

  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(config.rootDir, "public")));

  app.get("/api/guilds", requirePanelToken(config), (_req, res) => {
    res.json(guildSnapshots(client, players));
  });

  app.get("/api/guilds/:guildId", requirePanelToken(config), (req, res) => {
    res.json(players.snapshot(param(req, "guildId")));
  });

  app.get("/api/guilds/:guildId/voice-channels", requirePanelToken(config), async (req, res, next) => {
    try {
      const guild = await getGuild(client, param(req, "guildId"));
      const channels = await guild.channels.fetch();
      const botMember = guild.members.me;
      const voiceChannels = [...channels.values()].flatMap((channel) => {
        if (!channel?.isVoiceBased()) return [];
        const permissions = channel.permissionsFor(botMember ?? client.user?.id ?? "");
        if (!permissions?.has(PermissionFlagsBits.Connect)) return [];
        return [{ id: channel.id, name: channel.name }];
      });
      res.json(voiceChannels);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/connect", requirePanelToken(config), async (req, res, next) => {
    try {
      const guildId = param(req, "guildId");
      const channelId = String(req.body.channelId ?? "");
      if (!channelId) throw new Error("Wybierz kanal glosowy.");
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isVoiceBased() || channel.guildId !== guildId) {
        throw new Error("Wybrany kanal glosowy nie nalezy do tego serwera.");
      }
      await players.connect(channel as VoiceBasedChannel);
      res.json(players.snapshot(guildId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/play", requirePanelToken(config), async (req, res, next) => {
    try {
      const query = String(req.body.query ?? "").trim();
      if (!query) throw new Error("Brak utworu.");
      const guildId = param(req, "guildId");
      assertSingleMediaLink(query);
      const snapshot = await players.runMediaRequest(guildId, async () => {
        const session = players.get(guildId);
        if (!session.snapshot().connected) throw new Error("Najpierw połącz bota z kanałem głosowym.");
        await session.enqueueQuery(query, { id: "web-panel", username: "Web UI" }, players.queueLimit(guildId));
        return players.snapshot(guildId);
      });
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/radio", requirePanelToken(config), async (req, res, next) => {
    try {
      const url = String(req.body.url ?? "").trim();
      const name = String(req.body.name ?? "").trim() || undefined;
      if (!url) throw new Error("Brak adresu radia.");
      const guildId = param(req, "guildId");
      if (!players.isPremium(guildId)) throw new Error("Radio 24/7 jest dostępne w planie Premium.");
      assertSingleMediaLink(url);
      const snapshot = await players.runMediaRequest(guildId, async () => {
        const session = players.get(guildId);
        if (!session.snapshot().connected) throw new Error("Najpierw połącz bota z kanałem głosowym.");
        await session.setRadio(url, name, { id: "web-panel", username: "Web UI" });
        return players.snapshot(guildId);
      });
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/skip", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.get(guildId).skip();
    res.json(players.snapshot(guildId));
  });

  app.post("/api/guilds/:guildId/shuffle", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.get(guildId).shuffle();
    res.json(players.snapshot(guildId));
  });

  app.post("/api/guilds/:guildId/stop", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    const session = players.get(guildId);
    session.clearQueue();
    session.skip();
    res.json(players.snapshot(guildId));
  });

  app.post("/api/guilds/:guildId/filter", requirePanelToken(config), async (req, res, next) => {
    try {
      if (!players.isPremium(param(req, "guildId"))) throw new Error("Efekty DSP są dostępne w planie Premium.");
      const mode = String(req.body.mode ?? "off");
      if (!["off", "bassboost", "nightcore", "8d"].includes(mode)) throw new Error("Nieznany efekt dźwiękowy.");
      await players.get(param(req, "guildId")).setFilter(mode as "off" | "bassboost" | "nightcore" | "8d");
      res.json(players.snapshot(param(req, "guildId")));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/pause", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.get(guildId).pause();
    res.json(players.snapshot(guildId));
  });

  app.post("/api/guilds/:guildId/resume", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.get(guildId).resume();
    res.json(players.snapshot(guildId));
  });

  app.post("/api/guilds/:guildId/clear", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.get(guildId).clearQueue();
    res.json(players.snapshot(guildId));
  });

  app.post("/api/guilds/:guildId/settings", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    if (req.body.stayInChannel === true && !players.isPremium(guildId)) {
      throw new Error("Tryb 24/7 jest dostępny w planie Premium.");
    }
    players.get(guildId).setSettings({
      volume: typeof req.body.volume === "number" ? req.body.volume : undefined,
      stayInChannel: typeof req.body.stayInChannel === "boolean" ? req.body.stayInChannel : undefined
    });
    res.json(players.snapshot(guildId));
  });

  io.use((socket, next) => {
    if (tokensMatch(socket.handshake.auth?.token, config.web.panelToken)) return next();
    next(new Error("Unauthorized"));
  });

  io.on("connection", (socket) => {
    socket.emit("snapshots", guildSnapshots(client, players));
  });

  players.on("playback", (event) => {
    io.emit("playback", event);
  });

}

function guildSnapshots(client: Client, players: PlayerManager) {
  return [...client.guilds.cache.keys()].map((guildId) => players.snapshot(guildId));
}

async function getGuild(client: Client, guildId: string) {
  return client.guilds.cache.get(guildId) ?? client.guilds.fetch(guildId);
}

function requirePanelToken(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (tokensMatch(req.header("x-panel-token"), config.web.panelToken)) return next();
    res.status(401).json({ error: "Unauthorized" });
  };
}

// Porównanie w stałym czasie (hash wyrównuje długości). Brak tokenu po stronie serwera = zawsze odmowa.
function tokensMatch(provided: unknown, expected: string | undefined) {
  if (typeof provided !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function param(req: Request, name: string) {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
