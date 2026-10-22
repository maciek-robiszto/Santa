# 🎁 Makerskie Mikołajki

Bezpieczna aplikacja webowa do losowania Secret Santa dla społeczności makerskiej.

## Funkcje

- **Zaproszenie linkiem** – organizator tworzy wydarzenie i wysyła link; uczestnicy zakładają konto (e-mail + hasło).
- **Profil makera** – o mnie, pasje i projekty, co by mnie ucieszyło, czego nie chcę, link do social mediów/portfolio.
- **Spotkanie na żywo** – miejsce i data wymiany w opisie wydarzenia; bez adresów do wysyłki (mniej danych osobowych).
- **Termin zapisów i automatyczne losowanie** – o północy po dniu „Zapisy do” aplikacja sama losuje pary i wysyła maile do wszystkich. Dwa dni przed terminem osoby z pustym profilem dostają przypomnienie. Jeśli losowanie się nie uda (np. mniej niż 3 osoby), admin dostaje maila i losuje ręcznie. Można też losować ręcznie w dowolnym momencie.
- **Losowanie** – kryptograficznie losowy jeden cykl (A→B→C→…→A): nikt nie losuje siebie, brak par „na krzyż”. Obsługa **wykluczeń** (np. partnerzy).
- **Koperta** – każdy widzi tylko swoją osobę i jej profil.
- **Anonimowe wiadomości** – Mikołaj może pytać obdarowanego, ten może odpowiadać, nie wiedząc, z kim pisze.
- **Status prezentu** (w produkcji / gotowy / wręczony) widoczny dla obdarowanego.
- **Etykieta na prezent do druku** – duża zawieszka z otworem na sznurek i dwie naklejki „Dla: …” (bez imienia Mikołaja), żeby na spotkaniu każdy znalazł swoją paczkę.
- **Opcjonalne ujawnienie Mikołajów** po zakończeniu zabawy.
- **Powiadomienia e-mail** (opcjonalne SMTP): losowanie, nowa wiadomość, reset hasła.
- Responsywność (mobile first), działa bez JavaScriptu.

## Model bezpieczeństwa

| Zagrożenie | Ochrona |
|---|---|
| Ktoś podejrzy, kto kogo wylosował | Odbiorca w tabeli `assignments` jest szyfrowany **AES‑256‑GCM** (klucz poza bazą, AAD wiąże szyfrogram z wierszem). Admin **nie ma** widoku listy par. |
| Admin „po cichu” sprawdza pary | Jedyna droga to **awaryjny podgląd**: jedna para na raz, wymaga hasła i powodu, jest **publicznie widoczny w dzienniku** każdego uczestnika + e‑mail do wszystkich. Wygenerowanie linku resetu hasła dla uczestnika (czyli możliwość wejścia na jego konto) też jest publicznie logowane. Anulowanie losowania – również. |
| Wyciek bazy / kopii | Profile, pary i wiadomości są szyfrowane. Hasła: **scrypt** (N=2¹⁵). Sesje i tokeny resetu przechowywane jako SHA‑256. `secure_delete` w SQLite. |
| Przejęcie sesji / CSRF / XSS | Ciasteczka `__Host-`, `HttpOnly`, `Secure`, `SameSite`; token CSRF + sprawdzanie `Origin`; ścisły CSP (`script-src 'self'`), auto‑escaping szablonów, linki tylko `http(s)` z `rel="noopener noreferrer nofollow ugc"`. |
| Brute force | Limity prób logowania (IP + e‑mail), rejestracji, resetu, wiadomości, podglądu awaryjnego; stały czas odpowiedzi dla nieistniejących kont. |
| Inne | HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` (tokeny z URL nie wyciekają), `Cache-Control: no-store`, brak logów dostępu w Caddy, kontener read‑only bez uprawnień. |

> Uczciwie: osoba z dostępem do serwera **i** do `ENCRYPTION_KEY` technicznie może odszyfrować dane. Trzymaj klucz tylko w `.env` na serwerze i **osobno** od kopii zapasowych.

**RODO / minimalizacja danych:** uczestnik może usunąć konto (poza czasem trwającego losowania), admin może po zabawie usunąć całe wydarzenie razem z profilami i wiadomościami.

## Uruchomienie produkcyjne (Docker + automatyczny HTTPS)

Wymagania: serwer z Dockerem, domena wskazująca na serwer (porty 80/443).

```bash
cp .env.example .env
npm run gen-key            # lub: openssl rand -base64 32  → wklej do ENCRYPTION_KEY
nano .env                  # DOMAIN, APP_URL, (opcjonalnie SMTP)
docker compose up -d --build
docker compose exec app node --disable-warning=ExperimentalWarning scripts/create-admin.js --email ty@example.pl --name "Twoje imię"
```

Potem zaloguj się na `https://twoja-domena/`, wejdź w **Panel admina** → utwórz wydarzenie → skopiuj link z zaproszeniem.

### Kopie zapasowe

```bash
docker compose exec app node --disable-warning=ExperimentalWarning scripts/backup.js /data/backups/santa.db
```

Kopia jest spójna (`VACUUM INTO`). Bez `ENCRYPTION_KEY` dane szyfrowane są nieczytelne – klucz przechowuj osobno (np. w menedżerze haseł).

## Przetestuj u siebie (demo)

```bash
npm install
npm run demo   # pusta baza → admin + wydarzenie + 8 uczestników z profilami
npm run dev    # http://localhost:3000
```

Loginy: `admin@demo.pl`, `ala@demo.pl` … `henryk@demo.pl`, hasło `mikolajki-demo`. Admina i uczestnika najlepiej otworzyć w osobnych oknach (np. zwykłe + prywatne). Reset demo: usuń katalog `./data`.

Test na prawdziwej grupie wymaga wdrożenia na serwer (sekcja wyżej) – wtedy wyślij ludziom link z zaproszeniem.

## Rozwój lokalny

Wymagany Node.js ≥ 22.13 (używa wbudowanego `node:sqlite`, brak natywnych zależności).

```bash
npm install
ADMIN_PASSWORD='haslo-admina-123' npm run admin:create -- --email admin@local --name Admin
npm run dev     # http://localhost:3000 (klucz deweloperski tworzony automatycznie w ./data)
npm test        # w tym symulacja grupy 30 osób: zapisy, przypomnienia, auto-losowanie, maile
```

## Wygląd

Styl w duchu robisz.to: biel i jasnoszare sekcje, płaskie żółte bloki ze strzałką, morski akcent, kropkowany raster, krój Poppins (hostowany lokalnie, licencja OFL – `public/fonts`). Kolory są zmiennymi CSS na górze `public/style.css` (`--yellow`, `--teal`, `--soft`, …). Nazwę strony ustawisz zmienną `SITE_NAME`.

## Struktura

```
src/
  server.js      start aplikacji
  app.js         Express + middleware (nagłówki, CSRF, sesje)
  draw.js        algorytm losowania
  crypto.js      AES-GCM, scrypt, tokeny
  store.js       dostęp do danych (szyfrowanie/odszyfrowanie)
  routes/        public (logowanie, zaproszenia, konto), events (uczestnik), admin
  views/         szablony HTML (auto-escaping)
public/          CSS, JS (tylko progresywne ulepszenia), favicon
scripts/         create-admin, backup
test/            testy jednostkowe i integracyjne (node:test)
```
