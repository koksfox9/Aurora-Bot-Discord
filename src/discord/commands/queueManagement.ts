import type { ChatInputCommandInteraction } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

const QUEUE_COMMANDS = new Set(["clear", "remove", "move", "skipto", "previous"]);

export async function handleQueueManagementCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  guildId: string
): Promise<boolean> {
  if (!QUEUE_COMMANDS.has(interaction.commandName)) return false;

  const session = players.getOrCreate(guildId);
  switch (interaction.commandName) {
    case "clear": {
      const removed = session.clearUpcomingQueue();
      await interaction.reply(
        removed > 0
          ? `Kolejka wyczyszczona (${removed}). Aktualny utwór gra dalej.`
          : "Kolejka jest już pusta. Aktualny utwór gra dalej."
      );
      return true;
    }
    case "remove": {
      const position = interaction.options.getInteger("position", true);
      const removed = session.removeQueued(position);
      await interaction.reply(`Usunięto **${removed.title}** z pozycji ${position}.`);
      return true;
    }
    case "move": {
      const from = interaction.options.getInteger("from", true);
      const to = interaction.options.getInteger("to", true);
      const moved = session.moveQueued(from, to);
      await interaction.reply(
        moved ? `Przeniesiono **${moved.title}** z pozycji ${from} na ${to}.` : `Utwór jest już na pozycji ${from}.`
      );
      return true;
    }
    case "skipto": {
      const position = interaction.options.getInteger("position", true);
      const track = await session.skipTo(position);
      await interaction.reply(`Przechodzę do **${track.title}** (pozycja ${position}).`);
      return true;
    }
    case "previous": {
      const track = await session.playPrevious();
      await interaction.reply(`Odtwarzam poprzedni utwór: **${track.title}**. Bieżący wrócił na początek kolejki.`);
      return true;
    }
    default:
      return false;
  }
}
