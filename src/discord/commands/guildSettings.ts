import { PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

export async function handleGuildSettingsCommand(interaction: ChatInputCommandInteraction, players: PlayerManager) {
  const guild = interaction.guild;
  const guildId = interaction.guildId;
  if (!guild || !guildId) throw new Error("Ta komenda działa tylko na serwerze.");

  switch (interaction.commandName) {
    case "djrole": {
      requireManageGuild(interaction);
      const role = interaction.options.getRole("role");
      await players.setDjRoleId(guildId, role?.id);
      await interaction.reply(
        role
          ? `Rola DJ została ustawiona na ${role}. Jej członkowie mogą sterować muzyką i pomijać utwory bez głosowania.`
          : "Rola DJ została wyłączona."
      );
      return true;
    }

    case "defaultvolume": {
      requireManageGuild(interaction);
      const value = interaction.options.getInteger("value", true);
      await players.setGuildDefaultVolume(guildId, value / 100);
      players.get(guildId)?.setSettings({ volume: value / 100 });
      await interaction.reply(`Domyślna głośność serwera: ${value}%. Ustawienie obowiązuje też bieżącą sesję.`);
      return true;
    }

    case "musictextchannel": {
      requireManageGuild(interaction);
      const channelOption = interaction.options.getChannel("channel");
      const channel = channelOption ? await guild.channels.fetch(channelOption.id) : null;
      if (channel) {
        const botMember = guild.members.me;
        if (
          !botMember ||
          !channel.isTextBased() ||
          !channel.permissionsFor(botMember).has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
          ])
        ) {
          throw new Error(
            "Bot potrzebuje uprawnień Wyświetlanie kanału, Wysyłanie wiadomości i Osadzanie linków na wybranym kanale."
          );
        }
      }
      await players.setGuildTextChannelId(guildId, channel?.id);
      await interaction.reply(
        channelOption
          ? `Ogłoszenia muzyczne będą wysyłane na ${channelOption}.`
          : "Stały kanał ogłoszeń muzycznych został wyłączony."
      );
      return true;
    }

    case "music24channel": {
      requireManageGuild(interaction);
      const channelOption = interaction.options.getChannel("channel");
      const channel = channelOption ? await guild.channels.fetch(channelOption.id) : null;
      if (channel) {
        const botMember = guild.members.me;
        if (
          !botMember ||
          !channel.isVoiceBased() ||
          !channel.permissionsFor(botMember).has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
        ) {
          throw new Error("Bot potrzebuje uprawnień Połącz i Mów na wybranym kanale głosowym.");
        }
      }
      await players.setGuild24hChannelId(guildId, channel?.id);
      await interaction.reply(
        channelOption
          ? `Domyślny kanał głosowy 24/7 ustawiony na ${channelOption}. Włączy się przy następnym użyciu /mode24h z enabled:true.`
          : "Domyślny kanał głosowy 24/7 został wyłączony."
      );
      return true;
    }

    default:
      return false;
  }
}

function requireManageGuild(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error("Do zmiany ustawień serwera potrzebujesz uprawnienia Zarządzanie serwerem.");
  }
}
