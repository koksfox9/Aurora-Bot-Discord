import type { ChatInputCommandInteraction } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { formatTime } from "../format.js";

export async function handlePlaybackSettingsCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  guildId: string,
  requesterId: string
): Promise<boolean> {
  const command = interaction.commandName;
  if (!["filter", "pause", "resume", "autoplay", "leave", "volume", "seek", "mode24h"].includes(command)) return false;

  const session = players.getOrCreate(guildId);
  switch (command) {
    case "filter": {
      if (!players.isPremium(guildId, requesterId)) throw new Error("Efekty DSP są dostępne w planie Premium.");
      const mode = interaction.options.getString("mode", true) as "off" | "bassboost" | "nightcore" | "8d";
      await interaction.deferReply();
      await session.setFilter(mode);
      await interaction.editReply(`Efekt: ${mode === "off" ? "wyłączony" : mode}.`);
      return true;
    }
    case "pause":
      await interaction.reply(session.pause() ? "Pauza." : "Nic teraz nie gra.");
      return true;
    case "resume":
      await interaction.reply(session.resume() ? "Gram dalej." : "Odtwarzanie nie jest wstrzymane.");
      return true;
    case "autoplay": {
      const enabled = interaction.options.getBoolean("enabled", true);
      session.setSettings({ autoplay: enabled });
      await interaction.reply(
        enabled
          ? "Autoplay włączony. Po opróżnieniu kolejki dobiorę kolejny utwór na podstawie wykonawcy ostatniego utworu."
          : "Autoplay wyłączony."
      );
      return true;
    }
    case "leave":
      await session.disconnect();
      await interaction.reply("Rozłączono.");
      return true;
    case "volume": {
      const value = interaction.options.getInteger("value", true);
      session.setSettings({ volume: value / 100 });
      await interaction.reply(`Głośność: ${value}%`);
      return true;
    }
    case "seek": {
      const seconds = interaction.options.getInteger("seconds", true);
      await interaction.deferReply();
      const target = await session.seek(seconds);
      await interaction.editReply(`Przewinięto do ${formatTime(target * 1000)}.`);
      return true;
    }
    case "mode24h": {
      const enabled = interaction.options.getBoolean("enabled", true);
      if (enabled && !players.isPremium(guildId, requesterId))
        throw new Error("Tryb 24/7 jest dostępny w planie Premium.");
      if (enabled) {
        const configuredChannelId = await players.getGuild24hChannelId(guildId);
        if (configuredChannelId) {
          const channel = await interaction.guild?.channels.fetch(configuredChannelId);
          if (!channel?.isVoiceBased())
            throw new Error("Zapisany kanał 24/7 nie jest już dostępny. Ustaw go ponownie komendą `/music24channel`.");
          await players.connect(channel, interaction.channelId);
        }
      }
      session.setSettings({ stayInChannel: enabled });
      await interaction.reply(`Tryb 24/7: ${enabled ? "włączony" : "wyłączony"}.`);
      return true;
    }
    default:
      return false;
  }
}
