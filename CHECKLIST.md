# Aurora Music Bot – checklista usprawnień

Prace idą punkt po punkcie: jeden punkt naraz, kolejny dopiero po potwierdzeniu.
Odhaczone `[x]` = zrobione i wrzucone do repo.

## Kolejność realizacji

1. ~~Kontrola dostępu do sterowania botem (kanał głosowy)~~ – zrobione
2. ~~Naprawa `/seek` (milisekundy zamiast sekund)~~ – zrobione
3. ~~Usunięcie `.pnpm-store/` z repo~~ – zrobione
4. ~~Wymagany token panelu + zawężenie CORS~~ – zrobione
5. `compose.yaml`: Lavalink bez całego `.env`
6. Wycieki pamięci (sesje, `oauthStates`)
7. Obsługa przeniesienia/wyrzucenia bota z kanału + `resume` w Shoukaku
8. Pozostałe punkty poniżej, według uznania

## Stabilność

- [x] Naprawić `/seek` (milisekundy zamiast sekund)
- [ ] Włączyć `resume`, `resumeTimeout`, `resumeByLibrary` w Shoukaku
- [ ] Zmniejszyć `restTimeout` do ok. 15 s i dodać timeout wyszukiwania
- [ ] Obsłużyć przeniesienie i wyrzucenie bota z kanału (`playerMoved`, `playerDestroy`, `VoiceStateUpdate` dla bota) i aktualizować `voiceChannel`
- [ ] Dodać `client.on("error" / "shardError" / "shardDisconnect")` oraz `uncaughtException`
- [ ] Opakować `respond()` i `followUp` w try/catch (wygasłe interakcje)
- [ ] Graceful shutdown: `await` na `destroy()`, zamknięcie serwera HTTP i Socket.IO, dopiero potem exit
- [ ] Naprawić semantykę `limit` w `/playlist` (liczba dodawanych utworów)
- [ ] Zamiast blokady `pendingMediaRequests` zrobić kolejkę żądań per serwer
- [ ] Zapisywać stan (kolejka, 24/7, radio, głośność) i przywracać go po restarcie

## Wydajność

- [ ] Socket.IO: pokoje per serwer zamiast globalnego `io.emit`
- [ ] Wysyłać obciętą kolejkę (np. 50) i debounce zdarzeń
- [ ] Nie tworzyć sesji w `guildSnapshots()` ani w `get()` dla nieistniejących serwerów
- [ ] Zastąpić `members.fetch()` odczytem `voiceStates.cache`
- [ ] Ustawić sensowny limit kolejki premium (zamiast `MAX_SAFE_INTEGER`)
- [ ] Przetestować i skrócić listę `clients` YouTube w `application.yml`
- [ ] Rozważyć drugi węzeł Lavalinka i `nodeResolver` (failover)

## Funkcjonalności

- [ ] `/remove`, `/move`, `/skipto`, `/clear`, `/previous`
- [ ] Autocomplete w `/play` i `/search` z wyborem wyniku
- [ ] Paginacja `/queue` przyciskami
- [ ] `/lyrics`, autoplay, `/help`
- [ ] Rola DJ i głosowanie na skip
- [ ] Ustawienia per serwer (rola DJ, kanał tekstowy, domyślna głośność, kanał 24/7)
- [ ] Usuwanie lub edycja starej wiadomości „Teraz gra"
- [ ] Sprawdzanie uprawnień bota do pisania na kanale tekstowym
- [ ] Zostawić jedną z komend `/now`, `/nowplaying`, `/np`

## Bezpieczeństwo

- [x] Sprawdzać obecność użytkownika na kanale bota przed `skip/stop/leave/pause/volume/loop/shuffle/seek/filter` i dla przycisków (+ `join/play/playlist/spotify-playlist/radio/mode24h`)
- [x] Uczynić `WEB_PANEL_TOKEN` wymaganym (zod) lub nie uruchamiać panelu bez niego
- [x] Porównywać token przez `crypto.timingSafeEqual`, zrezygnować z tokenu w query stringu
- [x] Ograniczyć CORS w Socket.IO do konkretnego origin
- [ ] Dodać `helmet` i rate limit na panel; ukrywać szczegóły błędów
- [ ] Przekazywać Lavalinkowi w `compose.yaml` tylko potrzebne zmienne zamiast całego `.env`
- [ ] Filtrować URL-e w `/play` i `/radio` (blokada adresów prywatnych i `localhost`, whitelist domen)
- [ ] Zapisywać `spotify-tokens.json` atomowo (plik tymczasowy + rename) z `mode 0o600`, najlepiej szyfrowane
- [ ] Dodać TTL i czyszczenie `oauthStates`
- [ ] Przy YouTube OAuth użyć osobnego konta Google (ryzyko blokady)
- [ ] Jeśli w historii kiedykolwiek był prawdziwy `.env`, zresetować token bota i hasło Lavalinka

## Kod i architektura

- [x] Usunąć `.pnpm-store/` z repo i dopisać do `.gitignore`
- [ ] (opcjonalnie) Przepisać historię git, żeby pozbyć się `.pnpm-store/` z pierwszego commita (`git filter-repo`, wymaga force-push)
- [ ] Usunąć martwy kod (`process.ts`, `SourceRegistry`, nieużywane metody Spotify, `Track.query`, `.pnpmfile.cjs`)
- [ ] Rozbić `interactionHandler.ts` na moduły komend
- [ ] Mapować błędy na przyjazne komunikaty, szczegóły tylko do logów (ze stack trace)
- [ ] Dodać ESLint, Prettier i testy (min. logika failure/skip, limity kolejki, cooldown)
- [ ] Dodać CI (`pnpm check`, lint, test)
- [ ] Dodać Dockerfile bota i healthcheck
- [ ] Wprowadzić warstwę tłumaczeń i ujednolicić polskie znaki w opisach komend
- [ ] Rozdzielić rejestrację komend od startu bota (osobny skrypt `deploy-commands`)
- [ ] Zaktualizować zależności (discord.js 14.27.0, kazagumo 3.4.3)
