#!/usr/bin/env bash
# ci-commit-push.sh — commit + push lineal de workflows automatizados.
#
# Flujo desacoplado y lineal:
# 1. Configura identidad de git para github-actions[bot].
# 2. Registra el estado de la corrida en data/internal-log.jsonl.
# 3. Prepara en stage el log interno y los archivos de estado modificados.
# 4. Si no hay diferencias efectivas, finaliza de inmediato.
# 5. Genera el commit atómico y realiza intento directo de push.
# 6. En caso de avance remoto concurrente, intenta una reconciliación lineal con rebase.
# 7. Si se detecta colisión/conflicto, aborta el rebase limpiamente sin bucles agresivos,
#    sin git reset --hard y sin demoras aleatorias, reportando ::warning:: y saliendo 0.

set -uo pipefail

MSG="${1:?falta commit-msg}"
LOG_SRC="${2:?falta log-source}"
LOG_STATUS="${3:?falta log-status}"
LOG_INPUT="${4:?falta log-input}"
shift 4
STATE_FILES=("$@")

git config user.name  "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

# 1. Registrar entrada en el log interno si se proporcionó un input válido
if [ -f "$LOG_INPUT" ]; then
  node scripts/log-status.mjs "$LOG_SRC" "$LOG_STATUS" < "$LOG_INPUT"
elif [ -n "$LOG_INPUT" ]; then
  echo "$LOG_INPUT" | node scripts/log-status.mjs "$LOG_SRC" "$LOG_STATUS"
fi

# 2. Stage de archivos modificados
if [ ${#STATE_FILES[@]} -gt 0 ]; then
  git add data/internal-log.jsonl "${STATE_FILES[@]}" 2>/dev/null || git add data/internal-log.jsonl
else
  git add data/internal-log.jsonl 2>/dev/null || true
fi

# 3. Comprobar si hay cambios para commitear
if git diff --cached --quiet; then
  echo "ci-commit-push: sin cambios pendientes para commitear"
  exit 0
fi

# 4. Commit atómico local
git commit -q -m "$MSG"

# 5. Intento de push directo lineal
if git push -q origin HEAD:main 2>/dev/null; then
  echo "ci-commit-push: push completado exitosamente"
  exit 0
fi

# 6. Reconciliación lineal en caso de que origin/main haya avanzado concurrentemente
echo "ci-commit-push: origin/main avanzó concurrentemente; intentando rebase lineal..."
git fetch origin main -q 2>/dev/null || true

if git pull --rebase origin main -q 2>/dev/null; then
  if git push -q origin HEAD:main 2>/dev/null; then
    echo "ci-commit-push: push completado exitosamente tras rebase lineal"
    exit 0
  fi
fi

# 7. Manejo seguro de colisión: abortar rebase limpiamente sin forzar ni resetear
git rebase --abort 2>/dev/null || true
echo "::warning::ci-commit-push: colisión concurrente detectada en origin/main ($LOG_SRC) — abortando push pacíficamente para evitar forzar colisiones en el árbol"
exit 0
