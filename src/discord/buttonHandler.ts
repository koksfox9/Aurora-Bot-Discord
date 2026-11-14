import { MessageFlags, type ButtonInteraction } from "discord.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import { CooldownManager } from "./CooldownManager.js";
import { assertCanControlPlayback } from "./voiceGuard.js";
import { requestSkip, skipVoteMessage } from "./commands/playbackControl.js";
import {
  nowPlayingComponents,
  nowPlayingEmbed,
  queueEmbed,
  queuePageButtons,
  queuePageCount
} from "./commands/queueViews.js";

const componentCooldowns = new CooldownManager();
const queuePaginationCooldowns = new CooldownManager();

export async function handleButton(interaction: ButtonInteraction, players: PlayerManager) {
  if (!interaction.guildId) return;
  if (interaction.customId.startsWith("queue:")) {
    const retryAt = queuePaginationCooldowns.check(interaction.user.id, 750);
    if (retryAt) {
      await interaction.reply({
        content: `Odczekaj chwilę przed zmianą strony <t:${Math.ceil(retryAt / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    const requestedPage = Number(interaction.customId.slice("queue:".length));
    const snapshot = players.snapshot(interaction.guildId);
    const pageCount = queuePageCount(snapshot);
    const page = Number.isInteger(requestedPage) ? Math.min(Math.max(1, requestedPage), pageCount) : 1;
    await interaction.update({ embeds: [queueEmbed(snapshot, page)], components: queuePageButtons(page, pageCount) });
    return;
  }
  if (!interaction.customId.startsWith("music:")) return;
  const djRoleId = await players.getDjRoleId(interaction.guildId);
  assertCanControlPlayback(interaction, djRoleId);
  const retryAt = componentCooldowns.check(interaction.user.id, 3000);
  if (retryAt) {
    await interaction.reply({
      content: `Odczekaj chwilę. Możesz użyć przycisków ponownie <t:${Math.ceil(retryAt / 1000)}:R>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const session = players.getOrCreate(interaction.guildId);
  switch (interaction.customId) {
    case "music:toggle":
      if (session.snapshot().paused) session.resume();
      else session.pause();
      break;
    case "music:skip": {
      const result = requestSkip(interaction, session, djRoleId);
      if (result.status === "pending" || result.status === "duplicate" || result.status === "empty") {
        await interaction.reply({ content: skipVoteMessage(result), flags: MessageFlags.Ephemeral });
        return;
      }
      break;
    }
    case "music:shuffle":
      session.shuffle();
      break;
    case "music:loop":
      session.setLoop(session.snapshot().loop === "queue" ? "none" : "queue");
      break;
    case "music:stop":
      session.clearQueue();
      session.skip();
      break;
    default:
      return;
  }
  const snapshot = session.snapshot();
  await interaction.update({ embeds: [nowPlayingEmbed(snapshot)], components: nowPlayingComponents(snapshot) });
}
