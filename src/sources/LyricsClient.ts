import type { Track } from "../domain/types.js";

export interface LyricsResult {
  trackName: string;
  artistName: string;
  lyrics: string;
  instrumental: boolean;
}

export async function findLyrics(track: Track): Promise<LyricsResult | null> {
  const artist = track.artist?.trim();
  if (!artist) return null;

  const params = new URLSearchParams({ track_name: track.title, artist_name: artist });
  const durationSeconds = Math.round((track.durationMs ?? 0) / 1000);
  if (durationSeconds >= 1 && durationSeconds <= 3600) params.set("duration", String(durationSeconds));

  let response: Response;
  try {
    response = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { "User-Agent": "Aurora Music Bot/0.1.0 (https://github.com/koksfox9/Aurora-Bot-Discord)" },
      signal: AbortSignal.timeout(8_000)
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Wyszukiwanie tekstu trwało zbyt długo. Spróbuj ponownie.", { cause: error });
    }
    throw new Error("Nie można połączyć się z usługą tekstów.", { cause: error });
  }
  if (response.status === 404) return null;
  if (response.status === 429)
    throw new Error("Wyszukiwanie tekstów jest chwilowo ograniczone. Spróbuj ponownie później.");
  if (!response.ok) throw new Error("Usługa tekstów jest chwilowo niedostępna.");

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Usługa tekstów zwróciła nieprawidłową odpowiedź.");
  }
  if (!result || typeof result !== "object") throw new Error("Usługa tekstów zwróciła nieprawidłową odpowiedź.");
  const record = result as Record<string, unknown>;
  const instrumental = record.instrumental === true;
  const lyrics =
    typeof record.plainLyrics === "string" && record.plainLyrics.trim()
      ? record.plainLyrics
      : typeof record.syncedLyrics === "string"
        ? record.syncedLyrics
        : "";

  return {
    trackName: typeof record.trackName === "string" ? record.trackName : track.title,
    artistName: typeof record.artistName === "string" ? record.artistName : artist,
    lyrics,
    instrumental
  };
}
