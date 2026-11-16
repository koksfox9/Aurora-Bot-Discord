import { EventEmitter } from "node:events";
import { Events, type Client, type VoiceBasedChannel } from "discord.js";
import type { Kazagumo, KazagumoTrack } from "kazagumo";
import type { AppConfig } from "../config.js";
import type { PersistedGuildPlaybackState, PlaybackEvent, QueueSnapshot } from "../domain/types.js";
import { logger } from "../logger.js";
import { AutocompleteSearchCache } from "../discord/AutocompleteSearchCache.js";
import { readJsonFile, writeJsonFileAtomic } from "../utils/fs.js";
import { GuildAudioSession } from "./GuildAudioSession.js";

interface MediaRequestQueue {
  tail: Promise<void>;
  pending: number;
}

interface PlaybackStateDocument {
  version: 1;
  guilds: Record<string, PersistedGuildPlaybackState>;
}

interface GuildSettingsDocument {
  version: 1;
  guilds: Record<
    string,
    {
      djRoleId?: string;
      defaultVolume?: number;
      textChannelId?: string;
      stayInVoiceChannelId?: string;
      nowPlayingMessage?: { channelId: string; messageId: string };
    }
  >;
}

export class PlayerManager extends EventEmitter {
  private readonly autocompleteSearches = new AutocompleteSearchCache<KazagumoTrack[]>();
  private readonly sessions = new Map<string, GuildAudioSession>();
  private readonly mediaRequestQueues = new Map<string, MediaRequestQueue>();
  private persistedGuilds: Record<string, PersistedGuildPlaybackState> = {};
  private playbackSaveTimer?: NodeJS.Timeout;
  private playbackWrite: Promise<void> = Promise.resolve();
  private restoreTask?: Promise<void>;
  private restoringPlaybackState = false;
  private shuttingDown = false;
  private guildSettings: GuildSettingsDocument = { version: 1, guilds: {} };
  private guildSettingsLoad?: Promise<void>;
  private guildSettingsWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly kazagumo: Kazagumo
  ) {
    super();
    this.installKazagumoEvents();
    client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      const botUserId = client.user?.id;
      if (botUserId && newState.id === botUserId) {
        this.sessions.get(newState.guild.id)?.onBotVoiceChannelChanged(newState.channel ?? undefined);
        return;
      }
      this.sessions.get(newState.guild.id)?.onVoiceStateChanged();
      if (oldState.guild.id !== newState.guild.id) this.sessions.get(oldState.guild.id)?.onVoiceStateChanged();
    });
  }

  get(guildId: string) {
    return this.sessions.get(guildId);
  }

  getOrCreate(guildId: string) {
    if (!this.client.guilds.cache.has(guildId)) throw new Error("Serwer nie jest dostępny.");
    let session = this.sessions.get(guildId);
    if (!session) {
      session = new GuildAudioSession(
        guildId,
        this.client.user?.id,
        this.config,
        this.kazagumo,
        this.guildSettings.guilds[guildId]?.defaultVolume ?? this.config.playback.defaultVolume
      );
      session.on("playback", (event: PlaybackEvent) => {
        this.emit("playback", event);
        if (!this.restoringPlaybackState && !this.shuttingDown) this.schedulePlaybackStateSave();
      });
      this.sessions.set(guildId, session);
    }
    return session;
  }

  async connect(channel: VoiceBasedChannel, textChannelId?: string) {
    const session = this.getOrCreate(channel.guild.id);
    await this.loadGuildSettings();
    await session.connect(channel, this.guildSettings.guilds[channel.guild.id]?.textChannelId ?? textChannelId);
    return session;
  }

  isPremium(guildId: string, userId?: string) {
    return this.config.premium.guildIds.has(guildId) || Boolean(userId && this.config.premium.userIds.has(userId));
  }

  async getDjRoleId(guildId: string) {
    await this.loadGuildSettings();
    return this.guildSettings.guilds[guildId]?.djRoleId;
  }

  initializeGuildSettings() {
    return this.loadGuildSettings();
  }

  async setDjRoleId(guildId: string, roleId?: string) {
    await this.loadGuildSettings();
    if (roleId) this.guildSettings.guilds[guildId] = { ...this.guildSettings.guilds[guildId], djRoleId: roleId };
    else if (this.guildSettings.guilds[guildId]) {
      delete this.guildSettings.guilds[guildId].djRoleId;
      if (Object.keys(this.guildSettings.guilds[guildId]).length === 0) delete this.guildSettings.guilds[guildId];
    }
    const document = { version: 1 as const, guilds: { ...this.guildSettings.guilds } };
    const write = this.guildSettingsWrite
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(this.config.data.guildSettingsFile, document));
    this.guildSettingsWrite = write;
    await write;
  }

  async setGuildDefaultVolume(guildId: string, volume: number) {
    await this.loadGuildSettings();
    this.guildSettings.guilds[guildId] = {
      ...this.guildSettings.guilds[guildId],
      defaultVolume: Math.max(0.01, Math.min(1, volume))
    };
    const document = { version: 1 as const, guilds: { ...this.guildSettings.guilds } };
    const write = this.guildSettingsWrite
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(this.config.data.guildSettingsFile, document));
    this.guildSettingsWrite = write;
    await write;
  }

  async setGuildTextChannelId(guildId: string, channelId?: string) {
    await this.loadGuildSettings();
    if (channelId)
      this.guildSettings.guilds[guildId] = { ...this.guildSettings.guilds[guildId], textChannelId: channelId };
    else if (this.guildSettings.guilds[guildId]) {
      delete this.guildSettings.guilds[guildId].textChannelId;
      if (Object.keys(this.guildSettings.guilds[guildId]).length === 0) delete this.guildSettings.guilds[guildId];
    }
    this.sessions.get(guildId)?.setAnnouncementChannel(channelId);
    const document = { version: 1 as const, guilds: { ...this.guildSettings.guilds } };
    const write = this.guildSettingsWrite
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(this.config.data.guildSettingsFile, document));
    this.guildSettingsWrite = write;
    await write;
  }

  async getGuild24hChannelId(guildId: string) {
    await this.loadGuildSettings();
    return this.guildSettings.guilds[guildId]?.stayInVoiceChannelId;
  }

  async setGuild24hChannelId(guildId: string, channelId?: string) {
    await this.loadGuildSettings();
    if (channelId)
      this.guildSettings.guilds[guildId] = { ...this.guildSettings.guilds[guildId], stayInVoiceChannelId: channelId };
    else if (this.guildSettings.guilds[guildId]) {
      delete this.guildSettings.guilds[guildId].stayInVoiceChannelId;
      if (Object.keys(this.guildSettings.guilds[guildId]).length === 0) delete this.guildSettings.guilds[guildId];
    }
    const document = { version: 1 as const, guilds: { ...this.guildSettings.guilds } };
    const write = this.guildSettingsWrite
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(this.config.data.guildSettingsFile, document));
    this.guildSettingsWrite = write;
    await write;
  }

  async getNowPlayingMessage(guildId: string) {
    await this.loadGuildSettings();
    return this.guildSettings.guilds[guildId]?.nowPlayingMessage;
  }

  async setNowPlayingMessage(guildId: string, message?: { channelId: string; messageId: string }) {
    await this.loadGuildSettings();
    if (message)
      this.guildSettings.guilds[guildId] = { ...this.guildSettings.guilds[guildId], nowPlayingMessage: message };
    else if (this.guildSettings.guilds[guildId]) {
      delete this.guildSettings.guilds[guildId].nowPlayingMessage;
      if (Object.keys(this.guildSettings.guilds[guildId]).length === 0) delete this.guildSettings.guilds[guildId];
    }
    const document = { version: 1 as const, guilds: { ...this.guildSettings.guilds } };
    const write = this.guildSettingsWrite
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(this.config.data.guildSettingsFile, document));
    this.guildSettingsWrite = write;
    await write;
  }

  queueLimit(guildId: string, userId?: string) {
    return this.isPremium(guildId, userId) ? this.config.premium.premiumQueueLimit : this.config.premium.freeQueueLimit;
  }

  async searchAutocompleteTracks(query: string, requester: { id: string; username: string }): Promise<KazagumoTrack[]> {
    const tracks = await this.autocompleteSearches.get(query, requester.id, async () => {
      let timeout: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Autocomplete search timed out")), 1800);
        timeout.unref();
      });
      try {
        const result = await Promise.race([this.kazagumo.search(`ytmsearch:${query}`, { requester }), timeoutPromise]);
        return result.tracks.slice(0, 25);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });
    return tracks ?? [];
  }

  async resolveSearchTrack(query: string, requester: { id: string; username: string }): Promise<KazagumoTrack> {
    const searchQuery = /^https?:\/\//i.test(query) ? query : `ytmsearch:${query}`;
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Wyszukiwanie trwało zbyt długo.")), 12_000);
      timeout.unref();
    });
    try {
      const result = await Promise.race([this.kazagumo.search(searchQuery, { requester }), timeoutPromise]);
      const track = result.tracks[0];
      if (!track) throw new Error("Nie znaleziono tego utworu.");
      return track;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  cooldownMs(guildId: string, userId?: string) {
    return this.isPremium(guildId, userId) ? this.config.premium.premiumCooldownMs : this.config.premium.freeCooldownMs;
  }

  async runMediaRequest<T>(guildId: string, task: () => Promise<T>) {
    if (this.restoreTask && this.restoringPlaybackState) await this.restoreTask;
    if (this.shuttingDown) throw new Error("Bot jest wyłączany. Spróbuj ponownie za chwilę.");
    return this.enqueueMediaRequest(guildId, task);
  }

  private async enqueueMediaRequest<T>(guildId: string, task: () => Promise<T>) {
    let queue = this.mediaRequestQueues.get(guildId);
    if (!queue) {
      queue = { tail: Promise.resolve(), pending: 0 };
      this.mediaRequestQueues.set(guildId, queue);
    }
    if (queue.pending >= 20) throw new Error("Kolejka żądań tego serwera jest pełna. Spróbuj ponownie za chwilę.");

    queue.pending += 1;
    const request = queue.tail.then(task);
    queue.tail = request.then(
      () => undefined,
      () => undefined
    );
    try {
      return await request;
    } finally {
      queue.pending -= 1;
      if (queue.pending === 0 && this.mediaRequestQueues.get(guildId) === queue) {
        this.mediaRequestQueues.delete(guildId);
      }
    }
  }

  snapshots(): QueueSnapshot[] {
    return [...this.sessions.values()].map((session) => session.snapshot());
  }

  restoreSavedPlayback() {
    if (!this.restoreTask) {
      this.restoringPlaybackState = true;
      this.restoreTask = this.loadAndRestorePlaybackState();
    }
    return this.restoreTask;
  }

  async shutdown() {
    this.shuttingDown = true;
    await this.restoreTask?.catch(() => undefined);
    await Promise.all([...this.mediaRequestQueues.values()].map((queue) => queue.tail));
    await this.persistPlaybackState();
    const results = await Promise.allSettled([...this.sessions.values()].map((session) => session.disconnect()));
    const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (errors.length > 0) throw new AggregateError(errors, "Some Lavalink players could not be destroyed cleanly.");
  }

  snapshot(guildId: string) {
    const session = this.sessions.get(guildId);
    if (session) return session.snapshot();
    return {
      guildId,
      connected: false,
      paused: false,
      positionMs: 0,
      loop: "none" as const,
      queue: [],
      queueTotal: 0,
      history: [],
      settings: { volume: this.config.playback.defaultVolume, stayInChannel: false, autoplay: false }
    };
  }

  private async loadAndRestorePlaybackState() {
    await this.loadGuildSettings();
    let saved: PlaybackStateDocument;
    try {
      saved = await readJsonFile<PlaybackStateDocument>(this.config.data.playbackStateFile, { version: 1, guilds: {} });
    } catch (error) {
      logger.error("Could not read saved playback state", {
        error: error instanceof Error ? error.message : String(error)
      });
      this.restoringPlaybackState = false;
      return;
    }

    if (
      !saved ||
      typeof saved !== "object" ||
      saved.version !== 1 ||
      !saved.guilds ||
      typeof saved.guilds !== "object" ||
      Array.isArray(saved.guilds)
    ) {
      logger.warn("Saved playback state has an unsupported or invalid format");
      this.restoringPlaybackState = false;
      return;
    }
    this.persistedGuilds = saved.guilds;

    try {
      for (const [guildId, state] of Object.entries(saved.guilds)) {
        if (!state || typeof state.voiceChannelId !== "string" || !Array.isArray(state.queue) || !state.settings) {
          logger.warn("Skipping invalid saved playback state", { guildId });
          continue;
        }
        try {
          const channel = await this.client.channels.fetch(state.voiceChannelId);
          if (!channel?.isVoiceBased() || channel.guildId !== guildId) {
            logger.warn("Skipping saved playback because its voice channel is unavailable", {
              guildId,
              channelId: state.voiceChannelId
            });
            continue;
          }
          const session = this.getOrCreate(guildId);
          const configuredTextChannel = this.guildSettings.guilds[guildId]?.textChannelId;
          await this.enqueueMediaRequest(guildId, () =>
            session.restore({ ...state, textChannelId: configuredTextChannel ?? state.textChannelId }, channel)
          );
          logger.info("Restored saved playback state", {
            guildId,
            queuedTracks: state.queue.length,
            hasRadio: Boolean(state.radio)
          });
        } catch (error) {
          logger.warn("Could not restore saved playback for guild", {
            guildId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      this.restoringPlaybackState = false;
      try {
        await this.persistPlaybackState();
      } catch (error) {
        logger.error("Could not save playback state after restore", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async loadGuildSettings() {
    if (!this.guildSettingsLoad) {
      this.guildSettingsLoad = (async () => {
        try {
          const saved = await readJsonFile<GuildSettingsDocument>(this.config.data.guildSettingsFile, {
            version: 1,
            guilds: {}
          });
          if (
            saved?.version === 1 &&
            saved.guilds &&
            typeof saved.guilds === "object" &&
            !Array.isArray(saved.guilds)
          ) {
            const guilds: GuildSettingsDocument["guilds"] = {};
            for (const [guildId, settings] of Object.entries(saved.guilds)) {
              if (!settings || typeof settings !== "object") continue;
              const djRoleId = typeof settings.djRoleId === "string" ? settings.djRoleId : undefined;
              const textChannelId = typeof settings.textChannelId === "string" ? settings.textChannelId : undefined;
              const stayInVoiceChannelId =
                typeof settings.stayInVoiceChannelId === "string" ? settings.stayInVoiceChannelId : undefined;
              const savedMessage = settings.nowPlayingMessage;
              const nowPlayingMessage =
                savedMessage && typeof savedMessage.channelId === "string" && typeof savedMessage.messageId === "string"
                  ? { channelId: savedMessage.channelId, messageId: savedMessage.messageId }
                  : undefined;
              const defaultVolume =
                typeof settings.defaultVolume === "number" && Number.isFinite(settings.defaultVolume)
                  ? Math.max(0.01, Math.min(1, settings.defaultVolume))
                  : undefined;
              if (
                djRoleId ||
                textChannelId ||
                stayInVoiceChannelId ||
                nowPlayingMessage ||
                defaultVolume !== undefined
              ) {
                guilds[guildId] = { djRoleId, defaultVolume, textChannelId, stayInVoiceChannelId, nowPlayingMessage };
              }
            }
            this.guildSettings = { version: 1, guilds };
          }
        } catch (error) {
          logger.warn("Could not read saved guild settings; using defaults", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    }
    await this.guildSettingsLoad;
  }

  private schedulePlaybackStateSave() {
    if (this.playbackSaveTimer) clearTimeout(this.playbackSaveTimer);
    this.playbackSaveTimer = setTimeout(() => {
      this.playbackSaveTimer = undefined;
      void this.persistPlaybackState().catch((error: unknown) => {
        logger.error("Could not save playback state", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, 500);
    this.playbackSaveTimer.unref();
  }

  private async persistPlaybackState() {
    if (this.playbackSaveTimer) clearTimeout(this.playbackSaveTimer);
    this.playbackSaveTimer = undefined;
    for (const [guildId, session] of this.sessions) {
      const snapshot = session.snapshot();
      const hasRestorableState = Boolean(
        snapshot.voiceChannelId &&
        (snapshot.current || snapshot.queue.length > 0 || snapshot.radio || snapshot.settings.stayInChannel)
      );
      if (!hasRestorableState || !snapshot.voiceChannelId) {
        delete this.persistedGuilds[guildId];
        continue;
      }
      this.persistedGuilds[guildId] = {
        voiceChannelId: snapshot.voiceChannelId,
        textChannelId: snapshot.textChannelId,
        current: snapshot.current,
        queue: snapshot.queue,
        loop: snapshot.loop,
        settings: snapshot.settings,
        radio: snapshot.radio
      };
    }

    const document: PlaybackStateDocument = { version: 1, guilds: { ...this.persistedGuilds } };
    const write = this.playbackWrite
      .catch(() => undefined)
      .then(() => writeJsonFileAtomic(this.config.data.playbackStateFile, document));
    this.playbackWrite = write;
    await write;
  }

  private installKazagumoEvents() {
    this.kazagumo.on("playerMoved", (player, state, channels) => {
      const session = this.sessions.get(player.guildId);
      if (!session) return;
      const channel = channels.newChannelId
        ? this.client.guilds.cache.get(player.guildId)?.channels.cache.get(channels.newChannelId)
        : undefined;
      session.onPlayerMoved(state, channel?.isVoiceBased() ? channel : undefined);
    });
    this.kazagumo.on("playerDestroy", (player) => {
      this.sessions.get(player.guildId)?.onPlayerDestroyed(player);
    });
    this.kazagumo.on("playerStart", (player, track) => this.sessions.get(player.guildId)?.onTrackStart(track));
    this.kazagumo.on("playerEnd", (player) => this.sessions.get(player.guildId)?.onTrackEnd());
    this.kazagumo.on("queueUpdate", (player) => this.sessions.get(player.guildId)?.onQueueUpdate());
    this.kazagumo.on("playerEmpty", (player) => this.sessions.get(player.guildId)?.onPlayerEmpty());
    this.kazagumo.on("playerResolveError", (player, track, message) => {
      this.sessions.get(player.guildId)?.onPlayerFailure(message ?? "Nie udało się rozpoznać utworu.", track, true);
    });
    this.kazagumo.on("playerStuck", (player) => {
      this.sessions.get(player.guildId)?.onPlayerFailure("Lavalink wykrył zawieszony strumień.", undefined, true);
    });
    this.kazagumo.on("playerException", (player, data) => {
      const exception = data.exception;
      const detail = exception?.message || exception?.cause || data.type || "błąd źródła audio";
      this.sessions.get(player.guildId)?.onPlayerFailure(`Lavalink: ${detail}`, undefined, true);
    });
    this.kazagumo.on("playerClosed", (player, data) => {
      this.sessions
        .get(player.guildId)
        ?.onPlayerFailure(`Połączenie Lavalink zamknięte (${data.code}): ${data.reason}`, undefined, true);
    });
  }
}
