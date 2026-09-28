#!/bin/sh
set -eu

echo "Warte auf PostgreSQL ..."
tries=0
until PGPASSWORD="$POSTGRES_PASSWORD" pg_isready -h "${POSTGRES_HOST:-postgres}" -U gn_planer -d gn_planer >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "FEHLER: PostgreSQL wurde nicht rechtzeitig bereit." >&2
    exit 1
  fi
  sleep 2
done

echo "Aktualisiere die Datenbank ..."
pnpm db:setup

GN_PLANNER_BUILD_ID="$(node scripts/current-build-id.mjs)"
export GN_PLANNER_BUILD_ID

mkdir -p /app/data/Sicherungen
chown node:node /app/data/Sicherungen 2>/dev/null || true
if ! su-exec node sh -c 'probe="$1/.gn-planer-write-test-$$"; : > "$probe" && rm -f "$probe"' sh /app/data/Sicherungen; then
  echo "FEHLER: Der Sicherungsordner /app/data/Sicherungen ist fuer die App nicht beschreibbar." >&2
  echo "Bitte die Schreibrechte des Projektordners data/Sicherungen pruefen." >&2
  exit 1
fi

if [ -n "${BACKUP_MIRROR_DIRECTORY:-}" ]; then
  mkdir -p "$BACKUP_MIRROR_DIRECTORY"
  if ! chown node:node "$BACKUP_MIRROR_DIRECTORY" 2>/dev/null; then
    echo "WARNUNG: Das zweite Sicherungsziel konnte nicht dem App-Benutzer zugeordnet werden." >&2
    echo "Lokale Sicherungen bleiben aktiv; bitte die Schreibrechte des Spiegelordners pruefen." >&2
  fi
  if ! su-exec node sh -c 'probe="$1/.gn-planer-write-test-$$"; : > "$probe" && rm -f "$probe"' sh "$BACKUP_MIRROR_DIRECTORY"; then
    echo "WARNUNG: Das zweite Sicherungsziel ist fuer die App nicht beschreibbar." >&2
    echo "Lokale Sicherungen bleiben aktiv; der Sicherungsspiegel ist bis zur Korrektur inaktiv." >&2
  fi
fi

echo "Starte GN-Planer (Build $GN_PLANNER_BUILD_ID) ..."
exec su-exec node node apps/api/dist/server.js
