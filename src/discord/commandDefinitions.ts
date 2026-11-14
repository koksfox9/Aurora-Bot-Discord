import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { t } from "../i18n/index.js";

export const slashCommandBuilders = [
  new SlashCommandBuilder().setName("help").setDescription(t("command.help")),
  new SlashCommandBuilder()
    .setName("djrole")
    .setDescription(t("command.djrole"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((option) => option.setName("role").setDescription(t("option.djRole")).setRequired(false)),
  new SlashCommandBuilder()
    .setName("defaultvolume")
    .setDescription(t("command.defaultVolume"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option
        .setName("value")
        .setDescription(t("option.defaultVolume"))
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),
  new SlashCommandBuilder()
    .setName("musictextchannel")
    .setDescription(t("command.musicTextChannel"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(t("option.textChannel"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("music24channel")
    .setDescription(t("command.music24Channel"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(t("option.voiceChannel"))
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription(t("command.play"))
    .addStringOption((option) =>
      option.setName("query").setDescription(t("option.queryLink")).setRequired(true).setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription(t("command.search"))
    .addStringOption((option) =>
      option.setName("query").setDescription(t("option.queryName")).setRequired(true).setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription(t("command.playlist"))
    .addStringOption((option) => option.setName("url").setDescription(t("option.playlistLink")).setRequired(true))
    .addIntegerOption((option) =>
      option.setName("limit").setDescription(t("option.trackLimit")).setMinValue(1).setMaxValue(300)
    ),
  new SlashCommandBuilder().setName("spotify-login").setDescription(t("command.spotifyLogin")),
  new SlashCommandBuilder().setName("spotify-playlists").setDescription(t("command.spotifyPlaylists")),
  new SlashCommandBuilder()
    .setName("spotify-playlist")
    .setDescription(t("command.spotifyPlaylist"))
    .addStringOption((option) => option.setName("value").setDescription(t("option.spotifyPlaylist")).setRequired(true))
    .addIntegerOption((option) =>
      option.setName("limit").setDescription(t("option.trackLimit")).setMinValue(1).setMaxValue(300)
    ),
  new SlashCommandBuilder()
    .setName("radio")
    .setDescription(t("command.radio"))
    .addStringOption((option) => option.setName("url").setDescription(t("option.streamUrl")).setRequired(true))
    .addStringOption((option) => option.setName("name").setDescription(t("option.radioName")).setRequired(false)),
  new SlashCommandBuilder()
    .setName("queue")
    .setDescription(t("command.queue"))
    .addIntegerOption((option) =>
      option.setName("page").setDescription(t("option.queuePage")).setMinValue(1).setMaxValue(1_000)
    ),
  new SlashCommandBuilder().setName("nowplaying").setDescription(t("command.nowPlaying")),
  new SlashCommandBuilder().setName("lyrics").setDescription(t("command.lyrics")),
  new SlashCommandBuilder().setName("skip").setDescription(t("command.skip")),
  new SlashCommandBuilder().setName("clear").setDescription(t("command.clear")),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription(t("command.remove"))
    .addIntegerOption((option) =>
      option
        .setName("position")
        .setDescription(t("option.position"))
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10_000)
    ),
  new SlashCommandBuilder()
    .setName("move")
    .setDescription(t("command.move"))
    .addIntegerOption((option) =>
      option
        .setName("from")
        .setDescription(t("option.fromPosition"))
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10_000)
    )
    .addIntegerOption((option) =>
      option.setName("to").setDescription(t("option.toPosition")).setRequired(true).setMinValue(1).setMaxValue(10_000)
    ),
  new SlashCommandBuilder()
    .setName("skipto")
    .setDescription(t("command.skipTo"))
    .addIntegerOption((option) =>
      option
        .setName("position")
        .setDescription(t("option.position"))
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10_000)
    ),
  new SlashCommandBuilder().setName("previous").setDescription(t("command.previous")),
  new SlashCommandBuilder().setName("stop").setDescription(t("command.stop")),
  new SlashCommandBuilder().setName("shuffle").setDescription(t("command.shuffle")),
  new SlashCommandBuilder()
    .setName("loop")
    .setDescription(t("command.loop"))
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription(t("option.loopMode"))
        .setRequired(true)
        .addChoices(
          { name: t("choice.loopOff"), value: "none" },
          { name: t("choice.loopQueue"), value: "queue" },
          { name: t("choice.loopTrack"), value: "track" }
        )
    ),
  new SlashCommandBuilder()
    .setName("filter")
    .setDescription(t("command.filter"))
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription(t("option.filterMode"))
        .setRequired(true)
        .addChoices(
          { name: t("choice.filterOff"), value: "off" },
          { name: t("option.filterBassBoost"), value: "bassboost" },
          { name: "Nightcore", value: "nightcore" },
          { name: "8D", value: "8d" }
        )
    ),
  new SlashCommandBuilder().setName("pause").setDescription(t("command.pause")),
  new SlashCommandBuilder().setName("resume").setDescription(t("command.resume")),
  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription(t("command.autoplay"))
    .addBooleanOption((option) => option.setName("enabled").setDescription(t("option.autoplay")).setRequired(true)),
  new SlashCommandBuilder().setName("leave").setDescription(t("command.leave")),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription(t("command.volume"))
    .addIntegerOption((option) =>
      option.setName("value").setDescription(t("option.volume")).setRequired(true).setMinValue(1).setMaxValue(100)
    ),
  new SlashCommandBuilder()
    .setName("seek")
    .setDescription(t("command.seek"))
    .addIntegerOption((option) =>
      option
        .setName("seconds")
        .setDescription(t("option.seekPosition"))
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(14_400)
    ),
  new SlashCommandBuilder()
    .setName("mode24h")
    .setDescription(t("command.mode24h"))
    .addBooleanOption((option) => option.setName("enabled").setDescription(t("option.mode24h")).setRequired(true))
];

export const slashCommands = slashCommandBuilders.map((builder) => builder.toJSON());
