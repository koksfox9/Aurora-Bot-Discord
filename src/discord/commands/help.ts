import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";

export async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName !== "help") return false;
  await interaction.reply({ embeds: [helpEmbed()], flags: MessageFlags.Ephemeral });
  return true;
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0xff8a4c)
    .setTitle("Aurora Music — pomoc")
    .setDescription(
      "Wybierz komendę z listy. Utwory dodawaj przez `/play`; `/search` pokazuje podgląd bez dodawania do kolejki."
    )
    .addFields(
      {
        name: "Wyszukiwanie i kolejka",
        value:
          "`/play` — dodaj utwór · `/search` — podgląd wyniku · `/lyrics` — tekst aktualnego utworu · `/playlist` i `/spotify-playlist` — dodaj playlistę · `/queue` — kolejka ze stronami"
      },
      {
        name: "Sterowanie",
        value:
          "`/skip` (głosowanie większości) · `/skipto` · `/previous` · `/remove` · `/move` · `/clear` · `/shuffle` · `/stop` · `/pause` · `/resume` · `/autoplay`"
      },
      {
        name: "Odtwarzacz",
        value: "`/nowplaying` · `/volume` · `/seek` · `/loop` · `/leave`"
      },
      {
        name: "Spotify i Premium",
        value:
          "`/spotify-login` · `/spotify-playlists` · `/radio` (Premium) · `/filter` (Premium) · `/mode24h` (Premium)"
      }
    )
    .setFooter({ text: "Komendy sterujące wymagają obecności na kanale głosowym bota." });
}
