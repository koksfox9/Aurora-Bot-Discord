import { EventEmitter } from "node:events";
import { Events, type Client, type VoiceBasedChannel } from "discord.js";
import type { Kazagumo } from "kazagumo";
import type { AppConfig } from "../config.js";
import type { PlaybackEvent, QueueSnapshot } from "../domain/types.js";
import { GuildAudioSession } from "./GuildAudioSession.js";

export class PlayerManager extends EventEmitter {
  private readonly sessions = new Map<string, GuildAudioSession>();
  private readonly pendingMediaRequests = new Set<string>();

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly kazagumo: Kazagumo
  ) {
    super();
    this.installKazagumoEvents();
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      this.sessions.get(newState.guild.id)?.onVoiceStateChanged();
      if (oldState.guild.id !== newState.guild.id) this.sessions.get(oldState.guild.id)?.onVoiceStateChanged();
    });
  }

  get(guildId: string) {
    let session = this.sessions.get(guildId);
    if (!session) {
      session = new GuildAudioSession(guildId, this.client.user?.id, this.config, this.kazagumo);
      session.on("playback", (event: PlaybackEvent) => this.emit("playback", event));
      this.sessions.set(guildId, session);
    }
    return session;
  }

  async connect(channel: VoiceBasedChannel, textChannelId?: string) {
    const session = this.get(channel.guild.id);
    await session.connect(channel, textChannelId);
    return session;
  }

  isPremium(guildId: string, userId?: string) {
    return this.config.premium.guildIds.has(guildId) || Boolean(userId && this.config.premium.userIds.has(userId));
  }

  queueLimit(guildId: string, userId?: string) {
    return this.isPremium(guildId, userId) ? Number.MAX_SAFE_INTEGER : this.config.premium.freeQueueLimit;
  }

  cooldownMs(guildId: string, userId?: string) {
    return this.isPremium(guildId, userId) ? this.config.premium.premiumCooldownMs : this.config.premium.freeCooldownMs;
  }

  async runMediaRequest<T>(guildId: string, task: () => Promise<T>) {
    if (this.pendingMediaRequests.has(guildId)) {
      throw new Error("Trwa dodawanie poprzedniego utworu. Odczekaj chwilę i powtórz zadanie.");
    }

    this.pendingMediaRequests.add(guildId);
    try {
      return await task();
    } finally {
      this.pendingMediaRequests.delete(guildId);
    }
  }

  snapshots(): QueueSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot());
  }

  snapshot(guildId: string) {
    return this.get(guildId).snapshot();
  }

  private installKazagumoEvents() {
    this.kazagumo.on("playerStart", (player, track) => this.get(player.guildId).onTrackStart(track));
    this.kazagumo.on("playerEnd", (player) => this.get(player.guildId).onTrackEnd());
    this.kazagumo.on("queueUpdate", (player) => this.get(player.guildId).onQueueUpdate());
    this.kazagumo.on("playerEmpty", (player) => this.get(player.guildId).onPlayerEmpty());
    this.kazagumo.on("playerResolveError", (player, track, message) => {
      this.get(player.guildId).onPlayerFailure(message ?? "Nie udało się rozpoznać utworu.", track, true);
    });
    this.kazagumo.on("playerStuck", (player) => {
      this.get(player.guildId).onPlayerFailure("Lavalink wykrył zawieszony strumień.", undefined, true);
    });
    this.kazagumo.on("playerException", (player, data) => {
      const exception = data.exception;
      const detail = exception?.message || exception?.cause || data.type || "błąd źródła audio";
      this.get(player.guildId).onPlayerFailure(`Lavalink: ${detail}`, undefined, true);
    });
    this.kazagumo.on("playerClosed", (player, data) => {
      this.get(player.guildId).onPlayerFailure(`Połączenie Lavalink zamknięte (${data.code}): ${data.reason}`, undefined, true);
    });
  }
}
