#!/usr/bin/env bash
# Instalacja / aktualizacja Makerskich Mikołajek na serwerze z Dockerem.
# Uruchom w katalogu repozytorium:  bash deploy/install.sh
# Bez pytań (np. przez SSH/automat): DOMAIN=… [APP_PORT=3010] [USE_CADDY=no]
#   [ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=…] bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }

command -v docker >/dev/null || die "Brak Dockera. Zainstaluj: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Brak 'docker compose' (plugin v2)."
command -v openssl >/dev/null || die "Brak openssl."

if [[ ! -f .env ]]; then
  say "Pierwsza instalacja – tworzę .env"
  [[ -n "${DOMAIN:-}" ]] || read -rp "Domena (np. mikolajki.naskret.eu): " DOMAIN
  [[ -n "$DOMAIN" ]] || die "Domena jest wymagana."
  [[ -n "${APP_PORT:-}" ]] || read -rp "Port lokalny aplikacji [3010]: " APP_PORT; APP_PORT=${APP_PORT:-3010}
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
APP_URL=https://$DOMAIN
APP_PORT=$APP_PORT
ENCRYPTION_KEY=$(openssl rand -base64 32)
SITE_NAME=Makerskie Mikołajki
# Poczta (opcjonalnie) – uzupełnij i uruchom skrypt ponownie:
# SMTP_URL=smtps://santa%40example.pl:HASLO@smtp.example.pl:465
# MAIL_FROM="Makerskie Mikołajki <santa@example.pl>"
ENV
  chmod 600 .env
  echo "Zapisano .env. ZRÓB KOPIĘ linii ENCRYPTION_KEY w menedżerze haseł – bez niej dane są nie do odzyskania."
fi

set -a; source .env; set +a
APP_PORT=${APP_PORT:-3010}

PROFILE=()
if [[ -n "${USE_CADDY:-}" ]]; then
  [[ "$USE_CADDY" =~ ^(yes|tak|1|true)$ ]] && PROFILE=(--profile caddy)
elif ss -tln 2>/dev/null | grep -qE '[:.]443\s'; then
  say "Port 443 jest zajęty – zakładam istniejący reverse proxy (nginx/Caddy/Traefik)."
else
  read -rp "Port 443 wolny. Uruchomić wbudowany Caddy z automatycznym HTTPS? [T/n]: " a
  [[ "${a:-T}" =~ ^[TtYy]$ ]] && PROFILE=(--profile caddy)
fi

say "Budowanie i start"
docker compose "${PROFILE[@]}" up -d --build

say "Sprawdzam, czy aplikacja żyje"
for i in {1..30}; do
  curl -fsS "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1 && { echo "OK – działa na 127.0.0.1:$APP_PORT"; break; }
  sleep 1; [[ $i == 30 ]] && { docker compose logs --tail=50 app; die "Aplikacja nie wstała."; }
done

if ! docker compose exec -T app node --disable-warning=ExperimentalWarning -e \
  "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/santa.db');process.exit(d.prepare('select count(*) n from users where is_admin=1').get().n?0:1)" 2>/dev/null; then
  say "Tworzę konto superadmina"
  if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
    docker compose exec -T -e ADMIN_PASSWORD="$ADMIN_PASSWORD" app node --disable-warning=ExperimentalWarning scripts/create-admin.js --email "$ADMIN_EMAIL" --name "${ADMIN_NAME:-Admin}"
  elif [[ -t 0 ]]; then
    read -rp "Twój e-mail: " EMAIL
    read -rp "Imię / ksywka: " NAME
    docker compose exec app node --disable-warning=ExperimentalWarning scripts/create-admin.js --email "$EMAIL" --name "$NAME"
  else
    echo "Pomijam (brak terminala). Później: docker compose exec app node --disable-warning=ExperimentalWarning scripts/create-admin.js --email TY@example.pl --name Imię"
  fi
fi

if [[ ${#PROFILE[@]} -eq 0 ]]; then
  say "Ostatni krok: podepnij domenę $DOMAIN w swoim reverse proxy → http://127.0.0.1:$APP_PORT"
  echo "  nginx:  deploy/nginx.conf.example   (potem: certbot --nginx -d $DOMAIN)"
  echo "  Caddy:  deploy/Caddyfile.snippet"
fi
say "Gotowe 🎁  https://$DOMAIN"
