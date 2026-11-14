import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Client } from "discord.js";
import { logger } from "../logger.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import type { SpotifyClient } from "../sources/SpotifyClient.js";
import { CooldownManager } from "./CooldownManager.js";
import { VOICE_GUARDED_COMMANDS, assertCanControlPlayback } from "./voiceGuard.js";
import { handleGuildSettingsCommand } from "./commands/guildSettings.js";
import { handleMediaCommand } from "./commands/media.js";
import { handlePlaybackSettingsCommand } from "./commands/playbackSettings.js";
import { handleQueueManagementCommand } from "./commands/queueManagement.js";
import { handlePlaybackControlCommand } from "./commands/playbackControl.js";
import { handleLyricsCommand } from "./commands/lyrics.js";
import { handleHelpCommand } from "./commands/help.js";
import { handleQueueViewCommand } from "./commands/queueViews.js";
import { handleButton } from "./buttonHandler.js";
import { installPlaybackEventHandler } from "./playbackEvents.js";

const commandCooldowns = new CooldownManager();
const AUTOCOMPLETE_COMMANDS = new Set(["play", "search"]);

export function installInteractionHandler(client: Client, players: PlayerManager, spotify: SpotifyClient) {
  installPlaybackEventHandler(client, players);
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
      try {
        if (
          !AUTOCOMPLETE_COMMANDS.has(interaction.commandName) ||
          interaction.options.getFocused(true).name !== "query"
        ) {
          await interaction.respond([]);
          return;
        }
        const query = interaction.options.getFocused().trim();
        if (query.length < 2 || /^https?:\/\//i.test(query)) {
          await interaction.respond([]);
          return;
        }
        const requester = { id: interaction.user.id, username: interaction.user.username };
        const tracks = await players.searchAutocompleteTracks(query, requester);
        const choices = tracks.flatMap((track) => {
          if (!track.uri || track.uri.length > 100) return [];
          const label = `${track.title}${track.author ? ` — ${track.author}` : ""}`;
          return [{ name: [...label].slice(0, 100).join(""), value: track.uri }];
        });
        await interaction.respond(choices.slice(0, 25));
      } catch {
        try {
          await interaction.respond([]);
        } catch (error) {
          logInteractionResponseFailure("autocomplete response", error);
        }
      }
      return;
    }
    if (interaction.isButton()) {
      try {
        await handleButton(interaction, players);
      } catch (error) {
        logCommandFailure("button", interaction.guildId, interaction.user.id, error);
        await replyToButtonError(interaction, userFacingError(error));
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;

    const retryAt = commandCooldowns.check(
      interaction.user.id,
      interaction.guildId ? players.cooldownMs(interaction.guildId, interaction.user.id) : 7000
    );
    if (retryAt) {
      await respond(
        interaction,
        `Odczekaj chwilę. Możesz spróbować ponownie <t:${Math.ceil(retryAt / 1000)}:R>.`,
        true
      );
      return;
    }

    try {
      await handleCommand(interaction, players, spotify);
    } catch (error) {
      logCommandFailure(interaction.commandName, interaction.guildId, interaction.user.id, error);
      await respond(interaction, `Nie udało się: ${userFacingError(error)}`, true);
    }
  });
}

async function handleCommand(interaction: ChatInputCommandInteraction, players: PlayerManager, spotify: SpotifyClient) {
  if (!interaction.guildId) throw new Error("Ta komenda działa tylko na serwerze.");
  const guildId = interaction.guildId;
  if (await handleGuildSettingsCommand(interaction, players)) return;
  const djRoleId = await players.getDjRoleId(guildId);
  if (VOICE_GUARDED_COMMANDS.has(interaction.commandName)) assertCanControlPlayback(interaction, djRoleId);
  const requester = { id: interaction.user.id, username: interaction.user.username };
  if (await handleMediaCommand(interaction, players, spotify, guildId, djRoleId, requester)) return;
  if (await handlePlaybackSettingsCommand(interaction, players, guildId, requester.id)) return;
  if (await handleQueueManagementCommand(interaction, players, guildId)) return;
  if (await handlePlaybackControlCommand(interaction, players, guildId, djRoleId)) return;
  if (await handleLyricsCommand(interaction, players, guildId)) return;
  if (await handleHelpCommand(interaction)) return;
  if (await handleQueueViewCommand(interaction, players, guildId)) return;
  throw new Error("Nieznana komenda.");
}

async function respond(interaction: ChatInputCommandInteraction, content: string, ephemeral = false) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
    } else {
      await interaction.reply({ content, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
    }
  } catch (error) {
    logInteractionResponseFailure("command response", error);
  }
}

async function replyToButtonError(interaction: ButtonInteraction, content: string) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    logInteractionResponseFailure("button error response", error);
  }
}

function logInteractionResponseFailure(operation: string, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const details = { operation, code, error: message, stack: error instanceof Error ? error.stack : undefined };
  if (code === 10062) logger.debug("Discord interaction expired before a response could be sent", details);
  else logger.warn("Could not send a Discord interaction response", details);
}

function logCommandFailure(command: string, guildId: string | null, userId: string, error: unknown) {
  logger.warn("Discord interaction failed", {
    command,
    guildId,
    userId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
}

function userFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Spotify is not connected")) return "Połącz konto Spotify komendą /spotify-login.";
  if (message.includes("Spotify token expired") || message.includes("no refresh token"))
    return "Połącz ponownie konto Spotify komendą /spotify-login.";
  if (message.includes("Spotify is not configured"))
    return "Integracja Spotify nie jest skonfigurowana przez administratora.";
  if (message.includes("Spotify token request failed") || message.includes("Spotify API request failed"))
    return "Spotify chwilowo nie odpowiada. Spróbuj ponownie później.";
  if (message.includes("Spotify playlist URL is invalid")) return "Podaj prawidłowy link lub ID playlisty Spotify.";

  const safePolishPrefixes = [
    "Nie ",
    "Nie ma",
    "Nieznana",
    "Nic teraz",
    "Kolejka",
    "Brak ",
    "Podaj ",
    "Wybierz ",
    "Bot ",
    "Ta ",
    "Tryb ",
    "Radio ",
    "Efekty ",
    "Do "
  ];
  if (/[ąćęłńóśźż]/i.test(message) || safePolishPrefixes.some((prefix) => message.startsWith(prefix))) return message;
  return "Wystąpił nieoczekiwany błąd. Spróbuj ponownie za chwilę.";
}
