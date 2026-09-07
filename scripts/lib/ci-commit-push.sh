#!/usr/bin/env bash
# ci-commit-push.sh — commit + push de un workflow automatizado, resistente a carreras.
#
# EL PROBLEMA: varios workflows (health-monitor, premiere-radar, tatort-subs-prewarm,
# daily-catalog-refresh, anti-frustration-review, torbox-airlock, monthly-digest) corren a
# horarios cercanos y TODOS appendean una línea a data/internal-log.jsonl. El patrón viejo
# (commit -> git pull --rebase -> push) choca cuando dos corridas agregan una línea al final
# del mismo archivo: git ve dos "add" en la misma posición y el rebase falla con CONFLICT,
# tirando el job entero y perdiendo esa línea de log. Pasó el 2026-08-28, 2026-09-03 y
# 2026-09-06 (torbox-airlock).
#
# LA SOLUCIÓN: reintentar hasta 5 veces. En cada intento: traer el origin/main más fresco,
# resetear el árbol a esa base, restaurar los archivos de estado que el script ya generó,
# RE-APPENDEAR la línea de log sobre el internal-log.jsonl fresco (así nunca hay dos appends
# compitiendo por la misma posición), commitear y pushear. Si el push se rechaza porque origin
# volvió a moverse, se reintenta desde cero con la base todavía más nueva.
#
# Los archivos de estado (premiere-radar-state.json, tatort-prewarm-state.json,
# anti-frustration-log.json) los escribe un único workflow cada uno -> nunca entran en
# conflicto entre sí, solo hay que preservarlos a través del reset.
#
# Uso:
#   bash scripts/lib/ci-commit-push.sh "<commit-msg>" <log-source> <log-status> <log-input> \
#        [archivo-de-estado ...]
#
# Nunca falla el job: si tras 5 intentos no pudo pushear, emite un ::warning:: y sale 0
# (perder una línea de bookkeeping no justifica marcar la corrida en rojo).

set -uo pipefail

MSG="${1:?falta commit-msg}"
LOG_SRC="${2:?falta log-source}"
LOG_STATUS="${3:?falta log-status}"
LOG_INPUT="${4:?falta log-input}"
shift 4
STATE_FILES=("$@")

git config user.name  "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# Snapshot de los archivos de estado que el script ya modificó, antes de tocar el árbol.
TMP="$(mktemp -d)"
snap_name() { echo "$1" | tr '/' '_'; }
for f in "${STATE_FILES[@]}"; do
  [ -f "$f" ] && cp "$f" "$TMP/$(snap_name "$f")"
done
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

for attempt in 1 2 3 4 5; do
  git fetch origin main -q || true
  git reset --hard origin/main -q

  # Restaurar los archivos de estado desde el snapshot.
  for f in "${STATE_FILES[@]}"; do
    snap="$TMP/$(snap_name "$f")"
    [ -f "$snap" ] && cp "$snap" "$f"
  done

  # Re-appendear la línea de log sobre el internal-log.jsonl recién traído de origin.
  node scripts/log-status.mjs "$LOG_SRC" "$LOG_STATUS" < "$LOG_INPUT"

  git add data/internal-log.jsonl "${STATE_FILES[@]}" 2>/dev/null || git add data/internal-log.jsonl
  if git diff --cached --quiet; then
    echo "ci-commit-push: sin cambios que commitear"
    exit 0
  fi

  git commit -q -m "$MSG"
  if git push -q origin HEAD:main 2>/dev/null; then
    echo "ci-commit-push: pusheado en el intento $attempt"
    exit 0
  fi

  echo "ci-commit-push: push rechazado (intento $attempt/5), reintentando…"
  sleep $(( (RANDOM % 8) + 3 ))
done

echo "::warning::ci-commit-push: no se pudo pushear tras 5 intentos ($LOG_SRC) — se perdió una línea de log interno, no es crítico"
exit 0
