import { EventEmitter } from "node:events";
import { PermissionFlagsBits, type VoiceBasedChannel } from "discord.js";
import { PlayerState, type Kazagumo, type KazagumoPlayer, type KazagumoTrack, type PlayerMovedState } from "kazagumo";
import type { FilterOptions } from "shoukaku";
import type { AppConfig } from "../config.js";
import type {
  PersistedGuildPlaybackState,
  PlaybackEvent,
  PlaybackSettings,
  QueueSnapshot,
  Track
} from "../domain/types.js";
import { logger } from "../logger.js";
import { assertSafePlaybackInput, assertSafeRadioUrl } from "../sources/MediaInputGuard.js";
import { getYouTubePlaylistId, loadYouTubePlaylistVideoIds } from "../sources/YouTubePlaylistClient.js";
import { availableQueueCapacity } from "./queueCapacity.js";
import { SkipVoteTracker } from "./SkipVoteTracker.js";
import { isDuplicateFailureSkip, shouldSkipActiveTrack } from "./failureSkip.js";

type Requester = { id: string; username: string };
const SEARCH_TIMEOUT_MS = 12_000;
const AUTOPLAY_RETRY_MS = 15_000;

export class GuildAudioSession extends EventEmitter {
  private player?: KazagumoPlayer;
  private current?: Track;
  private radio?: Track;
  private voiceChannel?: VoiceBasedChannel;
  private textChannelId?: string;
  private readonly history: Track[] = [];
  private readonly recoveredTrackIds = new Map<string, number>();
  private lastFailureSkip?: { trackId: string; at: number };
  private autoplayGeneration = 0;
  private autoplayTask?: Promise<void>;
  private autoplayRetryTimer?: NodeJS.Timeout;
  private readonly skipVotes = new SkipVoteTracker();
  private readonly settings: PlaybackSettings;
  private idleTimer?: NodeJS.Timeout;
  private connectTask?: Promise<void>;

  constructor(
    readonly guildId: string,
    private readonly botUserId: string | undefined,
    private readonly config: AppConfig,
    private readonly kazagumo: Kazagumo,
    defaultVolume = config.playback.defaultVolume
  ) {
    super();
    this.settings = {
      volume: defaultVolume,
      stayInChannel: false,
      autoplay: false
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

    if (this.textChannelId) {
      const textChannel =
        channel.guild.channels.cache.get(this.textChannelId) ??
        (await channel.guild.channels.fetch(this.textChannelId).catch(() => null));
      const botId = botMember?.id ?? this.botUserId;
      const textPermissions = textChannel?.isTextBased() && botId ? textChannel.permissionsFor(botId) : null;
      if (
        !textChannel?.isTextBased() ||
        !textPermissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks
        ])
      ) {
        throw new Error(
          "Bot potrzebuje uprawnień Wyświetlanie kanału, Wysyłanie wiadomości i Osadzanie linków na kanale ogłoszeń."
        );
      }
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

  setAnnouncementChannel(channelId?: string) {
    this.textChannelId = channelId;
    if (channelId) this.player?.setTextChannel(channelId);
    this.emitPlayback("settingsChanged");
  }

  async enqueueQuery(query: string, requester: Requester, maxQueue: number, maxTracksToAdd = maxQueue) {
    const player = this.requirePlayer();
    assertSafePlaybackInput(query);
    const available = availableQueueCapacity(maxQueue, player.queue.size, maxTracksToAdd);
    if (available === 0) throw new Error(`Kolejka osiągnęła limit ${maxQueue} utworów.`);

    const startedAt = Date.now();
    const searchQuery = classifySearchInput(query) === "text-search" ? `ytmsearch:${query}` : query;
    const result = await searchWithTimeout(this.kazagumo.search(searchQuery, { requester })).catch((error: unknown) => {
      const timedOut = error instanceof SearchTimeoutError;
      logger.warn("Lavalink search request failed", {
        guildId: this.guildId,
        inputType: classifySearchInput(query),
        durationMs: Date.now() - startedAt,
        errorType: timedOut ? "SearchTimeout" : error instanceof Error ? error.name : typeof error
      });
      throw new Error(
        timedOut
          ? "Wyszukiwanie trwało zbyt długo. Spróbuj ponownie za chwilę."
          : "Lavalink nie odpowiedział na wyszukiwanie. Spróbuj ponownie za chwilę."
      );
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

  async enqueueYouTubePlaylist(query: string, requester: Requester, maxQueue: number, maxTracksToAdd = maxQueue) {
    const player = this.requirePlayer();
    assertSafePlaybackInput(query);
    const playlistId = getYouTubePlaylistId(query);
    if (!playlistId) throw new Error("Podaj link do playlisty YouTube zawierający parametr list=.");

    const available = availableQueueCapacity(maxQueue, player.queue.size, maxTracksToAdd);
    if (available === 0) throw new Error(`Kolejka osiągnęła limit ${maxQueue} utworów.`);

    let playlist: Awaited<ReturnType<typeof loadYouTubePlaylistVideoIds>>;
    try {
      playlist = await loadYouTubePlaylistVideoIds(playlistId, available);
    } catch (error) {
      logger.warn("YouTube playlist could not be read", {
        guildId: this.guildId,
        playlistId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        "Nie udało się odczytać playlisty YouTube. Sprawdź, czy jest publiczna lub dostępna przez link.",
        {
          cause: error
        }
      );
    }

    if (playlist.videoIds.length === 0) throw new Error("Ta playlista YouTube nie zawiera dostępnych utworów.");

    const resolved: Array<KazagumoTrack | undefined> = new Array(playlist.videoIds.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(3, playlist.videoIds.length) }, async () => {
      while (nextIndex < playlist.videoIds.length) {
        const index = nextIndex++;
        const videoId = playlist.videoIds[index];
        try {
          const result = await searchWithTimeout(
            this.kazagumo.search(`https://www.youtube.com/watch?v=${videoId}`, { requester })
          );
          if (result.tracks[0]) resolved[index] = result.tracks[0];
        } catch {
          // A playlist can contain deleted, private, or region-restricted videos.
        }
      }
    });
    await Promise.all(workers);

    const playable = resolved.filter((track): track is KazagumoTrack => Boolean(track));
    const unavailable = playlist.videoIds.length - playable.length;
    logger.info("YouTube playlist resolved", {
      guildId: this.guildId,
      playlistId,
      requested: playlist.videoIds.length,
      added: playable.length,
      unavailable,
      truncated: playlist.truncated
    });
    if (playable.length === 0) throw new Error("Lavalink nie znalazł odtwarzalnych utworów z tej playlisty.");

    player.queue.add(playable);
    const added = playable.map((track) => this.toTrack(track));
    if (!player.playing && !player.paused) await player.play();
    this.clearIdleTimer();
    this.emitPlayback("queueChanged");
    return { tracks: added, truncated: playlist.truncated, unavailable };
  }

  async restore(state: PersistedGuildPlaybackState, channel: VoiceBasedChannel) {
    const volume = Number.isFinite(state.settings.volume)
      ? Math.max(0, Math.min(1, state.settings.volume))
      : this.config.playback.defaultVolume;
    this.textChannelId = state.textChannelId;
    this.setSettings({
      volume,
      stayInChannel: Boolean(state.settings.stayInChannel || state.radio),
      autoplay: Boolean(state.settings.autoplay)
    });
    await this.connect(channel, state.textChannelId);

    if (state.radio) {
      const radioQuery = trackLookup(state.radio);
      if (radioQuery) {
        await this.setRadio(radioQuery, state.radio.title, {
          id: "restored",
          username: state.radio.requestedBy ?? "Aurora Music"
        });
      } else {
        logger.warn("Saved radio has no reusable source URL", { guildId: this.guildId, title: state.radio.title });
      }
    }

    const savedTracks = state.radio ? state.queue : [...(state.current ? [state.current] : []), ...state.queue];
    const resolved: Array<KazagumoTrack | undefined> = new Array(savedTracks.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(3, savedTracks.length) }, async () => {
      while (nextIndex < savedTracks.length) {
        const index = nextIndex++;
        const savedTrack = savedTracks[index];
        const query = trackLookup(savedTrack);
        if (!query) continue;
        try {
          const result = await searchWithTimeout(
            this.kazagumo.search(query, {
              requester: { id: "restored", username: savedTrack.requestedBy ?? "Aurora Music" }
            })
          );
          resolved[index] = result.tracks[0];
        } catch (error) {
          logger.warn("Could not restore saved track", {
            guildId: this.guildId,
            title: savedTrack.title,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    });
    await Promise.all(workers);

    const player = this.requirePlayer();
    const tracks = resolved.filter((track): track is KazagumoTrack => Boolean(track));
    if (tracks.length > 0) player.queue.add(tracks);
    if (!state.radio && ["none", "queue", "track"].includes(state.loop)) {
      player.setLoop(state.loop);
    }
    if (!player.playing && !player.paused && player.queue.size > 0) await player.play();
    this.emitPlayback("queueChanged");
  }

  async enqueueSpotifyTracks(tracks: Track[], requester: Requester, maxQueue: number) {
    const player = this.requirePlayer();
    const available = availableQueueCapacity(maxQueue, player.queue.size);
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
          const result = await searchWithTimeout(this.kazagumo.search(uri, { requester }));
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
    await assertSafeRadioUrl(url, this.config.media.radioAllowedDomains);
    const result = await searchWithTimeout(this.kazagumo.search(url, { requester }));
    const track = result.tracks[0];
    if (!track) throw new Error("Lavalink nie rozpoznał adresu radia. Użyj bezpośredniego URL do strumienia audio.");

    const current = player.queue.current;
    player.queue.clear();
    this.radio = this.toTrack(track);
    if (name?.trim()) this.radio.title = name.trim();
    this.settings.stayInChannel = true;
    if (current?.identifier === track.identifier) {
      this.radio = this.toTrack(current);
      if (name?.trim()) this.radio.title = name.trim();
    } else {
      await player.play(track, { replaceCurrent: true });
    }
    // Set the loop only after replacing the current track. Otherwise a skip can
    // replay the previous song instead of starting the selected radio station.
    player.setLoop("track");
    this.clearIdleTimer();
    this.emitPlayback("queueChanged");
    return this.radio;
  }

  clearQueue() {
    this.clearSkipVotes();
    this.player?.queue.clear();
    this.radio = undefined;
    this.player?.setLoop("none");
    this.disableAutoplay();
    this.emitPlayback("queueChanged");
  }

  clearUpcomingQueue() {
    const player = this.player;
    const removed = player?.queue.size ?? 0;
    player?.queue.clear();
    if (player?.loop === "queue") player.setLoop("none");
    this.emitPlayback("queueChanged");
    return removed;
  }

  removeQueued(position: number) {
    const queue = this.player?.queue;
    if (!queue?.size) throw new Error("Kolejka jest pusta.");
    if (!Number.isInteger(position) || position < 1 || position > queue.size) {
      throw new Error(`Podaj numer utworu od 1 do ${queue.size}.`);
    }
    const removed = queue[position - 1];
    queue.remove(position - 1);
    return this.toTrack(removed);
  }

  moveQueued(from: number, to: number) {
    const queue = this.player?.queue;
    if (!queue?.size) throw new Error("Kolejka jest pusta.");
    if (
      !Number.isInteger(from) ||
      from < 1 ||
      from > queue.size ||
      !Number.isInteger(to) ||
      to < 1 ||
      to > queue.size
    ) {
      throw new Error(`Podaj pozycje od 1 do ${queue.size}.`);
    }
    if (from === to) return undefined;
    const [moved] = queue.splice(from - 1, 1);
    queue.splice(to - 1, 0, moved);
    this.emitPlayback("queueChanged");
    return this.toTrack(moved);
  }

  async skipTo(position: number) {
    const player = this.player;
    const queue = player?.queue;
    if (!player || !queue?.size) throw new Error("Kolejka jest pusta.");
    if (!Number.isInteger(position) || position < 1 || position > queue.size) {
      throw new Error(`Podaj pozycje od 1 do ${queue.size}.`);
    }

    const target = queue[position - 1];
    queue.splice(0, position - 1);
    if (player.loop === "track") player.setLoop("none");
    this.radio = undefined;
    if (queue.current) player.skip();
    else await player.play();
    this.emitPlayback("queueChanged");
    return this.toTrack(target);
  }

  async playPrevious() {
    const player = this.player;
    if (!player) throw new Error("Nie ma aktywnego odtwarzacza.");
    const previous = player.getPrevious(true);
    if (!previous) throw new Error("Nie ma poprzedniego utworu w historii.");
    this.radio = undefined;
    await player.play(previous);
    this.emitPlayback("queueChanged");
    return this.toTrack(previous);
  }

  skip() {
    if (!this.player?.queue.current) return false;
    this.clearSkipVotes();
    this.player.skip();
    return true;
  }

  castSkipVote(userId: string, requiredVotes: number) {
    const current = this.player?.queue.current;
    if (!current) return { status: "empty" as const, votes: 0, required: requiredVotes };
    const trackId = `${current.identifier}:${current.length}:${current.title}`;
    const result = this.skipVotes.cast(trackId, userId, requiredVotes);
    if (result.status === "skipped") {
      this.skip();
    }
    return result;
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

  async disconnect() {
    this.clearIdleTimer();
    this.disableAutoplay();
    const player = this.player ?? this.kazagumo.getPlayer(this.guildId);
    this.player = undefined;
    this.current = undefined;
    this.radio = undefined;
    this.voiceChannel = undefined;
    this.settings.stayInChannel = false;
    try {
      if (player) await player.destroy();
    } finally {
      this.emitPlayback("idle");
    }
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
    if (settings.autoplay !== undefined && settings.autoplay !== this.settings.autoplay) {
      this.settings.autoplay = settings.autoplay;
      this.autoplayGeneration += 1;
      if (!settings.autoplay) {
        this.clearAutoplayRetry();
        const player = this.player;
        if (player && !player.queue.current && !player.queue.size) this.scheduleIdleDisconnect();
      } else {
        const player = this.player;
        if (player && !player.queue.current && !player.queue.size && this.history.length > 0) this.onPlayerEmpty();
      }
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
        equalizer: [
          { band: 0, gain: 0.18 },
          { band: 1, gain: 0.16 },
          { band: 2, gain: 0.12 },
          { band: 3, gain: 0.08 }
        ]
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
      queueTotal: player?.queue.size ?? 0,
      history: this.history.slice(-10).reverse(),
      settings: { ...this.settings },
      radio: this.radio
    };
  }

  onTrackStart(track: KazagumoTrack) {
    this.clearSkipVotes();
    this.clearIdleTimer();
    const mapped = this.toTrack(track);
    this.current = mapped.id === this.radio?.id ? this.radio : mapped;
    this.emitPlayback("trackStart", this.current);
  }

  onTrackEnd() {
    this.clearSkipVotes();
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
    if (this.settings.autoplay) {
      if (!this.autoplayTask) {
        const task = this.startAutoplay().finally(() => {
          if (this.autoplayTask === task) this.autoplayTask = undefined;
          const player = this.player;
          if (this.settings.autoplay && player && !player.queue.current && !player.queue.size) {
            this.scheduleAutoplayRetry();
          }
        });
        this.autoplayTask = task;
      }
      return;
    }
    this.emitPlayback("idle");
    this.scheduleIdleDisconnect();
  }

  private async startAutoplay() {
    const generation = this.autoplayGeneration;
    const player = this.player;
    const seed = this.history.at(-1);
    if (!player || playerUnavailable(player)) return;
    if (!seed) {
      this.emitPlayback("idle");
      this.scheduleIdleDisconnect();
      return;
    }

    try {
      const recentIds = new Set(this.history.slice(-20).map((track) => track.id));
      const queries = [
        ...(seed.artist ? [`${seed.artist} songs`, `${seed.artist} similar artists`] : []),
        `${seed.title} similar songs`
      ];
      let next: KazagumoTrack | undefined;
      let lastSearchError: unknown;
      for (const query of queries) {
        let result: Awaited<ReturnType<Kazagumo["search"]>>;
        try {
          result = await searchWithTimeout(
            this.kazagumo.search(`ytmsearch:${query}`, {
              requester: { id: "autoplay", username: "Aurora Music" }
            })
          );
        } catch (error) {
          lastSearchError = error;
          if (generation !== this.autoplayGeneration || !this.settings.autoplay) return;
          continue;
        }
        if (generation !== this.autoplayGeneration || !this.settings.autoplay) return;
        if (playerUnavailable(player) || player.queue.current || player.queue.size) return;
        next = result.tracks.find((track) => !recentIds.has(`${track.identifier}:${track.length}:${track.title}`));
        if (next) break;
      }

      if (!next) {
        logger.warn("Autoplay found no new related track; it will retry", {
          guildId: this.guildId,
          error: lastSearchError instanceof Error ? lastSearchError.message : undefined
        });
        this.emitPlayback("idle");
        this.scheduleIdleDisconnect();
        return;
      }

      player.queue.add(next);
      await player.play();
      this.clearIdleTimer();
      logger.info("Autoplay selected a related track", { guildId: this.guildId, title: next.title });
      this.emitPlayback("queueChanged");
    } catch (error) {
      if (generation !== this.autoplayGeneration || !this.settings.autoplay) return;
      logger.warn("Autoplay search failed", {
        guildId: this.guildId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.emitPlayback("idle");
      this.scheduleIdleDisconnect();
    }
  }

  private scheduleAutoplayRetry() {
    if (this.autoplayRetryTimer || !this.settings.autoplay) return;
    this.autoplayRetryTimer = setTimeout(() => {
      this.autoplayRetryTimer = undefined;
      this.onPlayerEmpty();
    }, AUTOPLAY_RETRY_MS);
    this.autoplayRetryTimer.unref();
  }

  private clearAutoplayRetry() {
    if (!this.autoplayRetryTimer) return;
    clearTimeout(this.autoplayRetryTimer);
    this.autoplayRetryTimer = undefined;
  }

  private disableAutoplay() {
    if (!this.settings.autoplay) return;
    this.settings.autoplay = false;
    this.autoplayGeneration += 1;
    this.clearAutoplayRetry();
    this.emitPlayback("settingsChanged");
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
      !reportedId &&
      this.lastFailureSkip &&
      now - this.lastFailureSkip.at < 2500 &&
      activeId !== this.lastFailureSkip.trackId
    );
    if (isDuplicateFailureSkip(skip, sameFailure, delayedDuplicate)) return;

    const failed = track ? this.toTrack(track) : this.current;
    logger.warn("Lavalink playback error", { guildId: this.guildId, title: failed?.title, error: message });
    this.emitPlayback("error", failed, message);
    if (activeTrack && shouldSkipActiveTrack(skip, activeId, reportedId)) {
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

  onBotVoiceChannelChanged(channel: VoiceBasedChannel | undefined) {
    if (!channel) {
      if (this.voiceChannel || this.player) {
        void this.disconnect().catch((error: unknown) => {
          logger.warn("Could not destroy the player after the bot left voice", {
            guildId: this.guildId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
      return;
    }

    if (this.voiceChannel?.id === channel.id) return;
    this.voiceChannel = channel;
    this.clearIdleTimer();
    this.emitPlayback("settingsChanged");
  }

  onPlayerMoved(state: PlayerMovedState, channel: VoiceBasedChannel | undefined) {
    if (state === "LEFT") {
      this.onBotVoiceChannelChanged(undefined);
      return;
    }
    if (channel) this.onBotVoiceChannelChanged(channel);
  }

  onPlayerDestroyed(player: KazagumoPlayer) {
    if (this.player && this.player !== player) return;
    if (!this.player && !this.current && !this.radio && !this.voiceChannel) return;
    this.clearIdleTimer();
    this.player = undefined;
    this.current = undefined;
    this.radio = undefined;
    this.voiceChannel = undefined;
    this.emitPlayback("idle");
  }

  private scheduleIdleDisconnect() {
    this.clearIdleTimer();
    if (this.settings.stayInChannel) return;
    this.idleTimer = setTimeout(() => {
      if (this.settings.stayInChannel) return;
      const listeners = this.voiceChannel?.members.filter((member) => !member.user.bot).size ?? 0;
      const player = this.player;
      if (listeners === 0 || (!player?.playing && !player?.queue.size)) {
        void this.disconnect().catch((error: unknown) => {
          logger.warn("Could not destroy an idle player", {
            guildId: this.guildId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    }, 180_000);
    this.idleTimer.unref();
  }

  private clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private clearSkipVotes() {
    this.skipVotes.clear();
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
    const source =
      sourceName.includes("spotify") || spotifyUri ? "spotify" : sourceName.includes("youtube") ? "youtube" : "direct";
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

function trackLookup(track: Track) {
  return track.spotify?.externalUrl ?? track.webpageUrl ?? track.url ?? track.query;
}

function playerUnavailable(player: KazagumoPlayer) {
  return player.state === PlayerState.DESTROYED || player.state === PlayerState.DESTROYING;
}

class SearchTimeoutError extends Error {
  constructor() {
    super("Lavalink search timed out");
    this.name = "SearchTimeoutError";
  }
}

async function searchWithTimeout<T>(search: Promise<T>, timeoutMs = SEARCH_TIMEOUT_MS): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      search,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new SearchTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
