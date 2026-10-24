import { SlashCommandBuilder } from "discord.js";

export const slashCommandBuilders = [
  new SlashCommandBuilder().setName("join").setDescription("Dolacz do Twojego kanalu glosowego"),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Dodaj utwor z YouTube, Spotify albo wyszukiwania")
    .addStringOption((option) => option.setName("query").setDescription("Link albo nazwa utworu").setRequired(true)),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Dodaj playliste YouTube albo Spotify")
    .addStringOption((option) => option.setName("url").setDescription("Link do playlisty").setRequired(true))
    .addIntegerOption((option) =>
      option.setName("limit").setDescription("Maksymalna liczba utworow").setMinValue(1).setMaxValue(300)
    ),
  new SlashCommandBuilder().setName("spotify-login").setDescription("Polacz swoje konto Spotify"),
  new SlashCommandBuilder().setName("spotify-playlists").setDescription("Pokaz Twoje playlisty Spotify"),
  new SlashCommandBuilder()
    .setName("spotify-playlist")
    .setDescription("Dodaj playliste Spotify")
    .addStringOption((option) => option.setName("value").setDescription("Link albo ID playlisty").setRequired(true))
    .addIntegerOption((option) =>
      option.setName("limit").setDescription("Maksymalna liczba utworow").setMinValue(1).setMaxValue(300)
    ),
  new SlashCommandBuilder()
    .setName("radio")
    .setDescription("Ustaw radio albo live 24/7")
    .addStringOption((option) => option.setName("url").setDescription("Adres streamu").setRequired(true))
    .addStringOption((option) => option.setName("name").setDescription("Nazwa radia").setRequired(false)),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Pokaz kolejke")
    .addIntegerOption((option) => option.setName("page").setDescription("Numer strony").setMinValue(1).setMaxValue(50)),
  new SlashCommandBuilder().setName("now").setDescription("Pokaz aktualny i nastepny utwor"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Pokaz aktualny i nastepny utwor"),
  new SlashCommandBuilder().setName("np").setDescription("Pokaz aktualny i nastepny utwor"),
  new SlashCommandBuilder().setName("skip").setDescription("Pomin aktualny utwor"),
  new SlashCommandBuilder().setName("stop").setDescription("Zatrzymaj odtwarzanie i wyczysc kolejke"),
  new SlashCommandBuilder().setName("shuffle").setDescription("Pomieszaj kolejke"),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Ustaw powtarzanie")
    .addStringOption((option) => option
      .setName("mode")
      .setDescription("Tryb powtarzania")
      .setRequired(true)
      .addChoices(
        { name: "Wylaczone", value: "none" },
        { name: "Kolejka", value: "queue" },
        { name: "Utwor", value: "track" }
      )),
  new SlashCommandBuilder()
    .setName("filter")
    .setDescription("Ustaw efekt dzwiekowy")
    .addStringOption((option) => option
      .setName("mode")
      .setDescription("Efekt")
      .setRequired(true)
      .addChoices(
        { name: "Wylaczony", value: "off" },
        { name: "Bass boost", value: "bassboost" },
        { name: "Nightcore", value: "nightcore" },
        { name: "8D", value: "8d" }
      )),
  new SlashCommandBuilder().setName("pause").setDescription("Pauza"),
  new SlashCommandBuilder().setName("resume").setDescription("Wznow"),
  new SlashCommandBuilder().setName("leave").setDescription("Rozlacz bota"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ustaw glosnosc")
    .addIntegerOption((option) =>
      option.setName("value").setDescription("Glosnosc 1-100").setRequired(true).setMinValue(1).setMaxValue(100)
    ),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Przewin utwor do podanej sekundy")
    .addIntegerOption((option) => option.setName("seconds").setDescription("Pozycja w sekundach").setRequired(true).setMinValue(0).setMaxValue(14400)),
  new SlashCommandBuilder()
    .setName("mode24h")
    .setDescription("Utrzymuj bota na kanale")
    .addBooleanOption((option) => option.setName("enabled").setDescription("Stan").setRequired(true))
];

export const slashCommands = slashCommandBuilders.map((builder) => builder.toJSON());
