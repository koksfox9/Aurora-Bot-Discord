import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import { PermissionFlagsBits, type Client, type VoiceBasedChannel } from "discord.js";
import type { AppConfig } from "../config.js";
import type { PlaybackEvent, QueueSnapshot } from "../domain/types.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import type { SpotifyClient } from "../sources/SpotifyClient.js";
import { assertSafePlaybackInput, assertSafeRadioUrl } from "../sources/MediaInputGuard.js";
import { logger } from "../logger.js";

const PANEL_QUEUE_LIMIT = 50;
const PLAYBACK_DEBOUNCE_MS = 100;
const SOCKET_HANDSHAKE_LIMIT = 60;
const SOCKET_HANDSHAKE_WINDOW_MS = 60_000;

export interface WebServerHandle {
  close(): Promise<void>;
}

export function startWebServer(config: AppConfig, players: PlayerManager, spotify: SpotifyClient, client: Client) {
  const app = express();
  const server = http.createServer(app);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "connect-src": ["'self'", "ws:", "wss:"],
          "img-src": ["'self'", "data:", "https:"],
          "upgrade-insecure-requests": null
        }
      }
    })
  );

  app.get("/health", (_req, res) => {
    res.status(client.isReady() ? 200 : 503).json({ status: client.isReady() ? "ok" : "not_ready" });
  });

  // Callback OAuth Spotify działa zawsze (chroni go jednorazowy `state`).
  app.get("/auth/spotify/callback", async (req, res, next) => {
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code || !state) throw new Error("Missing Spotify OAuth code/state");
      await spotify.finishAuthorization(code, state);
      res.type("html").send("<h1>Spotify polaczone</h1><p>Możesz wrócić do Discorda.</p>");
    } catch (error) {
      next(error);
    }
  });

  // Panel (pliki statyczne, API i Socket.IO) wstaje tylko z ustawionym tokenem – bez niego nic z panelu nie jest wystawione.
  const io = config.web.panelToken ? mountPanel(app, server, config, players, client) : undefined;
  if (!config.web.panelToken) {
    logger.warn(
      "WEB_PANEL_TOKEN nie jest ustawiony (lub ma wartość z .env.example) – panel webowy wyłączony, działa tylko callback Spotify"
    );
  }

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const hintedStatus = (error as Error & { status?: unknown }).status;
    const status = typeof hintedStatus === "number" && hintedStatus >= 400 && hintedStatus < 500 ? hintedStatus : 500;
    logger.error("Web request failed", {
      method: _req.method,
      path: _req.path,
      status,
      error: error.message,
      stack: error.stack
    });
    res.status(status).json({ error: status < 500 ? "Nieprawidłowe żądanie." : "Wewnętrzny błąd serwera." });
  });

  server.listen(config.web.port, config.web.host, () => {
    logger.info("web panel ready", {
      url: `http://${config.web.host}:${config.web.port}`,
      panelEnabled: Boolean(config.web.panelToken)
    });
  });

  return {
    close: async () => {
      if (io) {
        await io.close();
        return;
      }
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } satisfies WebServerHandle;
}

function mountPanel(
  app: express.Express,
  server: http.Server,
  config: AppConfig,
  players: PlayerManager,
  client: Client
) {
  // Panel jest serwowany z tego samego origin, więc CORS nie jest potrzebny. WebSocket nie podlega CORS,
  // dlatego dodatkowo odrzucamy połączenia z przeglądarki, których Origin różni się od hosta panelu.
  const socketAttempts = new Map<string, { count: number; resetAt: number }>();
  const io = new Server(server, {
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) return callback(null, false);
        } catch {
          return callback(null, false);
        }
      }
      if (!allowSocketHandshake(socketAttempts, req.socket.remoteAddress ?? "unknown")) return callback(null, false);
      callback(null, true);
    }
  });

  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Limit żądań panelu został przekroczony. Spróbuj ponownie za chwilę." }
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(config.rootDir, "public")));

  app.get("/api/guilds", requirePanelToken(config), (_req, res) => {
    res.json(guildSnapshots(client, players));
  });

  app.get("/api/guilds/:guildId", requirePanelToken(config), (req, res) => {
    res.json(panelSnapshot(players.snapshot(param(req, "guildId"))));
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
      res.json(panelSnapshot(players.snapshot(guildId)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/play", requirePanelToken(config), async (req, res, next) => {
    try {
      const query = String(req.body.query ?? "").trim();
      if (!query) throw new Error("Brak utworu.");
      const guildId = param(req, "guildId");
      assertSafePlaybackInput(query);
      const snapshot = await players.runMediaRequest(guildId, async () => {
        const session = players.getOrCreate(guildId);
        if (!session.snapshot().connected) throw new Error("Najpierw połącz bota z kanałem głosowym.");
        await session.enqueueQuery(query, { id: "web-panel", username: "Web UI" }, players.queueLimit(guildId));
        return players.snapshot(guildId);
      });
      res.json(panelSnapshot(snapshot));
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
      await assertSafeRadioUrl(url, config.media.radioAllowedDomains);
      const snapshot = await players.runMediaRequest(guildId, async () => {
        const session = players.getOrCreate(guildId);
        if (!session.snapshot().connected) throw new Error("Najpierw połącz bota z kanałem głosowym.");
        await session.setRadio(url, name, { id: "web-panel", username: "Web UI" });
        return players.snapshot(guildId);
      });
      res.json(panelSnapshot(snapshot));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/skip", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.getOrCreate(guildId).skip();
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  app.post("/api/guilds/:guildId/shuffle", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.getOrCreate(guildId).shuffle();
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  app.post("/api/guilds/:guildId/stop", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    const session = players.getOrCreate(guildId);
    session.clearQueue();
    session.skip();
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  app.post("/api/guilds/:guildId/filter", requirePanelToken(config), async (req, res, next) => {
    try {
      if (!players.isPremium(param(req, "guildId"))) throw new Error("Efekty DSP są dostępne w planie Premium.");
      const mode = String(req.body.mode ?? "off");
      if (!["off", "bassboost", "nightcore", "8d"].includes(mode)) throw new Error("Nieznany efekt dźwiękowy.");
      await players.getOrCreate(param(req, "guildId")).setFilter(mode as "off" | "bassboost" | "nightcore" | "8d");
      res.json(panelSnapshot(players.snapshot(param(req, "guildId"))));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/guilds/:guildId/pause", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.getOrCreate(guildId).pause();
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  app.post("/api/guilds/:guildId/resume", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.getOrCreate(guildId).resume();
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  app.post("/api/guilds/:guildId/clear", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    players.getOrCreate(guildId).clearQueue();
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  app.post("/api/guilds/:guildId/settings", requirePanelToken(config), (req, res) => {
    const guildId = param(req, "guildId");
    if (req.body.stayInChannel === true && !players.isPremium(guildId)) {
      throw new Error("Tryb 24/7 jest dostępny w planie Premium.");
    }
    players.getOrCreate(guildId).setSettings({
      volume: typeof req.body.volume === "number" ? req.body.volume : undefined,
      stayInChannel: typeof req.body.stayInChannel === "boolean" ? req.body.stayInChannel : undefined
    });
    res.json(panelSnapshot(players.snapshot(guildId)));
  });

  io.use((socket, next) => {
    if (tokensMatch(socket.handshake.auth?.token, config.web.panelToken)) return next();
    next(new Error("Unauthorized"));
  });

  io.on("connection", (socket) => {
    socket.on("guild:subscribe", async (guildId: unknown) => {
      if (typeof guildId !== "string" || !client.guilds.cache.has(guildId)) return;
      const previousGuildId = socket.data.guildId;
      if (typeof previousGuildId === "string" && previousGuildId !== guildId) {
        await socket.leave(guildRoom(previousGuildId));
      }
      socket.data.guildId = guildId;
      await socket.join(guildRoom(guildId));
      socket.emit("playback", { guildId, snapshot: panelSnapshot(players.snapshot(guildId)) });
    });

    socket.on("guild:unsubscribe", async () => {
      const guildId = socket.data.guildId;
      if (typeof guildId !== "string") return;
      await socket.leave(guildRoom(guildId));
      delete socket.data.guildId;
    });
  });

  const pendingPlaybackEvents = new Map<string, PlaybackEvent>();
  const playbackTimers = new Map<string, NodeJS.Timeout>();
  server.once("close", () => {
    for (const timer of playbackTimers.values()) clearTimeout(timer);
    playbackTimers.clear();
    pendingPlaybackEvents.clear();
  });
  players.on("playback", (event) => {
    const guildId = event.guildId;
    pendingPlaybackEvents.set(guildId, event);
    const currentTimer = playbackTimers.get(guildId);
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(() => {
      playbackTimers.delete(guildId);
      const latest = pendingPlaybackEvents.get(guildId);
      pendingPlaybackEvents.delete(guildId);
      if (!latest) return;
      const snapshot = latest.snapshot ?? players.snapshot(guildId);
      io.to(guildRoom(guildId)).emit("playback", { ...latest, snapshot: panelSnapshot(snapshot) });
    }, PLAYBACK_DEBOUNCE_MS);
    timer.unref();
    playbackTimers.set(guildId, timer);
  });

  return io;
}

function allowSocketHandshake(attempts: Map<string, { count: number; resetAt: number }>, ip: string) {
  const now = Date.now();
  let bucket = attempts.get(ip);
  if (bucket && bucket.resetAt <= now) {
    attempts.delete(ip);
    bucket = undefined;
  }
  if (!bucket) {
    if (attempts.size >= 2048) {
      for (const [key, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(key);
      }
      if (attempts.size >= 2048) return false;
    }
    attempts.set(ip, { count: 1, resetAt: now + SOCKET_HANDSHAKE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= SOCKET_HANDSHAKE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

function guildRoom(guildId: string) {
  return `guild:${guildId}`;
}

function guildSnapshots(client: Client, players: PlayerManager) {
  return [...client.guilds.cache.keys()].map((guildId) => panelSnapshot(players.snapshot(guildId)));
}

function panelSnapshot(snapshot: QueueSnapshot): QueueSnapshot {
  return {
    ...snapshot,
    queue: snapshot.queue.slice(0, PANEL_QUEUE_LIMIT),
    queueTotal: snapshot.queueTotal ?? snapshot.queue.length
  };
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
