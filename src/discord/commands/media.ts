import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { KazagumoTrack } from "kazagumo";
import type { PlayerManager } from "../../player/PlayerManager.js";
import type { Track } from "../../domain/types.js";
import type { SpotifyClient } from "../../sources/SpotifyClient.js";
import { assertSafePlaybackInput } from "../../sources/MediaInputGuard.js";
import { normalizeYouTubeVideoUrl } from "../../sources/YouTubePlaylistClient.js";
import { formatTime } from "../format.js";
import { escapeAndTruncate } from "../trackText.js";
import { assertCanControlPlayback, requireVoiceChannel } from "../voiceGuard.js";

type Requester = { id: string; username: string };

export async function handleMediaCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  spotify: SpotifyClient,
  guildId: string,
  djRoleId: string | undefined,
  requester: Requester
) {
  switch (interaction.commandName) {
    case "search": {
      const query = interaction.options.getString("query", true).trim();
      assertSafePlaybackInput(query);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const track = await players.resolveSearchTrack(query, requester);
      await interaction.editReply({ embeds: [searchResultEmbed(track)] });
      return true;
    }

    case "play": {
      const query = interaction.options.getString("query", true).trim();
      assertSafePlaybackInput(query);
      const session = players.getOrCreate(guildId);
      await interaction.deferReply();
      await players.runMediaRequest(guildId, async () => {
        assertCanControlPlayback(interaction, djRoleId);
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        const result = await session.enqueueQuery(
          normalizeYouTubeVideoUrl(query),
          requester,
          players.queueLimit(guildId, requester.id)
        );
        const titles = result.tracks
          .slice(0, 3)
          .map((track) => `**${escapeAndTruncate(track.title, 80)}**`)
          .join(", ");
        const more = result.tracks.length > 3 ? ` i ${result.tracks.length - 3} więcej` : "";
        const limitNote = result.truncated ? " (reszta przekracza limit kolejki)" : "";
        await interaction.editReply(`Dodano ${titles}${more}${limitNote}.`);
      });
      return true;
    }

    case "playlist": {
      const url = interaction.options.getString("url", true).trim();
      const limit = interaction.options.getInteger("limit") ?? 100;
      assertSafePlaybackInput(url);
      const session = players.getOrCreate(guildId);
      await interaction.deferReply();
      await players.runMediaRequest(guildId, async () => {
        assertCanControlPlayback(interaction, djRoleId);
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        const result = await session.enqueueYouTubePlaylist(
          url,
          requester,
          players.queueLimit(guildId, requester.id),
          limit
        );
        await interaction.editReply(
          `Dodano ${result.tracks.length} utworów z playlisty${result.truncated ? " (osiągnięto limit)" : ""}${result.unavailable ? ` (pominięto ${result.unavailable} niedostępnych)` : ""}.`
        );
      });
      return true;
    }

    case "spotify-login": {
      const url = spotify.createAuthorizeUrl(interaction.user.id);
      await interaction.reply({ content: `Połącz Spotify tutaj: ${url}`, flags: MessageFlags.Ephemeral });
      return true;
    }

    case "spotify-playlists": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const playlists = await spotify.listUserPlaylists(interaction.user.id);
      const lines = playlists
        .slice(0, 20)
        .map((playlist, index) => `${index + 1}. ${playlist.name} (${playlist.id})`)
        .join("\n");
      await interaction.editReply(lines || "Nie widzę playlist na tym koncie.");
      return true;
    }

    case "spotify-playlist": {
      const value = interaction.options.getString("value", true).trim();
      const limit = interaction.options.getInteger("limit") ?? 100;
      assertSafePlaybackInput(value);
      const session = players.getOrCreate(guildId);
      await interaction.deferReply();
      await players.runMediaRequest(guildId, async () => {
        assertCanControlPlayback(interaction, djRoleId);
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        let tracks: Track[];
        try {
          tracks = await spotify.playlistTracks(value, requester.username, requester.id, limit);
        } catch (error) {
          if (!/^https?:\/\//i.test(value) && !value.startsWith("spotify:")) throw error;
          const result = await session.enqueueQuery(value, requester, players.queueLimit(guildId, requester.id), limit);
          await interaction.editReply(
            `Dodano ${result.tracks.length} utworów Spotify przez LavaSrc${result.truncated ? " (osiągnięto limit)" : ""}.`
          );
          return;
        }
        const result = await session.enqueueSpotifyTracks(tracks, requester, players.queueLimit(guildId, requester.id));
        await interaction.editReply(
          `Dodano ${result.added} utworów Spotify${result.omitted ? `; pominięto ${result.omitted} niedostępnych` : ""}.`
        );
      });
      return true;
    }

    case "radio": {
      if (!players.isPremium(guildId, requester.id)) throw new Error("Radio 24/7 jest dostępne w planie Premium.");
      const url = interaction.options.getString("url", true).trim();
      const name = interaction.options.getString("name") ?? undefined;
      const session = players.getOrCreate(guildId);
      await interaction.deferReply();
      await players.runMediaRequest(guildId, async () => {
        assertCanControlPlayback(interaction, djRoleId);
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        const radio = await session.setRadio(url, name, requester);
        await interaction.editReply(`Radio 24/7 ustawione: **${escapeAndTruncate(radio.title, 200)}**`);
      });
      return true;
    }

    default:
      return false;
  }
}

export function searchResultEmbed(track: KazagumoTrack) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(escapeAndTruncate(track.title, 256))
    .setDescription(
      [
        `Wykonawca: ${escapeAndTruncate(track.author ?? "nieznany", 512)}`,
        `Czas: ${track.isStream ? "na żywo" : formatTime(track.length ?? 0)}`,
        "Wybrany wynik nie został dodany do kolejki. Aby go odtworzyć, użyj `/play` i wybierz ten utwór."
      ].join("\n")
    );
  if (track.uri) embed.setURL(track.uri);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}
