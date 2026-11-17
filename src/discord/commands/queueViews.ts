import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import type { QueueSnapshot } from "../../domain/types.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { formatTime } from "../format.js";
import { escapeAndTruncate, formatTrackLine, truncate } from "../trackText.js";

export async function handleQueueViewCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  guildId: string
): Promise<boolean> {
  if (interaction.commandName !== "queue" && interaction.commandName !== "nowplaying") return false;
  const snapshot = players.getOrCreate(guildId).snapshot();
  if (interaction.commandName === "queue") {
    const page = interaction.options.getInteger("page") ?? 1;
    const pageCount = queuePageCount(snapshot);
    const currentPage = Math.min(page, pageCount);
    await interaction.reply({
      embeds: [queueEmbed(snapshot, currentPage)],
      components: queuePageButtons(currentPage, pageCount)
    });
  } else {
    await interaction.reply(nowPlayingPayload(snapshot));
  }
  return true;
}

const COLORS = { playing: 0x23a6a6, paused: 0xf0a232, idle: 0x6d6f78 } as const;
const PROGRESS_CELLS = 12;
const TITLE_LIMIT = 80;
const ARTIST_LIMIT = 80;
const NEXT_LIMIT = 80;
const LOOP_LABELS = { none: "Wyłączone", queue: "Kolejka", track: "Utwór" } as const;
const SOURCE_LABELS = { youtube: "YouTube", spotify: "Spotify", direct: "Link" } as const;

export function isRadioPlaying(snapshot: QueueSnapshot) {
  return Boolean(snapshot.current && snapshot.radio && snapshot.radio.id === snapshot.current.id);
}

export function nowPlayingPayload(snapshot: QueueSnapshot) {
  return { embeds: [nowPlayingEmbed(snapshot)], components: nowPlayingComponents(snapshot) };
}

export function nowPlayingEmbed(snapshot: QueueSnapshot) {
  const current = snapshot.current;
  if (!current) return idleEmbed(snapshot);

  const radio = isRadioPlaying(snapshot);
  const live = Boolean(current.isLive) || radio;
  const duration = live ? undefined : current.durationMs;
  const position = Math.max(0, duration ? Math.min(snapshot.positionMs, duration) : snapshot.positionMs);

  const embed = new EmbedBuilder()
    .setColor(snapshot.paused ? COLORS.paused : COLORS.playing)
    .setAuthor({ name: snapshot.paused ? "Wstrzymano" : radio ? "Radio 24/7" : "Teraz gra" })
    .setTitle(escapeAndTruncate(current.title, TITLE_LIMIT));

  const url = safeHttpUrl(current.webpageUrl ?? current.url);
  if (url) embed.setURL(url);
  const thumbnail = safeHttpUrl(current.thumbnail);
  if (thumbnail) embed.setThumbnail(thumbnail);

  const description: string[] = [];
  if (current.artist) description.push(escapeAndTruncate(current.artist, ARTIST_LIMIT));
  if (duration) description.push(progressBar(position, duration));
  if (description.length > 0) embed.setDescription(description.join("\n"));

  const time = live ? "Na żywo" : duration ? `${formatTime(position)} / ${formatTime(duration)}` : formatTime(position);
  const upcoming = snapshot.next ? escapeAndTruncate(snapshot.next.title, NEXT_LIMIT) : "Kolejka jest pusta";
  const more = snapshot.next && snapshot.queueTotal > 1 ? ` (+${snapshot.queueTotal - 1} więcej)` : "";
  embed.addFields(
    { name: "Czas", value: time, inline: true },
    { name: "Głośność", value: `${Math.round(snapshot.settings.volume * 100)}%`, inline: true },
    { name: "Powtarzanie", value: radio ? "Radio" : LOOP_LABELS[snapshot.loop], inline: true },
    { name: "Następny", value: `${upcoming}${more}`, inline: false }
  );

  const footer = [
    current.requestedBy ? `Dodał ${truncate(current.requestedBy, 32)}` : undefined,
    SOURCE_LABELS[current.source]
  ].filter(Boolean);
  if (footer.length > 0) embed.setFooter({ text: footer.join(" · ") });
  return embed;
}

function idleEmbed(snapshot: QueueSnapshot) {
  const last = snapshot.history[0];
  const heading = !last ? "Nic teraz nie gra" : snapshot.connected ? "Kolejka zakończona" : "Rozłączono";
  const lines: string[] = [];
  if (last) lines.push(`Ostatnio grało: ${formatTrackLine(last, 160)}`);
  lines.push(
    snapshot.connected && !snapshot.settings.stayInChannel
      ? "Dodaj coś przez `/play`. Rozłączę się po 3 minutach bezczynności."
      : "Dodaj coś przez `/play`."
  );
  return new EmbedBuilder().setColor(COLORS.idle).setAuthor({ name: heading }).setDescription(lines.join("\n"));
}

export function queueEmbed(snapshot: QueueSnapshot, requestedPage: number) {
  const pageSize = 10;
  const pageCount = queuePageCount(snapshot);
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  const lines = snapshot.queue
    .slice(start, start + pageSize)
    .map((track, index) => `${start + index + 1}. ${formatTrackLine(track)}`);
  const embed = new EmbedBuilder().setTitle(`Kolejka · strona ${page}/${pageCount}`).setColor(0xff8a4c);
  embed.addFields(
    { name: "Teraz", value: snapshot.current ? formatTrackLine(snapshot.current, 1_000) : "Nic", inline: false },
    { name: "Następne", value: lines.join("\n").slice(0, 1_024) || "Pusto", inline: false }
  );
  return embed;
}

export function queuePageCount(snapshot: QueueSnapshot) {
  return Math.max(1, Math.ceil(snapshot.queue.length / 10));
}

export function queuePageButtons(page: number, pageCount: number) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue:${page - 1}`)
      .setLabel("Poprzednia")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`queue:${page + 1}`)
      .setLabel("Następna")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount)
  );
  return [row];
}

export function nowPlayingComponents(snapshot: QueueSnapshot) {
  const active = Boolean(snapshot.current);
  const radio = isRadioPlaying(snapshot);
  const volume = snapshot.settings.volume;
  const button = (id: string, emoji: string, style: ButtonStyle, disabled: boolean) =>
    new ButtonBuilder().setCustomId(id).setEmoji(emoji).setStyle(style).setDisabled(disabled);

  const transport = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("music:previous", "⏮️", ButtonStyle.Secondary, !active || radio || snapshot.history.length === 0),
    button("music:toggle", snapshot.paused ? "▶️" : "⏸️", ButtonStyle.Primary, !active),
    button("music:skip", "⏭️", ButtonStyle.Secondary, !active),
    button("music:stop", "⏹️", ButtonStyle.Danger, !active)
  );
  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("music:shuffle", "🔀", ButtonStyle.Secondary, !active || radio || snapshot.queueTotal < 2),
    button(
      "music:loop",
      snapshot.loop === "track" ? "🔂" : "🔁",
      snapshot.loop !== "none" && !radio ? ButtonStyle.Success : ButtonStyle.Secondary,
      !active || radio
    ),
    button("music:voldown", "🔉", ButtonStyle.Secondary, !active || volume <= 0.01),
    button("music:volup", "🔊", ButtonStyle.Secondary, !active || volume >= 1)
  );
  return [transport, options];
}

export function progressBar(position: number, duration: number, cells = PROGRESS_CELLS) {
  const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const filled = Math.round(ratio * cells);
  return `${"▰".repeat(filled)}${"▱".repeat(cells - filled)}`;
}

function safeHttpUrl(value?: string) {
  if (!value || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
