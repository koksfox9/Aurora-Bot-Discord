import type { Client } from "discord.js";
import type { PlaybackEvent } from "../domain/types.js";
import { logger } from "../logger.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import { nowPlayingPayload } from "./commands/queueViews.js";
import { escapeAndTruncate } from "./trackText.js";

const PROGRESS_REFRESH_MS = 30_000;
const CHANGE_DEBOUNCE_MS = 1_200;
// Unknown channel, unknown message, missing access, missing permissions.
const GONE_CODES = new Set([10003, 10008, 50001, 50013]);

interface PublisherOptions {
  refreshMs?: number;
  debounceMs?: number;
}

export function installPlaybackEventHandler(client: Client, players: PlayerManager) {
  new NowPlayingPublisher(client, players).install();
}

/**
 * Utrzymuje jedną wiadomość „Teraz gra" na serwer:
 *  - nowy utwór: edycja istniejącej wiadomości (albo wysłanie nowej),
 *  - zmiany (pauza, głośność, pętla, kolejka, seek): odświeżenie po krótkim debounce,
 *  - pasek postępu: odświeżanie co 30 s, tylko gdy utwór faktycznie gra,
 *  - koniec kolejki / rozłączenie: wiadomość zmienia się w stan końcowy z wyłączonymi przyciskami.
 * Wszystkie edycje jednego serwera idą jedna po drugiej, więc wiadomości się nie dublują.
 */
export class NowPlayingPublisher {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly tickers = new Map<string, NodeJS.Timeout>();
  private readonly refreshMs: number;
  private readonly debounceMs: number;

  constructor(
    private readonly client: Client,
    private readonly players: PlayerManager,
    options: PublisherOptions = {}
  ) {
    this.refreshMs = options.refreshMs ?? PROGRESS_REFRESH_MS;
    this.debounceMs = options.debounceMs ?? CHANGE_DEBOUNCE_MS;
  }

  install() {
    this.players.on("playback", (event: PlaybackEvent) => this.handle(event));
  }

  handle(event: PlaybackEvent) {
    const { guildId } = event;
    switch (event.type) {
      case "trackStart":
        this.clearDebounce(guildId);
        this.enqueue(guildId, () => this.announce(guildId));
        this.startTicker(guildId);
        break;
      case "idle":
        this.clearDebounce(guildId);
        this.stopTicker(guildId);
        this.enqueue(guildId, () => this.refresh(guildId));
        break;
      case "settingsChanged":
      case "queueChanged":
        this.scheduleRefresh(guildId);
        break;
      case "error":
        this.enqueue(guildId, () => this.announceError(event));
        break;
      default:
        break;
    }
  }

  private enqueue(guildId: string, task: () => Promise<void>) {
    const previous = this.chains.get(guildId) ?? Promise.resolve();
    const next = previous.then(task).catch((error) => {
      logger.debug("Now-playing update failed", {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    this.chains.set(guildId, next);
    void next.finally(() => {
      if (this.chains.get(guildId) === next) this.chains.delete(guildId);
    });
  }

  private scheduleRefresh(guildId: string) {
    this.clearDebounce(guildId);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(guildId);
      this.enqueue(guildId, () => this.refresh(guildId));
    }, this.debounceMs);
    timer.unref();
    this.debounceTimers.set(guildId, timer);
  }

  private clearDebounce(guildId: string) {
    const timer = this.debounceTimers.get(guildId);
    if (timer) clearTimeout(timer);
    this.debounceTimers.delete(guildId);
  }

  private startTicker(guildId: string) {
    this.stopTicker(guildId);
    const ticker = setInterval(() => {
      const snapshot = this.players.snapshot(guildId);
      if (!snapshot.current) {
        this.stopTicker(guildId);
        return;
      }
      // Pauza i transmisje na żywo nie mają czego odświeżać; zmianę stanu zgłasza osobne zdarzenie.
      if (snapshot.paused || snapshot.current.isLive || !snapshot.current.durationMs) return;
      this.enqueue(guildId, () => this.refresh(guildId));
    }, this.refreshMs);
    ticker.unref();
    this.tickers.set(guildId, ticker);
  }

  private stopTicker(guildId: string) {
    const ticker = this.tickers.get(guildId);
    if (ticker) clearInterval(ticker);
    this.tickers.delete(guildId);
  }

  private async fetchChannel(channelId: string) {
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel) || !("messages" in channel)) return null;
    return channel;
  }

  private async announce(guildId: string) {
    const snapshot = this.players.snapshot(guildId);
    if (!snapshot.textChannelId || !snapshot.current) return;
    const channel = await this.fetchChannel(snapshot.textChannelId);
    if (!channel) return;

    const payload = nowPlayingPayload(snapshot);
    const previous = await this.players.getNowPlayingMessage(guildId);
    if (previous?.channelId === channel.id) {
      try {
        await channel.messages.edit(previous.messageId, payload);
        return;
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    } else if (previous) {
      const oldChannel = await this.fetchChannel(previous.channelId);
      await oldChannel?.messages.delete(previous.messageId).catch(() => undefined);
    }

    const message = await channel.send(payload);
    await this.players.setNowPlayingMessage(guildId, { channelId: channel.id, messageId: message.id });
  }

  private async refresh(guildId: string) {
    const reference = await this.players.getNowPlayingMessage(guildId);
    if (!reference) return;
    const channel = await this.fetchChannel(reference.channelId);
    if (!channel) return;
    try {
      await channel.messages.edit(reference.messageId, nowPlayingPayload(this.players.snapshot(guildId)));
    } catch (error) {
      if (isGone(error)) await this.players.setNowPlayingMessage(guildId, undefined).catch(() => undefined);
      else throw error;
    }
  }

  private async announceError(event: PlaybackEvent) {
    if (!event.track) return;
    const textChannelId = event.snapshot?.textChannelId ?? this.players.snapshot(event.guildId).textChannelId;
    if (!textChannelId) return;
    const channel = await this.fetchChannel(textChannelId);
    await channel?.send(
      `Nie udało się odtworzyć **${escapeAndTruncate(event.track.title, 200)}**. Pomijam ten utwór i próbuję kontynuować.`
    );
  }
}

function isGone(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  return typeof code === "number" && GONE_CODES.has(code);
}
