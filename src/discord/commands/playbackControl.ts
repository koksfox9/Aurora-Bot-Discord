import { PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import type { PlayerManager } from "../../player/PlayerManager.js";

type SkipInteraction = ChatInputCommandInteraction | ButtonInteraction;
type PlayerSession = ReturnType<PlayerManager["getOrCreate"]>;

export async function handlePlaybackControlCommand(
  interaction: ChatInputCommandInteraction,
  players: PlayerManager,
  guildId: string,
  djRoleId?: string
): Promise<boolean> {
  if (!["skip", "stop", "shuffle", "loop"].includes(interaction.commandName)) return false;
  const session = players.getOrCreate(guildId);

  switch (interaction.commandName) {
    case "skip": {
      const result = requestSkip(interaction, session, djRoleId);
      await interaction.reply(skipVoteMessage(result));
      return true;
    }
    case "stop":
      session.clearQueue();
      session.skip();
      await interaction.reply("Zatrzymano odtwarzanie i wyczyszczono kolejkę.");
      return true;
    case "shuffle":
      session.shuffle();
      await interaction.reply("Kolejka została pomieszana.");
      return true;
    case "loop": {
      const mode = interaction.options.getString("mode", true) as "none" | "queue" | "track";
      session.setLoop(mode);
      await interaction.reply(
        `Powtarzanie: ${mode === "none" ? "wyłączone" : mode === "queue" ? "kolejka" : "utwór"}.`
      );
      return true;
    }
    default:
      return false;
  }
}

export function requestSkip(interaction: SkipInteraction, session: PlayerSession, djRoleId?: string) {
  const botChannel = interaction.guild?.members.me?.voice.channel;
  const listeners = botChannel?.members.filter((member) => !member.user.bot).size ?? 0;
  const roles = interaction.member?.roles;
  const isDj = djRoleId && roles && (Array.isArray(roles) ? roles.includes(djRoleId) : roles.cache.has(djRoleId));
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || isDj || listeners <= 1) {
    return { status: session.skip() ? ("skipped" as const) : ("empty" as const), votes: 0, required: 1 };
  }
  return session.castSkipVote(interaction.user.id, Math.floor(listeners / 2) + 1);
}

export function skipVoteMessage(result: ReturnType<typeof requestSkip>) {
  switch (result.status) {
    case "skipped":
      return "Pominięto utwór.";
    case "empty":
      return "Nic teraz nie gra.";
    case "duplicate":
      return `Twój głos jest już policzony: ${result.votes}/${result.required}.`;
    default:
      return `Głos za pominięciem zapisany: ${result.votes}/${result.required}.`;
  }
}
