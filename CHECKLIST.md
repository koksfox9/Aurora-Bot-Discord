# Aurora Music Bot – checklista usprawnień

Prace idą punkt po punkcie: jeden punkt naraz, kolejny dopiero po potwierdzeniu.
Odhaczone `[x]` = zrobione i wrzucone do repo.

## Kolejność realizacji

1. ~~Kontrola dostępu do sterowania botem (kanał głosowy)~~ – zrobione
2. ~~Naprawa `/seek` (milisekundy zamiast sekund)~~ – zrobione
3. ~~Usunięcie `.pnpm-store/` z repo~~ – zrobione
4. ~~Wymagany token panelu + zawężenie CORS~~ – zrobione
5. ~~`compose.yaml`: Lavalink bez całego `.env`~~ – zrobione
6. ~~TTL i czyszczenie `oauthStates` (część punktu wycieków pamięci)~~ – zrobione
7. ~~Obsługa przeniesienia/wyrzucenia bota z kanału + `resume` w Shoukaku~~ – zrobione
8. Pozostałe punkty poniżej, według uznania

## Stabilność

- [x] Naprawić `/seek` (milisekundy zamiast sekund)
- [x] Włączyć `resume`, `resumeTimeout`, `resumeByLibrary` w Shoukaku
- [x] Zmniejszyć `restTimeout` do ok. 15 s i dodać timeout wyszukiwania
- [x] Obsłużyć przeniesienie i wyrzucenie bota z kanału (`playerMoved`, `playerDestroy`, `VoiceStateUpdate` dla bota) i aktualizować `voiceChannel`
- [x] Dodać `client.on("error" / "shardError" / "shardDisconnect")` oraz `uncaughtException`
- [x] Opakować `respond()` i `followUp` w try/catch (wygasłe interakcje)
- [x] Graceful shutdown: `await` na `destroy()`, zamknięcie serwera HTTP i Socket.IO, dopiero potem exit
- [x] Naprawić semantykę `limit` w `/playlist` (liczba dodawanych utworów)
- [x] Zamiast blokady `pendingMediaRequests` zrobić kolejkę żądań per serwer
- [x] Zapisywać stan (kolejka, 24/7, radio, głośność) i przywracać go po restarcie

## Wydajność

- [x] Socket.IO: pokoje per serwer zamiast globalnego `io.emit`
- [x] Wysyłać obciętą kolejkę (np. 50) i debounce zdarzeń
- [x] Nie tworzyć sesji w `guildSnapshots()` ani w `get()` dla nieistniejących serwerów
- [x] Zastąpić `members.fetch()` odczytem `voiceStates.cache`
- [x] Ustawić sensowny limit kolejki premium (zamiast `MAX_SAFE_INTEGER`)
- [x] Przetestować i skrócić listę `clients` YouTube w `application.yml` (pozostawiono `MUSIC` i sprawdzony `IOS`)
- [x] Ocenić drugi węzeł Lavalinka i `nodeResolver` (failover): odłożone do czasu uruchomienia drugiego węzła i aktualizacji Shoukaku

## Funkcjonalności

- [x] `/remove` (numer pozycji od 1; aktualny utwór nie jest pozycją kolejki)
- [x] `/move` (pozycje oczekujących utworów liczone od 1)
- [x] `/skipto` (pozycje od 1; usuwa wcześniejsze utwory z kolejki)
- [x] `/previous` (poprzedni utwór wraca do kolejki za odtworzonym)
- [x] `/clear` (czyści oczekujące utwory, bieżący gra dalej)
- [x] Autocomplete `/play` z wyborem jednego z maksymalnie 25 wyników
- [x] Autocomplete `/search` z podglądem wybranego wyniku
- [x] Paginacja `/queue` przyciskami Poprzednia/Następna
- [x] `/help` (komendy pogrupowane według funkcji)
- [x] `/lyrics` (tekst aktualnego utworu z LRCLIB)
- [x] Autoplay (włączane komendą `/autoplay`; wybiera kolejny utwór na podstawie ostatniego wykonawcy)
- [x] Głosowanie większości na `/skip` (jeden słuchacz lub administrator pomija od razu)
- [x] Rola DJ (`/djrole role:<rola>`; dostępny dla Zarządzania serwerem; puste `role` wyłącza; członkowie roli mogą sterować z pominięciem głosowania na skip)
- [x] Ustawienia per serwer (rola DJ, kanał tekstowy, domyślna głośność i kanał 24/7)
- [x] Edycja poprzedniej wiadomości „Teraz gra” przy zmianie utworu; jej ID jest zachowywane po restarcie
- [x] Sprawdzać uprawnienia bota do wysyłania wiadomości i embedów na kanale ogłoszeń przed połączeniem
- [x] Zostawić jedną komendę do podglądu utworu: `/nowplaying` (rejestracja komend usuwa stare aliasy)

## Bezpieczeństwo

- [x] Sprawdzać obecność użytkownika na kanale bota przed `skip/stop/leave/pause/volume/loop/shuffle/seek/filter` i dla przycisków (+ `join/play/playlist/spotify-playlist/radio/mode24h`)
- [x] Uczynić `WEB_PANEL_TOKEN` wymaganym (zod) lub nie uruchamiać panelu bez niego
- [x] Porównywać token przez `crypto.timingSafeEqual`, zrezygnować z tokenu w query stringu
- [x] Ograniczyć CORS w Socket.IO do konkretnego origin
- [x] Dodać `helmet`, limity HTTP/Socket.IO i ukrywać szczegóły błędów panelu (szczegóły z trace trafiają do logów)
- [x] Przekazywać Lavalinkowi w `compose.yaml` tylko potrzebne zmienne zamiast całego `.env`
- [x] Filtrować URL-e w `/play` i `/radio` (whitelist serwisów muzycznych/radiowych; blokada adresów prywatnych, zarezerwowanych i `localhost`)
- [x] Zapisywać `spotify-tokens.json` atomowo (plik tymczasowy + rename) z `mode 0o600`; szyfrowanie at-rest pozostaje osobnym rozważeniem
- [x] Dodać TTL i czyszczenie `oauthStates`
- [x] Przy YouTube OAuth użyć osobnego konta Google; refresh token zapisany w prywatnym `.env.youtube` (tryb `0600`), a Lavalink potwierdził jego odświeżenie. Konto pomocnicze ogranicza ryzyko głównego konta, ale nie wyklucza blokady.
- [x] Zweryfikować historię `.env` — nie jest śledzony obecnie ani w historii lokalnej i jedynej gałęzi GitHuba (`main`); rotacja tokenu bota i hasła Lavalinka z tego powodu nie jest wymagana

## Kod i architektura

- [x] Usunąć `.pnpm-store/` z repo i dopisać do `.gitignore`
- [x] (opcjonalnie) Przepisać historię Git, usuwając `.pnpm-store/` z całej historii `main` (5 132 pliki, 84,3 MB); wymuszony push wykonano z lease
- [x] Usunąć martwy kod — lokalne i serwerowe `src/utils/process.ts`, wrapper `SourceRegistry` i nieaktywny `.pnpmfile.cjs` usunięte; aktywne walidatory URL są w `MediaInputGuard.ts`. Metody Spotify i `Track.query` pozostawiono, bo są używane.
- [x] Rozbić `interactionHandler.ts` na moduły komend; obsługę przycisków i zdarzeń odtwarzacza przenieść do osobnych modułów
- [x] Mapować błędy na przyjazne komunikaty; błędy i stack trace trafiają do logów
- [x] Dodać ESLint, Prettier i testy — ESLint, Prettier oraz testy `node:test` dla failure/skip, limitów kolejki i cooldownu
- [x] Dodać CI (`pnpm check`, build, lint, format check i test) dla push i pull request
- [x] Dodać Dockerfile bota, endpoint `/health` i Docker healthcheck
- [x] Wprowadzić warstwę tłumaczeń PL i ujednolicić polskie znaki w opisach komend oraz opcji
- [x] Rozdzielić rejestrację komend od startu bota (`pnpm deploy:commands`)
- [x] Zaktualizować zależności (discord.js 14.27.0, kazagumo 3.4.3)
