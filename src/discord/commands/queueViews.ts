import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import type { QueueSnapshot, Track } from "../../domain/types.js";
import type { PlayerManager } from "../../player/PlayerManager.js";
import { formatTime } from "../format.js";

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
    await interaction.reply({ embeds: [nowPlayingEmbed(snapshot)], components: nowPlayingComponents(snapshot) });
  }
  return true;
}

export function nowPlayingEmbed(snapshot: QueueSnapshot) {
  const embed = new EmbedBuilder().setTitle("Teraz gra").setColor(0x23a6a6);
  if (snapshot.current) {
    const duration = snapshot.current.durationMs;
    const position = snapshot.positionMs;
    const progress = duration
      ? `\n${progressBar(position, duration)} ${formatTime(position)} / ${formatTime(duration)}`
      : "\nLIVE";
    embed.setDescription(`${trackLine(snapshot.current)}${progress}`);
    if (snapshot.current.thumbnail) embed.setThumbnail(snapshot.current.thumbnail);
  } else {
    embed.setDescription("Nic aktualnie nie gra.");
  }
  embed.addFields({
    name: "Następny",
    value: snapshot.next ? trackLine(snapshot.next) : "Kolejka jest pusta",
    inline: false
  });
  return embed;
}

export function queueEmbed(snapshot: QueueSnapshot, requestedPage: number) {
  const pageSize = 10;
  const pageCount = queuePageCount(snapshot);
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  const lines = snapshot.queue
    .slice(start, start + pageSize)
    .map((track, index) => `${start + index + 1}. ${trackLine(track)}`);
  const embed = new EmbedBuilder().setTitle(`Kolejka · strona ${page}/${pageCount}`).setColor(0xff8a4c);
  embed.addFields(
    { name: "Teraz", value: snapshot.current ? trackLine(snapshot.current) : "Nic", inline: false },
    { name: "Następne", value: lines.join("\n") || "Pusto", inline: false }
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
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("music:toggle")
      .setLabel(snapshot.paused ? "Wznów" : "Pauza")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("music:skip").setLabel("Pomiń").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:shuffle").setLabel("Losuj kolejkę").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:loop").setLabel("Powtórz kolejkę").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("music:stop").setLabel("Stop").setStyle(ButtonStyle.Danger)
  );
  return [row];
}

function progressBar(position: number, duration: number) {
  const steps = 18;
  const active = Math.min(steps, Math.max(0, Math.floor((position / duration) * steps)));
  return `${"━".repeat(active)}●${"─".repeat(steps - active)}`;
}

function trackLine(track: Track) {
  const author = track.artist ? ` - ${track.artist}` : "";
  const live = track.isLive ? " [LIVE]" : "";
  return `**${track.title}**${author}${live}`;
}
