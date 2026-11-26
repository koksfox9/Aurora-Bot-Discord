import { MessageFlags, type ButtonInteraction } from "discord.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import { CooldownManager } from "./CooldownManager.js";
import { assertCanControlPlayback } from "./voiceGuard.js";
import {
  isRadioPlaying,
  nowPlayingPayload,
  queueEmbed,
  queuePageButtons,
  queuePageCount
} from "./commands/queueViews.js";

const componentCooldowns = new CooldownManager();
const queuePaginationCooldowns = new CooldownManager();
const VOLUME_STEP = 0.1;

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
  assertCanControlPlayback(interaction, await players.getDjRoleId(interaction.guildId));
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
      if (!session.skip()) {
        await interaction.reply({ content: "Nic teraz nie gra.", flags: MessageFlags.Ephemeral });
        return;
      }
      break;
    }
    case "music:shuffle":
      session.shuffle();
      break;
    case "music:previous":
      await session.playPrevious();
      break;
    case "music:loop": {
      const current = session.snapshot();
      if (isRadioPlaying(current)) {
        await interaction.reply({
          content: "Przy radiu powtarzanie jest zawsze włączone.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      session.setLoop(current.loop === "none" ? "queue" : current.loop === "queue" ? "track" : "none");
      break;
    }
    case "music:voldown":
    case "music:volup": {
      const delta = interaction.customId === "music:volup" ? VOLUME_STEP : -VOLUME_STEP;
      const volume = session.snapshot().settings.volume;
      session.setSettings({ volume: Math.min(1, Math.max(0.01, Math.round((volume + delta) * 100) / 100)) });
      break;
    }
    case "music:stop":
      session.clearQueue();
      session.skip();
      break;
    default:
      return;
  }
  const snapshot = session.snapshot();
  await interaction.update(nowPlayingPayload(snapshot));
}
