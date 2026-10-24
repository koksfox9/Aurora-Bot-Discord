import { REST, Routes } from "discord.js";
import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import { slashCommands } from "./commandDefinitions.js";

export async function registerCommands(config: AppConfig) {
  const rest = new REST({ version: "10" }).setToken(config.discord.token);
  const route = config.discord.guildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
    : Routes.applicationCommands(config.discord.clientId);

  await rest.put(route, { body: slashCommands });
  logger.info("slash commands registered", {
    scope: config.discord.guildId ? `guild:${config.discord.guildId}` : "global",
    count: slashCommands.length
  });
}
