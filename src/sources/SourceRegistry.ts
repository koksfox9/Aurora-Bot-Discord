import { SpotifyClient } from "./SpotifyClient.js";

export class SourceRegistry {
  constructor(readonly spotify: SpotifyClient) {}
}

export function assertSingleMediaLink(input: string) {
  const links = input.match(/(?:https?:\/\/[^\s<>()]+|(?:www\.|music\.)?(?:youtube\.com|youtu\.be|open\.spotify\.com)\/[^\s<>()]+|spotify:(?:track|playlist|album):[A-Za-z0-9]+)/gi) ?? [];
  if (links.length > 1) {
    throw new Error("Wyślij tylko jeden link muzyczny naraz, a potem powtórz komendę.");
  }
}
