import { URL, URLSearchParams } from "node:url";
import type { AppConfig } from "../config.js";
import type { Track } from "../domain/types.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import { nonce, stableId } from "../utils/id.js";

interface SpotifyToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface SpotifyTokenFile {
  users: Record<string, SpotifyToken>;
}

interface SpotifyApiTrack {
  id: string;
  name: string;
  duration_ms: number;
  external_urls?: { spotify?: string };
  uri?: string;
  type?: string;
  artists?: Array<{ name: string }>;
  album?: {
    images?: Array<{ url: string; width: number; height: number }>;
  };
}

interface SpotifyPlaylistItem {
  item?: SpotifyApiTrack | null;
  track?: SpotifyApiTrack | null;
}

interface SpotifyPaging<T> {
  items: T[];
  next: string | null;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  owner?: { display_name?: string };
  tracks?: { total: number };
}

export class SpotifyClient {
  private appToken?: SpotifyToken;
  private userTokens: SpotifyTokenFile = { users: {} };
  private initialized = false;
  private readonly oauthStates = new Map<string, { discordUserId: string; createdAt: number }>();

  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return Boolean(this.config.spotify.clientId && this.config.spotify.clientSecret && this.config.spotify.redirectUri);
  }

  async init() {
    this.userTokens = await readJsonFile<SpotifyTokenFile>(this.config.data.tokenFile, { users: {} });
    this.initialized = true;
  }

  createAuthorizeUrl(discordUserId: string) {
    this.assertConfigured();
    const state = nonce("spotify");
    this.oauthStates.set(state, { discordUserId, createdAt: Date.now() });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.spotify.clientId!,
      scope: "playlist-read-private playlist-read-collaborative user-read-private",
      redirect_uri: this.config.spotify.redirectUri!,
      state
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async finishAuthorization(code: string, state: string) {
    this.assertConfigured();
    const savedState = this.oauthStates.get(state);
    if (!savedState) throw new Error("Spotify authorization state is missing or expired");
    this.oauthStates.delete(state);

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.spotify.redirectUri!
    });

    const json = await this.tokenRequest(body);
    await this.ensureInit();
    this.userTokens.users[savedState.discordUserId] = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000 - 60000
    };
    await this.save();
    return savedState.discordUserId;
  }

  async listUserPlaylists(discordUserId: string) {
    const token = await this.getUserAccessToken(discordUserId);
    const playlists: SpotifyPlaylist[] = [];
    let next: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";

    while (next) {
      const page: SpotifyPaging<SpotifyPlaylist> = await this.get<SpotifyPaging<SpotifyPlaylist>>(next, token);
      playlists.push(...page.items);
      next = page.next;
    }

    return playlists;
  }

  async playlistTracks(input: string, requestedBy?: string, discordUserId?: string, limit = 100): Promise<Track[]> {
    const playlistId = this.extractPlaylistId(input);
    const token = discordUserId ? await this.getUserAccessToken(discordUserId) : await this.getAppAccessToken();
    const tracks: Track[] = [];
    const market = discordUserId ? "&market=from_token" : "";
    let next: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50${market}`;

    while (next && tracks.length < limit) {
      const page: SpotifyPaging<SpotifyPlaylistItem> = await this.get<SpotifyPaging<SpotifyPlaylistItem>>(next, token);
      for (const item of page.items) {
        const spotifyTrack = item.item ?? item.track;
        if (!spotifyTrack?.id || (spotifyTrack.type && spotifyTrack.type !== "track")) continue;
        tracks.push(this.toTrack(spotifyTrack, playlistId, requestedBy));
        if (tracks.length >= limit) break;
      }
      next = page.next;
    }

    return tracks;
  }

  async track(input: string, requestedBy?: string): Promise<Track> {
    const trackId = this.extractTrackId(input);
    const token = await this.getAppAccessToken();
    const track = await this.get<SpotifyApiTrack>(`https://api.spotify.com/v1/tracks/${trackId}`, token);
    return this.toTrack(track, undefined, requestedBy);
  }

  isSpotifyUrl(input: string) {
    try {
      const url = new URL(input);
      return url.hostname === "open.spotify.com";
    } catch {
      return input.startsWith("spotify:");
    }
  }

  isPlaylist(input: string) {
    return input.includes("/playlist/") || input.startsWith("spotify:playlist:");
  }

  isTrack(input: string) {
    return input.includes("/track/") || input.startsWith("spotify:track:");
  }

  private toTrack(track: SpotifyApiTrack, playlistId: string | undefined, requestedBy?: string): Track {
    const artists = track.artists?.map((artist) => artist.name).join(", ");
    const title = track.name;
    const query = [artists, title, "official audio"].filter(Boolean).join(" - ");
    const image = track.album?.images?.sort((a, b) => b.width - a.width)[0]?.url;

    return {
      id: stableId(`spotify:${track.id}`, "sp"),
      source: "spotify",
      title,
      artist: artists,
      query,
      webpageUrl: track.external_urls?.spotify,
      thumbnail: image,
      durationMs: track.duration_ms,
      requestedBy,
      spotify: {
        id: track.id,
        uri: track.uri,
        playlistId,
        externalUrl: track.external_urls?.spotify
      },
      addedAt: Date.now()
    };
  }

  private async getUserAccessToken(discordUserId: string) {
    await this.ensureInit();
    const token = this.userTokens.users[discordUserId];
    if (!token) throw new Error("Spotify is not connected for this Discord user. Use /spotify-login first.");
    if (token.expiresAt > Date.now()) return token.accessToken;
    if (!token.refreshToken) throw new Error("Spotify token expired and no refresh token is available.");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken
    });

    const json = await this.tokenRequest(body);
    token.accessToken = json.access_token;
    token.refreshToken = json.refresh_token ?? token.refreshToken;
    token.expiresAt = Date.now() + json.expires_in * 1000 - 60000;
    await this.save();
    return token.accessToken;
  }

  private async getAppAccessToken() {
    this.assertConfigured();
    if (this.appToken && this.appToken.expiresAt > Date.now()) return this.appToken.accessToken;

    const body = new URLSearchParams({ grant_type: "client_credentials" });
    const json = await this.tokenRequest(body);
    this.appToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000 - 60000
    };
    return this.appToken.accessToken;
  }

  private async tokenRequest(body: URLSearchParams): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    this.assertConfigured();
    const auth = Buffer.from(`${this.config.spotify.clientId}:${this.config.spotify.clientSecret}`).toString("base64");
    const response = await this.fetchSpotify("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Spotify token request failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  }

  private async get<T>(url: string, token: string): Promise<T> {
    const response = await this.fetchSpotify(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify API request failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  private extractPlaylistId(input: string) {
    if (/^[A-Za-z0-9]{10,}$/.test(input)) return input;
    if (input.startsWith("spotify:playlist:")) return input.split(":")[2];
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("playlist");
    if (index === -1 || !parts[index + 1]) throw new Error("Spotify playlist URL is invalid");
    return parts[index + 1];
  }

  private extractTrackId(input: string) {
    if (/^[A-Za-z0-9]{10,}$/.test(input)) return input;
    if (input.startsWith("spotify:track:")) return input.split(":")[2];
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("track");
    if (index === -1 || !parts[index + 1]) throw new Error("Spotify track URL is invalid");
    return parts[index + 1];
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error("Spotify is not configured. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REDIRECT_URI.");
    }
  }

  private async fetchSpotify(url: string, init: RequestInit) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("Spotify nie odpowiedzial w ciagu 20 sekund. Sprobuj ponownie.");
      }
      throw error;
    }
  }

  private async ensureInit() {
    if (!this.initialized) await this.init();
  }

  private async save() {
    await writeJsonFile(this.config.data.tokenFile, this.userTokens);
  }
}
