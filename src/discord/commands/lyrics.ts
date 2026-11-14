import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { findLyrics, type LyricsResult } from "../../sources/LyricsClient.js";

export async function handleLyricsCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  guildId: string
) {
  if (interaction.commandName !== "lyrics") return false;
  const current = players.get(guildId)?.snapshot().current;
  if (!current) throw new Error("Nic teraz nie gra.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lyrics = await findLyrics(current);
  if (!lyrics) {
    await interaction.editReply("Nie znaleziono tekstu dla aktualnego utworu.");
    return true;
  }
  if (lyrics.instrumental) {
    await interaction.editReply("Ten utwór jest oznaczony jako instrumentalny.");
    return true;
  }
  if (!lyrics.lyrics.trim()) {
    await interaction.editReply("Nie znaleziono tekstu dla aktualnego utworu.");
    return true;
  }
  await interaction.editReply({ embeds: [lyricsEmbed(lyrics)] });
  return true;
}

function lyricsEmbed(lyrics: LyricsResult) {
  const content =
    lyrics.lyrics.length > 3900
      ? `${lyrics.lyrics.slice(0, 3900).trimEnd()}\n\n… (tekst skrócono ze względu na limit Discorda)`
      : lyrics.lyrics;
  return new EmbedBuilder()
    .setColor(0xff8a4c)
    .setTitle(lyrics.trackName.slice(0, 256))
    .setAuthor({ name: lyrics.artistName.slice(0, 256) })
    .setDescription(content)
    .setFooter({ text: "Tekst: LRCLIB" });
}
