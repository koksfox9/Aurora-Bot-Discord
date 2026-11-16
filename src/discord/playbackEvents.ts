import type { Client } from "discord.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import { nowPlayingComponents, nowPlayingEmbed } from "./commands/queueViews.js";
import { escapeAndTruncate } from "./trackText.js";

export function installPlaybackEventHandler(client: Client, players: PlayerManager) {
  players.on("playback", async (event) => {
    if (!event.snapshot?.textChannelId || !event.track) return;
    try {
      const channel = await client.channels.fetch(event.snapshot.textChannelId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      if (event.type === "trackStart") {
        const payload = { embeds: [nowPlayingEmbed(event.snapshot)], components: nowPlayingComponents(event.snapshot) };
        const previous = await players.getNowPlayingMessage(event.guildId);
        let updated = false;
        if (previous?.channelId === channel.id && "messages" in channel) {
          const oldMessage = await channel.messages.fetch(previous.messageId).catch(() => null);
          if (oldMessage) {
            await oldMessage.edit(payload);
            updated = true;
          }
        } else if (previous) {
          const oldChannel = await client.channels.fetch(previous.channelId).catch(() => null);
          if (oldChannel && "messages" in oldChannel) {
            const oldMessage = await oldChannel.messages.fetch(previous.messageId).catch(() => null);
            await oldMessage?.delete().catch(() => undefined);
          }
        }
        if (!updated) {
          const message = await channel.send(payload);
          await players.setNowPlayingMessage(event.guildId, { channelId: channel.id, messageId: message.id });
        }
      } else if (event.type === "error") {
        await channel.send(
          `Nie udało się odtworzyć **${escapeAndTruncate(event.track.title, 200)}**. Pomijam ten utwór i próbuję kontynuować.`
        );
      }
    } catch {
      // Playback announcements must never interrupt the Lavalink player.
    }
  });
}
