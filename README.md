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

1. Copy `.env.example` to `.env` and fill in the Discord token and application client ID. Keep `.env` private. Copy `.env.youtube.example` to `.env.youtube`; keep it private too.
2. Set the same strong `LAVALINK_PASSWORD` for the bot and Lavalink. Put the YouTube refresh token in `.env.youtube`; use a separate Google account for this OAuth flow. Set Spotify client ID/secret in `.env` if using Spotify links or private playlists. Add the exact callback URL shown by `SPOTIFY_REDIRECT_URI` to the Spotify app's redirect URI list.
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

After changing slash command definitions, run `pnpm build` and then `pnpm deploy:commands`. Restarting the bot no longer registers Discord commands automatically.

### Docker bot image

Build the standalone bot image with `docker build -t aurora-music-bot .`. The image includes a `/health` endpoint and Docker healthcheck. Configure `WEB_HOST=0.0.0.0` to expose the panel outside the container, set `LAVALINK_HOST` to the Lavalink service hostname, and mount persistent storage at `/app/data`. The Compose file still manages Lavalink separately.

### Lavalink failover

The current Compose setup runs one Lavalink node, so failover cannot be verified without provisioning a second node. Shoukaku 4.3.0 already has a default resolver that selects a connected node; a custom `nodeResolver` is unnecessary for the current setup. Its `moveOnDisconnect` option requires another connected node, and player migration after a node crash has a reported reliability issue in the upstream project ([Shoukaku #242](https://github.com/shipgirlproject/Shoukaku/issues/242)). Revisit failover after a second node is available and Shoukaku is updated; test by disconnecting the primary while audio is playing.

## Discord Commands

- `/play query:<link albo nazwa>` (autocomplete z wyborem utworu), `/search query:<nazwa>` (podgląd wyniku) and `/playlist url:<link>`
- `/spotify-login`, `/spotify-playlists`, `/spotify-playlist value:<id albo link>`
- `/radio url:<stream> name:<nazwa>` (Premium)
- `/queue page:<numer>` with page buttons, `/nowplaying`
- `/pause`, `/resume`, `/skip` (głosowanie większości; jedna osoba pomija od razu), `/skipto`, `/previous`, `/remove`, `/move`, `/clear`, `/stop`, `/shuffle`, `/loop`, `/seek`, `/volume`, `/autoplay` (dobiera kolejny utwór na podstawie ostatniego wykonawcy), `/lyrics` (tekst z LRCLIB; wysyła tytuł, wykonawcę i czas trwania utworu)
- `/djrole role:<rola>` sets the DJ role (Manage Server required); omit `role` to disable it. DJ role members can control playback and skip without a vote. The role is stored in `data/guild-settings.json`.
- `/defaultvolume value:<1-100>` sets the server's default playback volume (Manage Server required). It updates the active session too and applies to later sessions; `/volume` remains a temporary per-session adjustment.
- `/musictextchannel channel:<kanał>` sets the server's “Teraz gra” announcement channel (Manage Server required); omit `channel` to disable it. The bot checks that it can view and send messages there. This setting also overrides the text channel used when connecting or restoring playback.
- `/music24channel channel:<kanał głosowy>` sets the server's default voice channel for 24/7 mode (Manage Server required); omit `channel` to disable it. The bot checks Connect and Speak permissions. It takes effect the next time `/mode24h enabled:true` is used.
- `/play` accepts HTTPS links only from YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, Twitch and NicoVideo; text search still works. `/radio` requires a comma-separated host allowlist in `RADIO_ALLOWED_DOMAINS` (for example `radio.example.com,streams.example.net`); every DNS address is checked and private, reserved and localhost ranges are rejected. An empty allowlist disables `/radio`.
- The bot keeps one “Teraz gra” message per server and edits it instead of posting a new one for every track; the message reference is saved in `data/guild-settings.json` so the same message can be reused after a restart. It shows title (linked), artist, a progress bar refreshed every 30 seconds while a track plays, time, volume, repeat mode and the next track. The colour reflects the state (playing, paused, finished), and when the queue ends or the bot leaves the message turns into a “Kolejka zakończona” / “Rozłączono” summary with disabled buttons. Edits are serialized per server and debounced, so pause, volume, repeat, queue and seek changes show up within about a second without duplicate messages.
- Buttons under that message: previous, pause/resume, skip, stop, shuffle, repeat (cycles off → queue → track), volume −10% / +10%. They follow the same voice-channel and DJ-role rules as the commands; previous, shuffle and repeat are disabled for radio.
- `/filter mode:<off|bassboost|nightcore|8d>` (Premium)
- `/leave`, `/mode24h enabled:<true|false>` (24/7 is Premium), `/help`

## Configuration

- `PREMIUM_GUILD_IDS` and `PREMIUM_USER_IDS`: comma-separated Discord IDs.
- `FREE_QUEUE_LIMIT`: queued track limit for free users (default 50).
- `PREMIUM_QUEUE_LIMIT`: queued track limit for Premium (default 500, maximum 10000).
- `FREE_COOLDOWN_SECONDS` and `PREMIUM_COOLDOWN_SECONDS`: per-user command cooldowns.
- `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`: bot-to-node connection. The Lavalink container receives the YouTube refresh token only from `.env.youtube`; it receives its password and Spotify client ID/secret from `.env`. Other bot secrets, including `DISCORD_TOKEN` and `WEB_PANEL_TOKEN`, are not passed to Lavalink.
- `SPOTIFY_REDIRECT_URI`: must exactly match the redirect URL registered in Spotify Developer Dashboard.
- User Spotify tokens are written atomically to `data/spotify-tokens.json` with file mode `0600` on POSIX systems.
- `WEB_PANEL_TOKEN`: enables the web panel. At least 16 characters; if it is empty (or still the placeholder from `.env.example`) the panel, its API and Socket.IO are not started at all, and only the Spotify OAuth callback stays up. The token is sent in the `x-panel-token` header (Socket.IO: `auth.token`), never in the URL. Generate one with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
- The panel sets Helmet security headers, limits API traffic to 120 requests per minute per IP and Socket.IO handshakes to 60 per minute per IP. HTTP errors are logged with stack traces but return generic client messages.
- Playback state is saved in `data/playback-state.json` and restored on startup: current/queued tracks, radio, loop mode, 24/7 mode and volume. A restored current track starts from the beginning; unavailable voice channels or tracks are skipped.

## Structure

- `application.yml`, `compose.yaml`: Lavalink node and source plugins.
- `src/player`: per-guild queue/session adapter over Kazagumo.
- `src/sources`: Spotify metadata/OAuth and radio metadata.
- `src/discord`: slash commands, buttons and cooldowns.
- `src/web` and `public`: HTTP API, Socket.IO updates and the web panel.
