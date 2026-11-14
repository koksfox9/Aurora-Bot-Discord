import { config } from "./config.js";
import { logger } from "./logger.js";
import { registerCommands } from "./discord/registerCommands.js";

try {
  await registerCommands(config);
} catch (error) {
  logger.error("Slash command deployment failed", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
}
