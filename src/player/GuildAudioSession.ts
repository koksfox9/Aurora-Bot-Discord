import { EventEmitter } from "node:events";
import { PermissionFlagsBits, type VoiceBasedChannel } from "discord.js";
import { PlayerState, type Kazagumo, type KazagumoPlayer, type KazagumoTrack } from "kazagumo";
import type { FilterOptions } from "shoukaku";
import type { AppConfig } from "../config.js";
import type { PlaybackEvent, PlaybackSettings, QueueSnapshot, Track } from "../domain/types.js";
import { logger } from "../logger.js";

type Requester = { id: string; username: string };

export class GuildAudioSession extends EventEmitter {
  private player?: KazagumoPlayer;
  private current?: Track;
  private radio?: Track;
  private voiceChannel?: VoiceBasedChannel;
  private textChannelId?: string;
  private readonly history: Track[] = [];
  private readonly recoveredTrackIds = new Map<string, number>();
  private lastFailureSkip?: { trackId: string; at: number };
  private readonly settings: PlaybackSettings;
  private idleTimer?: NodeJS.Timeout;
  private connectTask?: Promise<void>;

  constructor(
    readonly guildId: string,
    private readonly botUserId: string | undefined,
    private readonly config: AppConfig,
    private readonly kazagumo: Kazagumo
  ) {
    super();
    this.settings = {
      volume: config.playback.defaultVolume,
      stayInChannel: false
    };
  }

  async connect(channel: VoiceBasedChannel, textChannelId?: string) {
    this.textChannelId = textChannelId ?? this.textChannelId;
    this.voiceChannel = channel;
    if (this.connectTask) await this.connectTask;

    const botMember = channel.guild.members.me;
    const permissions = channel.permissionsFor(botMember ?? this.botUserId ?? "");
    if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
      throw new Error("Bot potrzebuje uprawnień Połącz i Mów na tym kanale głosowym.");
    }

    const task = (async () => {
      let player = this.kazagumo.getPlayer(this.guildId);
      if (!player || player.state === PlayerState.DESTROYED || player.state === PlayerState.DESTROYING) {
        player = await this.kazagumo.createPlayer({
          guildId: this.guildId,
          voiceId: channel.id,
          textId: this.textChannelId,
          volume: Math.round(this.settings.volume * 100),
          deaf: false
        });
      } else {
        if (this.textChannelId) player.setTextChannel(this.textChannelId);
        if (player.voiceId !== channel.id) player.setVoiceChannel(channel.id);
        else if (player.state === PlayerState.DISCONNECTED) player.connect();
      }

      this.player = player;
      // createPlayer already awaits the voice handshake; Kazagumo's state stays CONNECTING here.
      this.clearIdleTimer();
      this.emitPlayback("settingsChanged");
    })();

    this.connectTask = task;
    try {
      await task;
    } finally {
      if (this.connectTask === task) this.connectTask = undefined;
    }
  }

  async enqueueQuery(query: string, requester: Requester, maxQueue: number) {
    const player = this.requirePlayer();
    const available = Math.max(0, maxQueue - player.queue.size);
    if (available === 0) throw new Error(`Kolejka osiągnęła limit ${maxQueue} utworów.`);

    const startedAt = Date.now();
    const searchQuery = classifySearchInput(query) === "text-search" ? `ytmsearch:${query}` : query;
    const result = await this.kazagumo.search(searchQuery, { requester }).catch((error: unknown) => {
      logger.warn("Lavalink search request failed", {
        guildId: this.guildId,
        inputType: classifySearchInput(query),
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : typeof error
      });
      throw new Error("Lavalink nie odpowiedział na wyszukiwanie. Spróbuj ponownie za chwilę.");
    });
    const tracks = result.tracks.slice(0, available);
    logger.info("Lavalink search completed", {
      guildId: this.guildId,
      inputType: classifySearchInput(query),
      loadType: String(result.type),
      trackCount: result.tracks.length,
      durationMs: Date.now() - startedAt
    });
    if (tracks.length === 0) {
      const loadType = String(result.type).toLowerCase();
      if (loadType.includes("error")) {
        logger.warn("Lavalink search returned a load error", {
          guildId: this.guildId,
          inputType: classifySearchInput(query),
          loadType
        });
        throw new Error("Lavalink nie mógł załadować tego źródła. Sprawdź link albo spróbuj innego utworu.");
      }
      throw new Error("Nie znaleziono utworu. Sprawdź link lub spróbuj dokładniejszej frazy.");
    }

    player.queue.add(tracks);
    const added = tracks.map((track) => this.toTrack(track));
    if (!player.playing && !player.paused) await player.play();
    this.clearIdleTimer();
    this.emitPlayback("queueChanged");
    return { tracks: added, truncated: result.tracks.length > tracks.length };
  }

  async enqueueSpotifyTracks(tracks: Track[], requester: Requester, maxQueue: number) {
    const player = this.requirePlayer();
    const available = Math.max(0, maxQueue - player.queue.size);
    if (available === 0) throw new Error(`Kolejka osiągnęła limit ${maxQueue} utworów.`);
    const candidates = tracks.slice(0, available);
    const resolved: KazagumoTrack[] = new Array(candidates.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (nextIndex < candidates.length) {
        const index = nextIndex++;
        const item = candidates[index];
        const uri = item.spotify?.externalUrl ?? item.webpageUrl;
        if (!uri) continue;
        try {
          const result = await this.kazagumo.search(uri, { requester });
          if (result.tracks[0]) resolved[index] = result.tracks[0];
        } catch (error) {
          logger.warn("Spotify playlist item could not be resolved by Lavalink", {
            guildId: this.guildId,
            title: item.title,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });
    await Promise.all(workers);

    const playable = resolved.filter((track): track is KazagumoTrack => Boolean(track));
    if (playable.length === 0) throw new Error("Lavalink nie znalazł odtwarzalnych utworów z tej playlisty Spotify.");
    player.queue.add(playable);
    if (!player.playing && !player.paused) await player.play();
    this.clearIdleTimer();
    this.emitPlayback("queueChanged");
    return { added: playable.length, omitted: tracks.length - playable.length };
  }

  async setRadio(url: string, name: string | undefined, requester: Requester) {
    const player = this.requirePlayer();
    const result = await this.kazagumo.search(url, { requester });
    const track = result.tracks[0];
    if (!track) throw new Error("Lavalink nie rozpoznał adresu radia. Użyj bezpośredniego URL do strumienia audio.");

    const current = player.queue.current;
    player.queue.clear();
    player.setLoop("track");
    this.radio = this.toTrack(track);
    if (name?.trim()) this.radio.title = name.trim();
    this.settings.stayInChannel = true;
    if (current?.identifier === track.identifier) {
      this.radio = this.toTrack(current);
      if (name?.trim()) this.radio.title = name.trim();
    } else {
      player.queue.add(track);
      if (current) player.skip();
      else if (!player.playing && !player.paused) await player.play();
    }
    this.clearIdleTimer();
    this.emitPlayback("queueChanged");
    return this.radio;
  }

  clearQueue() {
    this.player?.queue.clear();
    this.radio = undefined;
    this.player?.setLoop("none");
    this.emitPlayback("queueChanged");
  }

  skip() {
    if (!this.player?.queue.current) return false;
    this.player.skip();
    return true;
  }

  pause() {
    if (!this.player?.queue.current || this.player.paused) return false;
    this.player.pause(true);
    this.emitPlayback("settingsChanged");
    return true;
  }

  resume() {
    if (!this.player?.paused) return false;
    this.player.pause(false);
    this.emitPlayback("settingsChanged");
    return true;
  }

  disconnect() {
    this.clearIdleTimer();
    const player = this.player ?? this.kazagumo.getPlayer(this.guildId);
    this.player = undefined;
    this.current = undefined;
    this.radio = undefined;
    this.voiceChannel = undefined;
    this.settings.stayInChannel = false;
    if (player) void player.destroy();
    this.emitPlayback("idle");
  }

  setSettings(settings: Partial<PlaybackSettings>) {
    if (settings.volume !== undefined) {
      this.settings.volume = Math.max(0, Math.min(1, settings.volume));
      if (this.player) void this.player.setVolume(Math.round(this.settings.volume * 100));
    }
    if (settings.stayInChannel !== undefined) {
      this.settings.stayInChannel = settings.stayInChannel;
      if (settings.stayInChannel) this.clearIdleTimer();
      else this.onVoiceStateChanged();
    }
    this.emitPlayback("settingsChanged");
  }

  setLoop(mode: "none" | "queue" | "track") {
    this.requirePlayer().setLoop(mode);
    this.emitPlayback("settingsChanged");
  }

  async seek(seconds: number) {
    const player = this.requirePlayer();
    const current = player.queue.current;
    if (!current) throw new Error("Nic teraz nie gra.");
    if (current.isStream || !current.isSeekable) throw new Error("Tego utworu nie można przewijać.");
    // Kazagumo/Lavalink oczekują pozycji w milisekundach.
    const targetMs = Math.max(0, Math.min(seconds * 1000, current.length ?? 0));
    await player.seek(targetMs);
    return Math.floor(targetMs / 1000);
  }

  async setFilter(mode: "off" | "bassboost" | "nightcore" | "8d") {
    const filters: FilterOptions = {
      equalizer: [],
      timescale: null,
      rotation: null,
      ...(mode === "bassboost" && {
        equalizer: [{ band: 0, gain: 0.18 }, { band: 1, gain: 0.16 }, { band: 2, gain: 0.12 }, { band: 3, gain: 0.08 }]
      }),
      ...(mode === "nightcore" && { timescale: { speed: 1.15, pitch: 1.15, rate: 1 } }),
      ...(mode === "8d" && { rotation: { rotationHz: 0.2 } })
    };
    await this.requirePlayer().shoukaku.setFilters(filters);
    this.emitPlayback("settingsChanged");
  }

  shuffle() {
    const player = this.requirePlayer();
    player.queue.shuffle();
    this.emitPlayback("queueChanged");
  }

  snapshot(): QueueSnapshot {
    const player = this.player ?? this.kazagumo.getPlayer(this.guildId);
    const current = player?.queue.current;
    const queued = player ? [...player.queue].map((track) => this.toTrack(track)) : [];
    const mappedCurrent = current ? this.toTrack(current) : this.current;
    const currentTrack = mappedCurrent && mappedCurrent.id === this.radio?.id ? this.radio : mappedCurrent;
    return {
      guildId: this.guildId,
      voiceChannelId: player?.voiceId ?? this.voiceChannel?.id,
      textChannelId: player?.textId ?? this.textChannelId,
      connected: Boolean(player?.state === PlayerState.CONNECTED && player.voiceId === this.voiceChannel?.id),
      paused: Boolean(player?.paused),
      current: currentTrack,
      positionMs: player?.position ?? 0,
      loop: player?.loop ?? "none",
      next: queued[0] ?? (currentTrack?.id !== this.radio?.id ? this.radio : undefined),
      queue: queued,
      history: this.history.slice(-10).reverse(),
      settings: { ...this.settings },
      radio: this.radio
    };
  }

  onTrackStart(track: KazagumoTrack) {
    this.clearIdleTimer();
    const mapped = this.toTrack(track);
    this.current = mapped.id === this.radio?.id ? this.radio : mapped;
    this.emitPlayback("trackStart", this.current);
  }

  onTrackEnd() {
    if (this.current && this.current.id !== this.radio?.id) {
      this.history.push(this.current);
      if (this.history.length > 50) this.history.shift();
    }
    const ended = this.current;
    this.current = undefined;
    this.emitPlayback("trackEnd", ended);
  }

  onQueueUpdate() {
    this.emitPlayback("queueChanged");
  }

  onPlayerEmpty() {
    this.emitPlayback("idle");
    this.scheduleIdleDisconnect();
  }

  onPlayerFailure(message: string, track?: KazagumoTrack, skip = false) {
    const now = Date.now();
    for (const [id, expiry] of this.recoveredTrackIds) {
      if (expiry <= now) this.recoveredTrackIds.delete(id);
    }

    const activeTrack = this.player?.queue.current;
    const reportedId = track?.identifier;
    const activeId = activeTrack?.identifier;
    const sameFailure = Boolean(reportedId && this.recoveredTrackIds.has(reportedId));
    const delayedDuplicate = Boolean(
      !reportedId && this.lastFailureSkip && now - this.lastFailureSkip.at < 2500 && activeId !== this.lastFailureSkip.trackId
    );
    if (skip && (sameFailure || delayedDuplicate)) return;

    const failed = track ? this.toTrack(track) : this.current;
    logger.warn("Lavalink playback error", { guildId: this.guildId, title: failed?.title, error: message });
    this.emitPlayback("error", failed, message);
    if (skip && activeTrack && (!reportedId || reportedId === activeId)) {
      this.recoveredTrackIds.set(activeTrack.identifier, now + 30_000);
      this.lastFailureSkip = { trackId: activeTrack.identifier, at: now };
      this.player?.skip();
    }
  }

  onVoiceStateChanged() {
    if (this.settings.stayInChannel || !this.voiceChannel) return;
    const listeners = this.voiceChannel.members.filter((member) => !member.user.bot).size;
    if (listeners === 0) this.scheduleIdleDisconnect();
    else this.clearIdleTimer();
  }

  private scheduleIdleDisconnect() {
    this.clearIdleTimer();
    if (this.settings.stayInChannel) return;
    this.idleTimer = setTimeout(() => {
      if (this.settings.stayInChannel) return;
      const listeners = this.voiceChannel?.members.filter((member) => !member.user.bot).size ?? 0;
      const player = this.player;
      if (listeners === 0 || (!player?.playing && !player?.queue.size)) this.disconnect();
    }, 180_000);
    this.idleTimer.unref();
  }

  private clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private requirePlayer() {
    const player = this.player ?? this.kazagumo.getPlayer(this.guildId);
    if (!player) throw new Error("Bot nie jest połączony z kanałem głosowym. Użyj /play będąc na kanale.");
    this.player = player;
    return player;
  }

  private toTrack(track: KazagumoTrack): Track {
    const sourceName = String(track.sourceName ?? "youtube").toLowerCase();
    const spotifyUri = `${track.uri ?? ""} ${track.realUri ?? ""}`.includes("spotify.com");
    const source = sourceName.includes("spotify") || spotifyUri ? "spotify" : sourceName.includes("youtube") ? "youtube" : "direct";
    const uri = track.realUri || track.uri || undefined;
    const requester = track.requester as Partial<Requester> | undefined;
    return {
      id: `${track.identifier}:${track.length}:${track.title}`,
      source,
      title: track.title,
      artist: track.author || undefined,
      url: uri,
      webpageUrl: track.uri || uri,
      thumbnail: track.thumbnail || undefined,
      requestedBy: requester?.username,
      durationMs: track.length && track.length > 0 ? track.length : undefined,
      isLive: track.isStream,
      spotify: source === "spotify" && uri ? { id: track.identifier, externalUrl: track.uri } : undefined,
      addedAt: Date.now()
    };
  }

  private emitPlayback(type: PlaybackEvent["type"], track?: Track, error?: string) {
    const event: PlaybackEvent = { guildId: this.guildId, type, track, error, snapshot: this.snapshot() };
    this.emit("playback", event);
  }
}

function classifySearchInput(query: string) {
  const normalized = query.trim();
  if (/^https?:\/\//i.test(normalized)) {
    if (/spotify\.com\//i.test(normalized)) return "spotify-url";
    if (/(youtube\.com|youtu\.be)\//i.test(normalized)) return "youtube-url";
    return "media-url";
  }
  if (/^spotify:/i.test(normalized)) return "spotify-uri";
  if (/^(spsearch|ytsearch|ytmsearch|scsearch):/i.test(normalized)) return "prefixed-search";
  return "text-search";
}
