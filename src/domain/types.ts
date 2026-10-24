export type TrackSource = "youtube" | "spotify" | "direct";

export interface SpotifyTrackRef {
  id: string;
  uri?: string;
  playlistId?: string;
  externalUrl?: string;
}

export interface Track {
  id: string;
  source: TrackSource;
  title: string;
  artist?: string;
  query?: string;
  url?: string;
  webpageUrl?: string;
  thumbnail?: string;
  requestedBy?: string;
  durationMs?: number;
  isLive?: boolean;
  spotify?: SpotifyTrackRef;
  addedAt: number;
}

export interface PlaybackSettings {
  volume: number;
  stayInChannel: boolean;
}

export interface QueueSnapshot {
  guildId: string;
  voiceChannelId?: string;
  textChannelId?: string;
  connected: boolean;
  paused: boolean;
  positionMs: number;
  loop: "none" | "queue" | "track";
  current?: Track;
  next?: Track;
  queue: Track[];
  history: Track[];
  settings: PlaybackSettings;
  radio?: Track;
}

export interface PlaybackEvent {
  guildId: string;
  type: "trackStart" | "trackEnd" | "queueChanged" | "settingsChanged" | "error" | "idle";
  track?: Track;
  error?: string;
  snapshot?: QueueSnapshot;
}
