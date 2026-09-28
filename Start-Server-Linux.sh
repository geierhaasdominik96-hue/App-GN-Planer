#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
MIRROR_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.mirror.yml"
ENVIRONMENT_FILE="$PROJECT_ROOT/.env.server"
LOCAL_ONLY=false
if [ "${1:-}" = "--local" ]; then LOCAL_ONLY=true; fi

fail() {
  printf '\nFEHLER: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker wurde nicht gefunden. Bitte Docker Engine mit Compose-Plugin installieren."
docker compose version >/dev/null 2>&1 || fail "Das Docker-Compose-Plugin wurde nicht gefunden."
docker version >/dev/null 2>&1 || fail "Docker laeuft nicht oder der aktuelle Benutzer darf Docker nicht verwenden."

cd "$PROJECT_ROOT"
mkdir -p "$PROJECT_ROOT/data/Sicherungen"

get_setting() {
  [ -f "$ENVIRONMENT_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENVIRONMENT_FILE" | tail -n 1 | tr -d '\r'
}

random_hex() {
  od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
}

POSTGRES_PASSWORD=$(get_setting POSTGRES_PASSWORD)
BETTER_AUTH_SECRET=$(get_setting BETTER_AUTH_SECRET)
TRUST_PROXY=$(get_setting TRUST_PROXY)
[ -n "$TRUST_PROXY" ] || TRUST_PROXY=false

if [ -z "$POSTGRES_PASSWORD" ]; then
  if docker volume inspect appplanner2_gn_planer_postgres >/dev/null 2>&1; then
    fail "Die Datenbank ist vorhanden, aber ihr Kennwort fehlt in .env.server. Zum Schutz der Daten wird nicht geraten oder ueberschrieben. Bitte .env.server aus der Sicherung wiederherstellen."
  else
    POSTGRES_PASSWORD=$(random_hex 24)
  fi
fi
if [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then BETTER_AUTH_SECRET=$(random_hex 48); fi

PUBLIC_URL_OVERRIDE=$(get_setting PUBLIC_URL_OVERRIDE)
WEB_ORIGINS_OVERRIDE=$(get_setting WEB_ORIGINS_OVERRIDE)
APP_BIND_ADDRESS_OVERRIDE=$(get_setting APP_BIND_ADDRESS_OVERRIDE)

if [ "$LOCAL_ONLY" = true ]; then
  PUBLIC_URL=http://localhost:3001
  APP_BIND_ADDRESS=127.0.0.1
else
  if [ -n "$PUBLIC_URL_OVERRIDE" ]; then
    printf '%s' "$PUBLIC_URL_OVERRIDE" | grep -Eq '^https?://[^/[:space:]]+/?$' || fail "PUBLIC_URL_OVERRIDE muss eine vollstaendige HTTP- oder HTTPS-Adresse ohne Unterpfad sein."
    PUBLIC_URL=${PUBLIC_URL_OVERRIDE%/}
  else
    LAN_ADDRESS=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.][0-9.]*\).*/\1/p' | head -n 1 || true)
    if [ -z "$LAN_ADDRESS" ]; then
      LAN_ADDRESS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | grep -Ev '^(127\.|169\.254\.)' | head -n 1 || true)
    fi
    [ -n "$LAN_ADDRESS" ] || fail "Es konnte keine IPv4-Netzwerkadresse ermittelt werden."
    PUBLIC_URL="http://$LAN_ADDRESS:3001"
  fi
  APP_BIND_ADDRESS=${APP_BIND_ADDRESS_OVERRIDE:-0.0.0.0}
  case "$APP_BIND_ADDRESS" in 0.0.0.0|127.0.0.1) ;; *) fail "APP_BIND_ADDRESS_OVERRIDE darf nur 0.0.0.0 oder 127.0.0.1 sein." ;; esac
  if [ "$APP_BIND_ADDRESS" = 127.0.0.1 ] && [ -z "$PUBLIC_URL_OVERRIDE" ]; then
    fail "APP_BIND_ADDRESS_OVERRIDE=127.0.0.1 benoetigt fuer den Serverbetrieb eine PUBLIC_URL_OVERRIDE (z. B. fuer einen Reverse-Proxy)."
  fi
fi
if [ "$LOCAL_ONLY" = true ]; then
  WEB_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
elif [ -n "$WEB_ORIGINS_OVERRIDE" ]; then
  WEB_ORIGINS=$WEB_ORIGINS_OVERRIDE
elif [ -n "$PUBLIC_URL_OVERRIDE" ]; then
  WEB_ORIGINS=$PUBLIC_URL
else
  WEB_ORIGINS=$PUBLIC_URL
fi

temporary_environment="$ENVIRONMENT_FILE.tmp.$$"
umask 077
{
  printf '%s\n' '# Automatisch erzeugt. Enthaelt Server-Geheimnisse und darf nicht veroeffentlicht werden.'
  printf 'POSTGRES_PASSWORD=%s\n' "$POSTGRES_PASSWORD"
  printf 'BETTER_AUTH_SECRET=%s\n' "$BETTER_AUTH_SECRET"
  printf 'PUBLIC_URL=%s\n' "$PUBLIC_URL"
  printf 'WEB_ORIGINS=%s\n' "$WEB_ORIGINS"
  printf 'APP_BIND_ADDRESS=%s\n' "$APP_BIND_ADDRESS"
  printf 'TRUST_PROXY=%s\n' "$TRUST_PROXY"
  if [ -f "$ENVIRONMENT_FILE" ]; then
    grep -Ev '^(#|$|POSTGRES_PASSWORD=|BETTER_AUTH_SECRET=|PUBLIC_URL=|WEB_ORIGINS=|APP_BIND_ADDRESS=|TRUST_PROXY=|BOOTSTRAP_TEACHER_)' "$ENVIRONMENT_FILE" || true
  fi
} > "$temporary_environment"
mv "$temporary_environment" "$ENVIRONMENT_FILE"

compose() {
  if [ -n "${BACKUP_MIRROR_HOST_DIRECTORY:-}" ] && [ -d "$BACKUP_MIRROR_HOST_DIRECTORY" ]; then
    docker compose --env-file "$ENVIRONMENT_FILE" -f "$COMPOSE_FILE" -f "$MIRROR_COMPOSE_FILE" "$@"
  else
    docker compose --env-file "$ENVIRONMENT_FILE" -f "$COMPOSE_FILE" "$@"
  fi
}

BACKUP_MIRROR_HOST_DIRECTORY=$(get_setting BACKUP_MIRROR_HOST_DIRECTORY)
if [ -n "$BACKUP_MIRROR_HOST_DIRECTORY" ] && [ ! -d "$BACKUP_MIRROR_HOST_DIRECTORY" ]; then
  printf '%s\n' 'WARNUNG: Das optionale zweite Sicherungsziel ist derzeit nicht erreichbar. Lokale Sicherungen bleiben aktiv.' >&2
  BACKUP_MIRROR_HOST_DIRECTORY=
fi
export BACKUP_MIRROR_HOST_DIRECTORY

if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
  running_app=$(compose ps -q app 2>/dev/null || true)
  [ -n "$running_app" ] || fail "Port 3001 wird von einer manuell gestarteten oder fremden Anwendung verwendet. Bitte diese zuerst beenden."
fi

printf '%s\n' 'Baue und starte App Planner 2. Beim ersten Mal kann dies einige Minuten dauern ...'
compose up -d --build || fail "Die Docker-Dienste konnten nicht gestartet werden."

healthy=false
attempt=0
while [ "$attempt" -lt 60 ]; do
  if compose exec -T app node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 3
done
if [ "$healthy" != true ]; then
  compose logs --tail 80 app >&2 || true
  fail "Die Anwendung wurde nicht rechtzeitig bereit."
fi

if ! teacher_count_raw=$(compose exec -T postgres psql -U gn_planer -d gn_planer -tAc 'SELECT count(*) FROM teacher_profiles'); then
  fail "Der Kontostand konnte nicht geprueft werden."
fi
teacher_count=$(printf '%s' "$teacher_count_raw" | tr -d '[:space:]')
case "$teacher_count" in ''|*[!0-9]*) fail "Die Kontopruefung lieferte ein ungueltiges Ergebnis." ;; esac
if [ "$teacher_count" = 0 ]; then
  [ -t 0 ] || fail "Fuer die Ersteinrichtung muss dieses Skript einmal interaktiv in einem Terminal ausgefuehrt werden."
  printf '\n%s\n' 'Ersteinrichtung: Es gibt noch kein Administrationskonto.'
  while :; do
    printf '%s' 'Anmelde-ID des Administrators [admin]: '
    IFS= read -r BOOTSTRAP_TEACHER_ID
    [ -n "$BOOTSTRAP_TEACHER_ID" ] || BOOTSTRAP_TEACHER_ID=admin
    if printf '%s' "$BOOTSTRAP_TEACHER_ID" | grep -Eq '^[A-Za-z0-9._-]{3,32}$'; then break; fi
    printf '%s\n' 'Bitte 3-32 Zeichen ohne Leerzeichen verwenden.'
  done
  printf '%s' 'Anzeigename [Administration]: '
  IFS= read -r BOOTSTRAP_TEACHER_NAME
  [ -n "$BOOTSTRAP_TEACHER_NAME" ] || BOOTSTRAP_TEACHER_NAME=Administration
  while :; do
    printf '%s' 'Neues Admin-Passwort (mindestens 12 Zeichen): '
    stty -echo
    IFS= read -r BOOTSTRAP_TEACHER_PASSWORD
    stty echo
    printf '\n%s' 'Passwort wiederholen: '
    stty -echo
    IFS= read -r password_confirmation
    stty echo
    printf '\n'
    if [ "${#BOOTSTRAP_TEACHER_PASSWORD}" -ge 12 ] && [ "$BOOTSTRAP_TEACHER_PASSWORD" = "$password_confirmation" ]; then break; fi
    printf '%s\n' 'Die Passwoerter muessen uebereinstimmen und mindestens 12 Zeichen lang sein.'
  done
  export BOOTSTRAP_TEACHER_ID BOOTSTRAP_TEACHER_NAME BOOTSTRAP_TEACHER_PASSWORD
  compose run --rm --no-deps --entrypoint pnpm app bootstrap:teacher || fail "Das Administrationskonto konnte nicht angelegt werden."
  unset BOOTSTRAP_TEACHER_ID BOOTSTRAP_TEACHER_NAME BOOTSTRAP_TEACHER_PASSWORD password_confirmation
fi

printf '\nApp Planner 2 ist bereit: %s\n' "$PUBLIC_URL"
printf '%s\n' 'Datenbank und Anwendung laufen als Docker-Dienste im Hintergrund weiter.'
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$PUBLIC_URL" >/dev/null 2>&1 || true
fi
