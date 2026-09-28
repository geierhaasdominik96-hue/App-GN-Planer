#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENVIRONMENT_FILE="$PROJECT_ROOT/.env.server"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"

[ -f "$ENVIRONMENT_FILE" ] || {
  printf '%s\n' 'FEHLER: Die Serverkonfiguration .env.server wurde nicht gefunden.' >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  printf '%s\n' 'FEHLER: Docker wurde nicht gefunden.' >&2
  exit 1
}

cd "$PROJECT_ROOT"
# Absichtlich ohne --volumes/-v: Datenbankvolume und Sicherungen bleiben erhalten.
docker compose --env-file "$ENVIRONMENT_FILE" -f "$COMPOSE_FILE" down --timeout 60
printf '%s\n' 'App Planner 2 wurde beendet. Datenbank und Sicherungen bleiben erhalten.'
