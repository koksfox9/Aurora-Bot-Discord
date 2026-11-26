import type { ChatInputCommandInteraction } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

export async function handlePlaybackControlCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  guildId: string
): Promise<boolean> {
  if (!["skip", "stop", "shuffle", "loop"].includes(interaction.commandName)) return false;
  const session = players.getOrCreate(guildId);

  switch (interaction.commandName) {
    case "skip": {
      await interaction.reply(session.skip() ? "Pominięto utwór." : "Nic teraz nie gra.");
      return true;
    }
    case "stop":
      session.clearQueue();
      session.skip();
      await interaction.reply("Zatrzymano odtwarzanie i wyczyszczono kolejkę.");
      return true;
    case "shuffle":
      session.shuffle();
      await interaction.reply("Kolejka została pomieszana.");
      return true;
    case "loop": {
      const mode = interaction.options.getString("mode", true) as "none" | "queue" | "track";
      session.setLoop(mode);
      await interaction.reply(
        `Powtarzanie: ${mode === "none" ? "wyłączone" : mode === "queue" ? "kolejka" : "utwór"}.`
      );
      return true;
    }
    default:
      return false;
  }
}
