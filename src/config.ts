import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const rootDir = process.cwd();

// Wartość z .env.example – publicznie znana, więc nigdy nie może działać jako token.
const PANEL_TOKEN_PLACEHOLDER = "replace-with-a-random-panel-token";
const PANEL_TOKEN_MIN_LENGTH = 16;

const boolFromEnv = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value === "") return undefined;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().url().optional(),
  LAVALINK_HOST: z.string().default("127.0.0.1"),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  LAVALINK_PASSWORD: z.string().min(1, "LAVALINK_PASSWORD is required"),
  LAVALINK_SECURE: boolFromEnv.default(false),
  PREMIUM_GUILD_IDS: z.string().optional(),
  PREMIUM_USER_IDS: z.string().optional(),
  FREE_QUEUE_LIMIT: z.coerce.number().int().min(1).default(50),
  FREE_COOLDOWN_SECONDS: z.coerce.number().min(5).max(10).default(7),
  PREMIUM_COOLDOWN_SECONDS: z.coerce.number().min(2).max(3).default(2),
  WEB_HOST: z.string().default("127.0.0.1"),
  WEB_PORT: z.coerce.number().int().positive().default(3100),
  WEB_PANEL_TOKEN: z
    .string()
    .optional()
    .refine((value) => !value || value === PANEL_TOKEN_PLACEHOLDER || value.length >= PANEL_TOKEN_MIN_LENGTH, {
      message: `WEB_PANEL_TOKEN musi mieć co najmniej ${PANEL_TOKEN_MIN_LENGTH} znaków (albo zostaw go pustego, żeby wyłączyć panel)`
    }),
  DATA_DIR: z.string().default("./data"),
  DEFAULT_VOLUME: z.coerce.number().min(1).max(100).default(75)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const errors = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid configuration:\n${errors}`);
}

const env = parsedEnv.data;
const dataDir = path.resolve(rootDir, env.DATA_DIR);

export const config = {
  rootDir,
  discord: {
    token: env.DISCORD_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID || undefined
  },
  spotify: {
    clientId: env.SPOTIFY_CLIENT_ID || undefined,
    clientSecret: env.SPOTIFY_CLIENT_SECRET || undefined,
    redirectUri: env.SPOTIFY_REDIRECT_URI || undefined
  },
  lavalink: {
    host: env.LAVALINK_HOST,
    port: env.LAVALINK_PORT,
    password: env.LAVALINK_PASSWORD,
    secure: env.LAVALINK_SECURE ?? false
  },
  premium: {
    guildIds: parseIdSet(env.PREMIUM_GUILD_IDS),
    userIds: parseIdSet(env.PREMIUM_USER_IDS),
    freeQueueLimit: env.FREE_QUEUE_LIMIT,
    freeCooldownMs: env.FREE_COOLDOWN_SECONDS * 1000,
    premiumCooldownMs: env.PREMIUM_COOLDOWN_SECONDS * 1000
  },
  web: {
    host: env.WEB_HOST,
    port: env.WEB_PORT,
    // Brak tokenu (lub placeholder z .env.example) = panel webowy wyłączony.
    panelToken: env.WEB_PANEL_TOKEN && env.WEB_PANEL_TOKEN !== PANEL_TOKEN_PLACEHOLDER ? env.WEB_PANEL_TOKEN : undefined
  },
  data: {
    dir: dataDir,
    tokenFile: path.join(dataDir, "spotify-tokens.json")
  },
  playback: {
    defaultVolume: env.DEFAULT_VOLUME / 100
  }
} as const;

export type AppConfig = typeof config;

function parseIdSet(value: string | undefined) {
  return new Set((value ?? "").split(",").map((id) => id.trim()).filter(Boolean));
}
