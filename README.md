# Aurora Music Bot

Aurora is a Discord music bot built with TypeScript, Discord.js, Kazagumo and Lavalink v4. Audio is resolved and streamed by a separate Lavalink node; the bot does not use `yt-dlp` or `@discordjs/voice` for playback.

## Features

- YouTube URLs, playlists and text search through the Lavalink YouTube plugin.
- Spotify track, album and playlist metadata resolved by LavaSrc, then mirrored to an available audio source. Spotify itself does not provide raw song audio to this bot.
- OAuth import of a user's private Spotify playlists. Playlist items are read through Spotify's Web API; audio resolution still happens through Lavalink.
- Gapless queue playback, repeat modes, shuffle, seek and volume; Premium includes Lavalink filters (bass boost, nightcore and 8D).
- Radio/live streams, 24/7 mode and unbounded queues are restricted to IDs configured as Premium.
- Free queue limit and per-user command cooldowns are configurable.
- Web panel and Discord controls share the same per-server Lavalink queue.
- Lavalink error, stuck-track and resolution events are logged and announced; failed active tracks are skipped so the queue can continue.
- Free sessions disconnect after three minutes with an empty voice channel or idle queue.
- Playback controls (commands and buttons) and moving the bot require being in the bot's voice channel while it has listeners. Members with Manage Server can always control it, and anyone can when the bot's channel has no humans (e.g. 24/7 radio).

Lavalink queue playback provides gapless transitions. This build does not implement crossfade, local audio caching, loudness normalization or voice-speaking ducking; these require additional audio-processing components and are not supplied by Lavalink settings alone.
Opus encoding quality is set to Lavalink's maximum. The actual voice bitrate is still bounded by Discord's channel/server settings, so the bot cannot promise a fixed 320 kbps.

## Requirements

- Node.js 22 or newer and pnpm.
- Docker Desktop (or another Docker Compose runtime) for the local Lavalink service.
- A Discord application and bot token.
- Spotify Developer credentials only if private playlist import is needed.

## Setup

1. Copy `.env.example` to `.env` and fill in the Discord token and application client ID. Keep `.env` private.
2. Set the same strong `LAVALINK_PASSWORD` for the bot and Lavalink. Set Spotify client ID/secret in `.env` if using Spotify links or private playlists. Add the exact callback URL shown by `SPOTIFY_REDIRECT_URI` to the Spotify app's redirect URI list.
3. Install and build:

```powershell
pnpm install
pnpm build
```

4. Start Lavalink, then the bot:

```powershell
pnpm lavalink:up
pnpm lavalink:logs
pnpm start
```

The Lavalink REST/WebSocket node is private on `127.0.0.1:2333`; the panel defaults to `http://127.0.0.1:3100`. `pnpm lavalink:logs` can be used in a second terminal to inspect plugin startup and source errors.

## Discord Commands

- `/play query:<link albo nazwa>` and `/playlist url:<link>`
- `/spotify-login`, `/spotify-playlists`, `/spotify-playlist value:<id albo link>`
- `/radio url:<stream> name:<nazwa>` (Premium)
- `/queue page:<numer>`, `/nowplaying`, `/np`, `/now`
- `/pause`, `/resume`, `/skip`, `/stop`, `/shuffle`, `/loop`, `/seek`, `/volume`
- `/filter mode:<off|bassboost|nightcore|8d>` (Premium)
- `/join`, `/leave`, `/mode24h enabled:<true|false>` (24/7 is Premium)

## Configuration

- `PREMIUM_GUILD_IDS` and `PREMIUM_USER_IDS`: comma-separated Discord IDs.
- `FREE_QUEUE_LIMIT`: queued track limit for free users (default 50).
- `FREE_COOLDOWN_SECONDS` and `PREMIUM_COOLDOWN_SECONDS`: per-user command cooldowns.
- `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`: bot-to-node connection. The Docker service reads the same password from `.env`.
- `SPOTIFY_REDIRECT_URI`: must exactly match the redirect URL registered in Spotify Developer Dashboard.
- `WEB_PANEL_TOKEN`: enables the web panel. At least 16 characters; if it is empty (or still the placeholder from `.env.example`) the panel, its API and Socket.IO are not started at all, and only the Spotify OAuth callback stays up. The token is sent in the `x-panel-token` header (Socket.IO: `auth.token`), never in the URL. Generate one with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

## Structure

- `application.yml`, `compose.yaml`: Lavalink node and source plugins.
- `src/player`: per-guild queue/session adapter over Kazagumo.
- `src/sources`: Spotify metadata/OAuth and radio metadata.
- `src/discord`: slash commands, buttons and cooldowns.
- `src/web` and `public`: HTTP API, Socket.IO updates and the web panel.
