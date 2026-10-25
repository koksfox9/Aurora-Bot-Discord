import { PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";

/**
 * Komendy, które sterują odtwarzaniem albo przenoszą bota na inny kanał.
 * Niechronione (czysto informacyjne): queue, now, nowplaying, np, spotify-login, spotify-playlists.
 */
export const VOICE_GUARDED_COMMANDS: ReadonlySet<string> = new Set([
  "join",
  "play",
  "playlist",
  "spotify-playlist",
  "radio",
  "skip",
  "stop",
  "shuffle",
  "loop",
  "filter",
  "pause",
  "resume",
  "leave",
  "volume",
  "seek",
  "mode24h"
]);

/**
 * Zasada: jeśli bot jest na kanale głosowym, na którym ktoś go słucha, to sterować nim
 * (i przenosić go) mogą tylko osoby z tego samego kanału. Wyjątki:
 *  - bot nie jest na żadnym kanale (nie ma czego chronić),
 *  - na kanale bota nie ma żadnego człowieka (np. radio 24/7 w pustym kanale),
 *  - użytkownik ma uprawnienie "Zarządzanie serwerem".
 *
 * Źródłem prawdy jest własny voice state bota z cache Discorda, a nie stan sesji w pamięci,
 * dzięki czemu zasada działa też po przeniesieniu bota przez moderatora.
 */
export function assertCanControlPlayback(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const guild = interaction.guild;
  if (!guild) throw new Error("Ta akcja działa tylko na serwerze.");

  const botChannel = guild.members.me?.voice.channel;
  if (!botChannel) return;

  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return;

  const listeners = botChannel.members.filter((member) => !member.user.bot).size;
  if (listeners === 0) return;

  const userChannelId = guild.voiceStates.cache.get(interaction.user.id)?.channelId;
  if (userChannelId !== botChannel.id) {
    throw new Error(`Musisz być na kanale głosowym bota (<#${botChannel.id}>), aby tego użyć.`);
  }
}
