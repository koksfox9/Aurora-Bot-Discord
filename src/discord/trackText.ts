import { escapeMarkdown } from "discord.js";
import type { Track } from "../domain/types.js";

const ELLIPSIS = "…";

export function escapeAndTruncate(value: string, maxLength: number) {
  const escaped = escapeMarkdown(value, { maskedLink: true });
  if (escaped.length <= maxLength) return escaped;
  if (maxLength <= ELLIPSIS.length) return ELLIPSIS.slice(0, maxLength);
  return `${escaped.slice(0, maxLength - ELLIPSIS.length)}${ELLIPSIS}`;
}

export function formatTrackLine(track: Track, maxLength = 90) {
  const live = track.isLive ? " [LIVE]" : "";
  const fixedLength = 4 + live.length; // **title** and the optional live suffix
  const maxArtistLength = Math.max(0, maxLength - fixedLength - 1 - 3);
  const artist = track.artist ? ` - ${escapeAndTruncate(track.artist, maxArtistLength)}` : "";
  const titleLength = Math.max(1, maxLength - fixedLength - artist.length);
  return `**${escapeAndTruncate(track.title, titleLength)}**${artist}${live}`;
}
