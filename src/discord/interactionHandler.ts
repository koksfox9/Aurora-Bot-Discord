import type { ButtonInteraction, ChatInputCommandInteraction, Client, GuildMember, VoiceBasedChannel } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} from "discord.js";
import type { QueueSnapshot, Track } from "../domain/types.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import type { SourceRegistry } from "../sources/SourceRegistry.js";
import { assertSingleMediaLink } from "../sources/SourceRegistry.js";
import { CooldownManager } from "./CooldownManager.js";

const commandCooldowns = new CooldownManager();
const componentCooldowns = new CooldownManager();

export function installInteractionHandler(client: Client, players: PlayerManager, sources: SourceRegistry) {
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      try {
        await handleButton(interaction, players);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const retryAt = commandCooldowns.check(
      interaction.user.id,
      interaction.guildId ? players.cooldownMs(interaction.guildId, interaction.user.id) : 7000
    );
    if (retryAt) {
      await interaction.reply({
        content: `Odczekaj chwilę. Możesz spróbować ponownie <t:${Math.ceil(retryAt / 1000)}:R>.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      await handleCommand(interaction, players, sources);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await respond(interaction, `Nie udało się: ${message}`, true);
    }
  });

  players.on("playback", async (event) => {
    if (!event.snapshot?.textChannelId || !event.track) return;
    try {
      const channel = await client.channels.fetch(event.snapshot.textChannelId);
      if (!channel?.isTextBased() || !("send" in channel)) return;
      if (event.type === "trackStart") {
        await channel.send({ embeds: [nowPlayingEmbed(event.snapshot)], components: nowPlayingComponents(event.snapshot) });
      } else if (event.type === "error") {
        await channel.send(`Nie udało się odtworzyć **${event.track.title}**. Pomijam ten utwór i próbuję kontynuować.`);
      }
    } catch {
      // Playback announcements must never interrupt the Lavalink player.
    }
  });
}

async function handleCommand(interaction: ChatInputCommandInteraction, players: PlayerManager, sources: SourceRegistry) {
  if (!interaction.guildId) throw new Error("Ta komenda działa tylko na serwerze.");
  const guildId = interaction.guildId;
  const session = players.get(guildId);
  const requester = { id: interaction.user.id, username: interaction.user.username };

  switch (interaction.commandName) {
    case "join": {
      await interaction.deferReply();
      const voice = await requireVoiceChannel(interaction);
      const before = session.snapshot();
      await players.connect(voice, interaction.channelId);
      const message = before.connected && before.voiceChannelId === voice.id
        ? `Jestem już na kanale ${voice.name}.`
        : `Połączono z kanałem ${voice.name}.`;
      await interaction.editReply(message);
      return;
    }

    case "play": {
      const query = interaction.options.getString("query", true).trim();
      assertSingleMediaLink(query);
      await players.runMediaRequest(guildId, async () => {
        await interaction.deferReply();
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        const result = await session.enqueueQuery(query, requester, players.queueLimit(guildId, requester.id));
        const titles = result.tracks.slice(0, 3).map((track) => `**${track.title}**`).join(", ");
        const more = result.tracks.length > 3 ? ` i ${result.tracks.length - 3} więcej` : "";
        const limitNote = result.truncated ? " (reszta przekracza limit kolejki)" : "";
        await interaction.editReply(`Dodano ${titles}${more}${limitNote}.`);
      });
      return;
    }

    case "playlist": {
      const url = interaction.options.getString("url", true).trim();
      const limit = interaction.options.getInteger("limit") ?? 100;
      assertSingleMediaLink(url);
      await players.runMediaRequest(guildId, async () => {
        await interaction.deferReply();
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        const result = await session.enqueueQuery(url, requester, Math.min(players.queueLimit(guildId, requester.id), limit));
        await interaction.editReply(`Dodano ${result.tracks.length} utworów z playlisty${result.truncated ? " (osiągnięto limit)" : ""}.`);
      });
      return;
    }

    case "spotify-login": {
      const url = sources.spotify.createAuthorizeUrl(interaction.user.id);
      await interaction.reply({ content: `Połącz Spotify tutaj: ${url}`, flags: MessageFlags.Ephemeral });
      return;
    }

    case "spotify-playlists": {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const playlists = await sources.spotify.listUserPlaylists(interaction.user.id);
      const lines = playlists.slice(0, 20).map((playlist, index) => `${index + 1}. ${playlist.name} (${playlist.id})`).join("\n");
      await interaction.editReply(lines || "Nie widzę playlist na tym koncie.");
      return;
    }

    case "spotify-playlist": {
      const value = interaction.options.getString("value", true).trim();
      const limit = interaction.options.getInteger("limit") ?? 100;
      assertSingleMediaLink(value);
      await players.runMediaRequest(guildId, async () => {
        await interaction.deferReply();
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        let tracks: Track[];
        try {
          tracks = await sources.spotify.playlistTracks(value, requester.username, requester.id, limit);
        } catch (error) {
          if (!/^https?:\/\//i.test(value) && !value.startsWith("spotify:")) throw error;
          const result = await session.enqueueQuery(value, requester, Math.min(players.queueLimit(guildId, requester.id), limit));
          await interaction.editReply(`Dodano ${result.tracks.length} utworów Spotify przez LavaSrc${result.truncated ? " (osiągnięto limit)" : ""}.`);
          return;
        }
        const result = await session.enqueueSpotifyTracks(tracks, requester, players.queueLimit(guildId, requester.id));
        await interaction.editReply(`Dodano ${result.added} utworów Spotify${result.omitted ? `; pominięto ${result.omitted} niedostępnych` : ""}.`);
      });
      return;
    }

    case "radio": {
      if (!players.isPremium(guildId, requester.id)) throw new Error("Radio 24/7 jest dostępne w planie Premium.");
      const url = interaction.options.getString("url", true).trim();
      const name = interaction.options.getString("name") ?? undefined;
      assertSingleMediaLink(url);
      await players.runMediaRequest(guildId, async () => {
        await interaction.deferReply();
        const voice = await requireVoiceChannel(interaction);
        await players.connect(voice, interaction.channelId);
        const radio = await session.setRadio(url, name, requester);
        await interaction.editReply(`Radio 24/7 ustawione: **${radio.title}**`);
      });
      return;
    }

    case "queue": {
      const page = interaction.options.getInteger("page") ?? 1;
      await interaction.reply({ embeds: [queueEmbed(session.snapshot(), page)] });
      return;
    }

    case "now":
    case "nowplaying":
    case "np": {
      const snapshot = session.snapshot();
      await interaction.reply({ embeds: [nowPlayingEmbed(snapshot)], components: nowPlayingComponents(snapshot) });
      return;
    }

    case "skip": {
      const skipped = session.skip();
      await interaction.reply(skipped ? "Pomijam utwór." : "Nic teraz nie gra.");
      return;
    }

    case "stop": {
      session.clearQueue();
      session.skip();
      await interaction.reply("Zatrzymano odtwarzanie i wyczyszczono kolejkę.");
      return;
    }

    case "shuffle": {
      session.shuffle();
      await interaction.reply("Kolejka została pomieszana.");
      return;
    }

    case "loop": {
      const mode = interaction.options.getString("mode", true) as "none" | "queue" | "track";
      session.setLoop(mode);
      await interaction.reply(`Powtarzanie: ${mode === "none" ? "wyłączone" : mode === "queue" ? "kolejka" : "utwór"}.`);
      return;
    }

    case "filter": {
      if (!players.isPremium(guildId, requester.id)) throw new Error("Efekty DSP są dostępne w planie Premium.");
      const mode = interaction.options.getString("mode", true) as "off" | "bassboost" | "nightcore" | "8d";
      await interaction.deferReply();
      await session.setFilter(mode);
      await interaction.editReply(`Efekt: ${mode === "off" ? "wyłączony" : mode}.`);
      return;
    }

    case "pause": {
      await interaction.reply(session.pause() ? "Pauza." : "Nic teraz nie gra.");
      return;
    }

    case "resume": {
      await interaction.reply(session.resume() ? "Gram dalej." : "Odtwarzanie nie jest wstrzymane.");
      return;
    }

    case "leave": {
      session.disconnect();
      await interaction.reply("Rozłączono.");
      return;
    }

    case "volume": {
      const value = interaction.options.getInteger("value", true);
      session.setSettings({ volume: value / 100 });
      await interaction.reply(`Głośność: ${value}%`);
      return;
    }

    case "seek": {
      const seconds = interaction.options.getInteger("seconds", true);
      await interaction.deferReply();
      const target = await session.seek(seconds);
      await interaction.editReply(`Przewinięto do ${formatTime(target * 1000)}.`);
      return;
    }

    case "mode24h": {
      const enabled = interaction.options.getBoolean("enabled", true);
      if (enabled && !players.isPremium(guildId, requester.id)) throw new Error("Tryb 24/7 jest dostępny w planie Premium.");
      session.setSettings({ stayInChannel: enabled });
      await interaction.reply(`Tryb 24/7: ${enabled ? "włączony" : "wyłączony"}.`);
      return;
    }

    default:
      throw new Error("Nieznana komenda.");
  }
}

async function handleButton(interaction: ButtonInteraction, players: PlayerManager) {
  if (!interaction.guildId || !interaction.customId.startsWith("music:")) return;
  const retryAt = componentCooldowns.check(interaction.user.id, 3000);
  if (retryAt) {
    await interaction.reply({
      content: `Odczekaj chwilę. Możesz użyć przycisków ponownie <t:${Math.ceil(retryAt / 1000)}:R>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const session = players.get(interaction.guildId);
  switch (interaction.customId) {
    case "music:toggle":
      session.snapshot().paused ? session.resume() : session.pause();
      break;
    case "music:skip":
      session.skip();
      break;
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

async function requireVoiceChannel(interaction: ChatInputCommandInteraction): Promise<VoiceBasedChannel> {
  if (!interaction.guild) throw new Error("Brak serwera.");
  const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
  const channel = member.voice.channel;
  if (!channel) throw new Error("Najpierw wejdź na kanał głosowy.");
  return channel;
}

async function respond(interaction: ChatInputCommandInteraction, content: string, ephemeral = false) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(content);
  } else {
    await interaction.reply({ content, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
  }
}

function nowPlayingEmbed(snapshot: QueueSnapshot) {
  const embed = new EmbedBuilder().setTitle("Teraz gra").setColor(0x23a6a6);
  if (snapshot.current) {
    const duration = snapshot.current.durationMs;
    const position = snapshot.positionMs;
    const progress = duration ? `\n${progressBar(position, duration)} ${formatTime(position)} / ${formatTime(duration)}` : "\nLIVE";
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

function queueEmbed(snapshot: QueueSnapshot, requestedPage: number) {
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(snapshot.queue.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  const lines = snapshot.queue.slice(start, start + pageSize).map((track, index) => `${start + index + 1}. ${trackLine(track)}`);
  const embed = new EmbedBuilder().setTitle(`Kolejka · strona ${page}/${pageCount}`).setColor(0xff8a4c);
  embed.addFields(
    { name: "Teraz", value: snapshot.current ? trackLine(snapshot.current) : "Nic", inline: false },
    { name: "Następne", value: lines.join("\n") || "Pusto", inline: false }
  );
  return embed;
}

function nowPlayingComponents(snapshot: QueueSnapshot) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("music:toggle").setLabel(snapshot.paused ? "Wznów" : "Pauza").setStyle(ButtonStyle.Primary),
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

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function trackLine(track: Track) {
  const author = track.artist ? ` - ${track.artist}` : "";
  const live = track.isLive ? " [LIVE]" : "";
  return `**${track.title}**${author}${live}`;
}

export { nowPlayingEmbed };
