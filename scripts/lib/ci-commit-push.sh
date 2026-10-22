#!/usr/bin/env bash
# ci-commit-push.sh — commit + push lineal con higiene de git y prevención de race conditions.
#
# Directivas de Higiene CI/CD:
# 1. Si el estado es 'ok' y no hay modificaciones efectivas en archivos de estado (STATE_FILES),
#    omite el commit y push. Evita el spam de cientos de commits y condiciones de carrera concurrentes.
# 2. Solo commitea cuando:
#    a) Existen cambios reales en STATE_FILES (ej. refresh de fechas, nuevos episodios en radar, IPTV).
#    b) El estado es 'error' o 'warn' (registrando la incidencia en data/internal-log.jsonl).
# 3. En caso de push concurrente, implementa reintento con backoff exponencial (hasta 3 intentos)
#    y rebase lineal limpio. Si persiste la colisión, aborta pacíficamente reportando warning.

set -uo pipefail

MSG="${1:?falta commit-msg}"
LOG_SRC="${2:?falta log-source}"
LOG_STATUS="${3:?falta log-status}"
LOG_INPUT="${4:?falta log-input}"
shift 4
STATE_FILES=("$@")

git config user.name  "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# 1. Verificar si hay cambios reales en los archivos de estado
MODIFIED_STATE=""
if [ ${#STATE_FILES[@]} -gt 0 ]; then
  MODIFIED_STATE=$(git status --porcelain "${STATE_FILES[@]}" 2>/dev/null || true)
fi

# 2. Higiene de Git: Si el estado es OK y no hay mutación de estado, omitir commit/push
if [ "$LOG_STATUS" = "ok" ] && [ -z "$MODIFIED_STATE" ]; then
  echo "ci-commit-push: Estado OK sin cambios en archivos de estado (${STATE_FILES[*]-%ninguno%}). Omitiendo commit para preservar higiene de git y evitar race conditions."
  exit 0
fi

# 3. Registrar en log interno solo ante mutaciones de estado o incidencias (error/warn)
if [ -f "$LOG_INPUT" ]; then
  node scripts/log-status.mjs "$LOG_SRC" "$LOG_STATUS" < "$LOG_INPUT"
elif [ -n "$LOG_INPUT" ]; then
  echo "$LOG_INPUT" | node scripts/log-status.mjs "$LOG_SRC" "$LOG_STATUS"
fi

# 4. Stage de archivos modificados
if [ ${#STATE_FILES[@]} -gt 0 ]; then
  git add data/internal-log.jsonl "${STATE_FILES[@]}" 2>/dev/null || git add data/internal-log.jsonl
else
  git add data/internal-log.jsonl 2>/dev/null || true
fi

# 5. Comprobar si hay cambios staged efectivos para commitear
if git diff --cached --quiet; then
  echo "ci-commit-push: sin cambios efectivos pendientes para commitear."
  exit 0
fi

# 6. Commit atómico local
git commit -q -m "$MSG"

# 7. Intento de push lineal con backoff exponencial y rebase limpio (máximo 3 intentos)
PUSH_SUCCESS=0
for attempt in 1 2 3; do
  if git push -q origin HEAD:main 2>/dev/null; then
    echo "ci-commit-push: push completado exitosamente (intento $attempt)"
    PUSH_SUCCESS=1
    break
  fi

  echo "ci-commit-push: origin/main avanzó concurrentemente; reintentando rebase (intento $attempt)..."
  git fetch origin main -q 2>/dev/null || true

  if git pull --rebase origin main -q 2>/dev/null; then
    if git push -q origin HEAD:main 2>/dev/null; then
      echo "ci-commit-push: push completado exitosamente tras rebase lineal (intento $attempt)"
      PUSH_SUCCESS=1
      break
    fi
  fi

  git rebase --abort 2>/dev/null || true
  sleep $((attempt * 2))
done

# 8. Manejo seguro de colisión concurrente: no romper el job si la colisión persiste
if [ "$PUSH_SUCCESS" = "0" ]; then
  git rebase --abort 2>/dev/null || true
  echo "::warning::ci-commit-push: colisión concurrente persistente en origin/main ($LOG_SRC) — abortando push pacíficamente sin forzar colisiones en el árbol."
fi

exit 0
