# Reporte de auditoría — MejoraStremio

Fecha: 2026-09-10

## Resumen ejecutivo

Repo sano. Sin secretos trackeados, sin hardcodeos de credenciales, workflows de CI válidos, código Deno sin errores funcionales. Hallazgo principal de calidad: un helper de autenticación duplicado en 21 scripts en vez de estar centralizado.

## Hallazgos por severidad

- **Media**: el helper `apiPost` (login a la API de Stremio) está duplicado literalmente en 21 scripts, nunca extraído a `scripts/lib/` — a diferencia de `collection-guard.mjs` y `addon-signals.mjs`, que sí se refactorizaron a módulos compartidos. Archivos afectados:
  - scripts/anti-frustration.mjs
  - scripts/apply-cgnat-profile.mjs
  - scripts/apply-friction-zero-sort.mjs
  - scripts/apply-torbox-profile.mjs
  - scripts/audit-streaming-catalogs.mjs
  - scripts/check-catalog-streams.mjs
  - scripts/check-subtitles.mjs
  - scripts/check-torrentio-providers.mjs
  - scripts/curate-streaming-catalogs.mjs
  - scripts/health-check.mjs
  - scripts/install-addon.mjs
  - scripts/list-catalog.mjs
  - scripts/premiere-radar.mjs
  - scripts/regenerate-aiometadata-solotveg.mjs
  - scripts/regenerate-aiometadata.mjs
  - scripts/reorder-addons.mjs
  - scripts/repair-frozen-catalogs.mjs
  - scripts/swap-aiolists-mytrakt.mjs
  - scripts/torbox-airlock.mjs
  - scripts/update-addon-url.mjs
  - scripts/verify-live-account.mjs

  No se refactorizó — es un cambio que toca 21 archivos, riesgo medio, requiere decisión humana antes de ejecutarse.

- **Baja**: `scripts/deno-subdl-addon.ts` tiene 1 error de tipos (`deno check`). Es un script legacy, no deployado — el que está en producción (`deno-hub.ts`) compila limpio.
- **Baja**: `deno lint` reporta 15 hallazgos cosméticos (variables sin usar, `let` que podría ser `const`, bloques vacíos) — nada funcional.
- **Baja**: `docs/encuesta-catalogos.md` quedó desactualizado respecto a cambios posteriores documentados en `CLAUDE.md` (la "ley dura" de orden por fecha del 2026-09-07). No crítico — el documento se declara a sí mismo como snapshot de una charla puntual.

## Verificado sano

- `SECRETS.local.md` correctamente gitignoreado, confirmado no trackeado.
- Cero credenciales hardcodeadas en scripts; `cuentas/*/CLAUDE.md` y `aiometadata-instance.json` solo referencian nombres de variables de entorno.
- Los 18 archivos YAML de `.github/workflows` validan OK.
- `deno.jsonc` válido.
- `.backups/`: 112 archivos, 16 MB — solo cuantificado, no tocado (son backups automáticos legítimos, no trackeados en git).

## Acciones tomadas

- Ninguna modificación de código — auditoría de solo lectura más verificación estática (`deno check`, `deno lint`, validación de YAML).
- Nada comiteado, nada pusheado.

## Pendientes que requieren decisión humana

1. Refactorizar `apiPost` a un módulo compartido en `scripts/lib/` (afecta 21 archivos).
2. Decidir si arreglar o borrar `scripts/deno-subdl-addon.ts` (legacy, con error de tipos, no deployado).
3. Actualizar `docs/encuesta-catalogos.md` o marcarlo explícitamente como snapshot histórico desactualizado.
