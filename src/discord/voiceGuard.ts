import {
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type VoiceBasedChannel
} from "discord.js";

/**
 * Komendy, które sterują odtwarzaniem albo przenoszą bota na inny kanał.
 * Niechronione (czysto informacyjne): queue, nowplaying, spotify-login, spotify-playlists.
 */
export const VOICE_GUARDED_COMMANDS: ReadonlySet<string> = new Set([
  "play",
  "playlist",
  "spotify-playlist",
  "radio",
  "skip",
  "clear",
  "remove",
  "move",
  "skipto",
  "previous",
  "stop",
  "shuffle",
  "loop",
  "filter",
  "pause",
  "resume",
  "autoplay",
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
export function assertCanControlPlayback(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  djRoleId?: string
) {
  const guild = interaction.guild;
  if (!guild) throw new Error("Ta akcja działa tylko na serwerze.");

  const botChannel = guild.members.me?.voice.channel;
  if (!botChannel) return;

  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return;
  if (djRoleId && memberHasRole(interaction, djRoleId)) return;

  const listeners = botChannel.members.filter((member) => !member.user.bot).size;
  if (listeners === 0) return;

  const userChannelId = guild.voiceStates.cache.get(interaction.user.id)?.channelId;
  if (userChannelId !== botChannel.id) {
    throw new Error(`Musisz być na kanale głosowym bota (<#${botChannel.id}>), aby tego użyć.`);
  }
}

export async function requireVoiceChannel(interaction: ChatInputCommandInteraction): Promise<VoiceBasedChannel> {
  if (!interaction.guild) throw new Error("Brak serwera.");
  const voiceState = interaction.guild.voiceStates.cache.get(interaction.user.id);
  const channel = voiceState?.channel;
  if (!channel) throw new Error("Najpierw wejdź na kanał głosowy.");
  return channel;
}

function memberHasRole(interaction: ChatInputCommandInteraction | ButtonInteraction, roleId: string) {
  const roles = interaction.member?.roles;
  if (!roles) return false;
  return Array.isArray(roles) ? roles.includes(roleId) : roles.cache.has(roleId);
}
