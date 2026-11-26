# Aurora Music Bot – checklista

Prace idą punkt po punkcie: jeden punkt naraz, kolejny dopiero po potwierdzeniu.
Odhaczone `[x]` = zrobione i wrzucone do repo. Oznaczenia: **[odtworzone]** – błąd potwierdzony
testem, **[z kodu]** – wynika z czytania kodu, do potwierdzenia na żywo.

## Etap 2 – plan po przeglądzie kodu

### Kolejność realizacji

P1 → P2 → P3 → P4 + P5 → P6 → P7 → P8 → P10–P12 → P9 (po teście na żywo) → drobne → kod/testy/dokumentacja.

### Priorytet 1 – zepsute funkcje i luki

- [x] **P1. `/radio` nie przełącza na radio, gdy coś gra**
  - `setRadio` ustawia `loop=track` przed `skip()`, więc Kazagumo wraca do starego utworu; dotyczy też zmiany stacji.
  - Zmiana: `player.play(track, { replaceCurrent: true })`, dopiero potem `setLoop("track")`; nie ma już `skip()` poprzedniego utworu.
  - Test: radio przy grającym utworze, radio → radio, radio bez grającego utworu (3/3).
- [x] **P2. Zależności z podatnościami (22, w tym 1 krytyczna, 9 wysokich)**
  - Zaktualizowano bezpośrednie i pośrednie zależności, w tym `express 5.3.0`, `socket.io 4.8.4`, `discord.js 14.28.1` oraz `zod 4.6.7`.
  - Test: `pnpm audit --prod` nie zgłasza podatności; `check`, `lint`, `format:check`, `test`, `build` przechodzą.
- [x] **P3. `/queue` wysypuje się przy długich tytułach, tytuły nie są escapowane**
  - Linie kolejki są ograniczone do 90 znaków, a pole embeda „Następne” do 1024; tytuły i wykonawcy są escapowane przed użyciem w embedach oraz odpowiedziach.
  - Poprawka obejmuje też „Teraz gra”, wynik `/search`, dodawanie przez `/play`, radio i komunikat błędu odtwarzania.
  - Test: 10 długich utworów oraz tytuł z `[tekst](url)`; 3 nowe testy przeszły.

### Priorytet 2 – stabilność i bezpieczeństwo

- [x] **P4. Nieaktualny kanał ogłoszeń blokuje `/play` na całym serwerze**
  - Nieprawidłowy lub niedostępny kanał pomija ogłoszenia i zapisuje ostrzeżenie; połączenie głosowe i odtwarzanie mogą działać dalej.
  - `/musictextchannel` i `connect()` wymagają View, Send i EmbedLinks; kanały są walidowane przed aktualizacją sesji.
- [x] **P5. Brak `allowedMentions`**
  - Klient Discord ma `allowedMentions: { parse: [] }`.
- [x] **P6. `/skip` przy `loop track` odtwarza ten sam utwór**
  - Pętla utworu jest wyłączana tylko na czas skipu i przywracana po starcie następnego utworu (radio pozostaje bez zmian); testy obu przypadków przechodzą.
- [x] **P7. Autocomplete w `/play` bez limitu** [z kodu]
  - Limit 750 ms na użytkownika, pamięć podręczna wyników przez 45 s i deduplikacja identycznych zapytań w toku.
  - Testy obejmują limit, cache, deduplikację oraz ponowienie po błędzie wyszukiwania.
- [x] **P8. Błędy walidacji w panelu jako 500** [z kodu]
  - Klasa błędu z kodem 400 i bezpieczną treścią; 500 tylko dla prawdziwych awarii.
  - Walidacja obejmuje pola panelu, dozwolone wartości, JSON body oraz bezpieczne linki; testy rozróżniają odpowiedzi 400 i 500.
- [x] **P9. `playerClosed` pomija bieżący utwór, także przy odzyskiwalnych zamknięciach** [z kodu]
  - Normalne i odzyskiwalne zamknięcia połączenia głosowego nie pomijają utworu; bot zapisuje ostrzeżenie i informuje o ponownym łączeniu.
  - Testy obejmują klasyfikację kodów; na serwerze należy jeszcze sprawdzić ręczne przeniesienie bota między kanałami.
- [ ] **P10. Zamykanie bez limitu czasu** [z kodu]
  - Limit 8–10 s na oczekiwanie w `players.shutdown()` i watchdog `process.exit(1)` w `index.ts`.
- [ ] **P11. Pluginy Lavalinka nie są trwałe** [z kodu]
  - Wolumin na `/opt/Lavalink/plugins` w `compose.yaml`.
- [ ] **P12. Po 120 nieudanych próbach Lavalink nie wraca** [z kodu]
  - Po ostatnim `disconnect` zakończyć proces (`exit(1)`) albo dodać węzeł od nowa.

### Priorytet 3 – drobne poprawki

- [ ] Po nieudanym pierwszym `/play` zaplanować rozłączenie bezczynnego bota (`scheduleIdleDisconnect`)
- [ ] `connect()`: ustawiać `voiceChannel` i `textChannelId` dopiero po sprawdzeniu uprawnień
- [ ] Walidować ID playlisty Spotify (`^[A-Za-z0-9]{22}$`) i kodować je w URL
- [ ] `setMaxLength` w opcjach tekstowych (nazwa radia ok. 100, `query` i `url` ok. 500)
- [x] Serializować ogłoszenia „Teraz gra" per serwer (bez duplikatów) – zrobione w UI-1
- [ ] `/lyrics`: czyścić tytuł i autora (Official Video, „- Topic", VEVO), zapasowe `/api/search`, usuwać znaczniki czasu z wersji „synced"
- [ ] `setContexts(Guild)` dla komend (bez działania w DM)
- [ ] Zdeduplikować odświeżanie tokenu Spotify
- [ ] Czyścić zapisany stan dla niedostępnych kanałów; `restoreSavedPlayback` nie powinno blokować `/play` do końca przywracania

### Wygląd (UI)

- [x] **UI-1. Nowy wygląd wiadomości „Teraz gra"**
  - Tytuł jako link, artysta w osobnej linii, krótki pasek postępu (12 pól) odświeżany co 30 s, pola Czas / Głośność / Powtarzanie / Następny, stopka (kto dodał, źródło).
  - Kolor zależny od stanu (gra, pauza, koniec), stan końcowy „Kolejka zakończona" / „Rozłączono" z wyłączonymi przyciskami.
  - Dwa rzędy po 4 przyciski z ikonami: ⏮ ⏯ ⏭ ⏹ oraz 🔀 🔁/🔂 🔉 🔊 (dochodzą „poprzedni" i głośność ±10%; pętla przełącza wyłączona → kolejka → utwór).
  - Odświeżanie przy pauzie, wznowieniu, głośności, pętli, zmianie kolejki i `/seek` (debounce ok. 1,2 s), edycje serializowane per serwer.
  - Test: `tests/nowPlaying.test.ts`, `tests/nowPlayingPublisher.test.ts`.

### Kod, testy i dokumentacja

- [ ] Wspólna funkcja zapisu ustawień serwera (5 prawie identycznych bloków w `PlayerManager`)
- [ ] Usunąć nieużywane `writeJsonFile` i `fileExists` z `fs.ts`
- [ ] Testy: `voiceGuard`, `MediaInputGuard`, autoryzacja panelu, `setRadio`/`skip` na prawdziwym `KazagumoPlayer` z atrapą Lavalinka
- [ ] Ujednolicić Node w CI i środowisku (CI 24, `engines` i Docker 22); akcje GitHub przypiąć do SHA
- [ ] README: usunąć „unbounded queues", opisać uprawnienia kanału ogłoszeń i wolumin pluginów
- [ ] Polskie znaki w stringach panelu (`public/app.js`, `public/index.html`)

---

## Etap 1 – zakończony

Prace idą punkt po punkcie: jeden punkt naraz, kolejny dopiero po potwierdzeniu.
Odhaczone `[x]` = zrobione i wrzucone do repo.

### Kolejność realizacji

1. ~~Kontrola dostępu do sterowania botem (kanał głosowy)~~ – zrobione
2. ~~Naprawa `/seek` (milisekundy zamiast sekund)~~ – zrobione
3. ~~Usunięcie `.pnpm-store/` z repo~~ – zrobione
4. ~~Wymagany token panelu + zawężenie CORS~~ – zrobione
5. ~~`compose.yaml`: Lavalink bez całego `.env`~~ – zrobione
6. ~~TTL i czyszczenie `oauthStates` (część punktu wycieków pamięci)~~ – zrobione
7. ~~Obsługa przeniesienia/wyrzucenia bota z kanału + `resume` w Shoukaku~~ – zrobione
8. Pozostałe punkty poniżej, według uznania

### Stabilność

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

### Wydajność

- [x] Socket.IO: pokoje per serwer zamiast globalnego `io.emit`
- [x] Wysyłać obciętą kolejkę (np. 50) i debounce zdarzeń
- [x] Nie tworzyć sesji w `guildSnapshots()` ani w `get()` dla nieistniejących serwerów
- [x] Zastąpić `members.fetch()` odczytem `voiceStates.cache`
- [x] Ustawić sensowny limit kolejki premium (zamiast `MAX_SAFE_INTEGER`)
- [x] Przetestować i skrócić listę `clients` YouTube w `application.yml` (pozostawiono `MUSIC` i sprawdzony `IOS`)
- [x] Ocenić drugi węzeł Lavalinka i `nodeResolver` (failover): odłożone do czasu uruchomienia drugiego węzła i aktualizacji Shoukaku

### Funkcjonalności

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

### Bezpieczeństwo

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

### Kod i architektura

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
