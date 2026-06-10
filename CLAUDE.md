# MejoraStremio

Fork personalizado de [DryKillLogic/stremio-account-bootstrapper](https://github.com/DryKillLogic/stremio-account-bootstrapper).
SPA en Vue 3 + TypeScript + Vite + Tailwind/daisyUI que configura una cuenta de Stremio con un
preset de addons. Este fork reemplaza el flujo genérico por un único preset (`pablo-free`) con
wizard de 3 pasos en español. UI 100% en español (locale forzado a `es` en `src/main.ts`).

Sitio publicado: https://pabloeckert.github.io/MejoraStremio/ (deploy automático a GitHub Pages
en cada push a `main` vía `.github/workflows/deploy.yml`).

## Comandos

- `pnpm install` — requiere pnpm 11+ (la config `allowBuilds` vive en `pnpm-workspace.yaml`;
  pnpm 11 ya no lee el campo `pnpm` de package.json). No usar npm (no mezclar package-lock.json).
- `pnpm run build` — `vue-tsc -b && vite build`.
- `pnpm run dev` — dev server en localhost:5173.
- `node scripts/smoke-test.mjs [url]` — smoke test de Playwright del wizard (default: dev server
  local; acepta la URL de GitHub Pages). Capturas en `.screenshots/` (gitignorado).
- `node scripts/e2e-install.mjs` — instalación REAL en una cuenta de Stremio. Credenciales por
  env vars: `ST_EMAIL`, `ST_PASS`, `TMDB_KEY`, `SUBSENSE_URL`. Hace backup previo de los addons
  en `.backups/` (gitignorado). ⚠️ Sobreescribe la colección de addons de la cuenta.

## Arquitectura del preset pablo-free

- `public/preset.json` — define `"pablo-free": ["aiometadata", "aiostreams"]` + 4 catálogos
  TMDB Discover custom (ids `*.pablo001`–`pablo004`: Cine/Series Argentina y Latinoamérica,
  con `showInHome: false` → solo visibles en Discover, no en el board).
- `src/components/PabloFreeWizard.vue` — wizard de 3 pasos (TMDB key → URL SubSense → instalar).
  Texto en español hardcodeado, sin claves i18n. Streaming Catalogs y SubSense se instalan como
  customAddons.
- `src/services/presetService.ts` — orquesta la instalación. Particularidades de este fork:
  - `pablo-free` está excluido de la inyección de addons regionales (como `allinone`), para que
    instale exactamente 4 addons.
  - `advanced` se pasa en el `context` para que la TMDB key llegue a AIOStreams.
  - `preset.json` se carga con `import.meta.env.BASE_URL` (ruta absoluta `/preset.json` daba 404
    bajo el base path `/MejoraStremio/` de GitHub Pages).
- `vite.config.ts` — `base` se calcula desde `GITHUB_REPOSITORY` solo en CI; localmente es `/`.

## Reglas del repo

- Commits en formato conventional (commitlint vía husky; cuerpo con líneas ≤ 100 caracteres).
- Mensajes de commit en español.
- No eliminar el preset `pablo-free`: es el corazón del proyecto.
- Sin Vercel Analytics (se quitó: generaba 404 en GitHub Pages).
- Ante dudas sobre cómo debería ser el código, comparar con el upstream original.

## Estado (2026-06-09)

Todo funcionando de punta a punta y verificado:
- install/build/dev limpios (Node 24, pnpm 11.5.2).
- Deploy a GitHub Pages OK con actions en Node 24 (checkout@v6, setup-node@v6,
  pnpm/action-setup@v6, upload-pages-artifact@v5, deploy-pages@v5).
- Instalación real ejecutada en la cuenta del usuario desde el sitio publicado: los 4 addons
  (AIOMetadata, AIOStreams, Streaming Catalogs, SubSense) quedaron en la cuenta.
- Verificado en Stremio desktop 5.0.21: catálogos en el board y en Discover (Cine Argentina:
  794 títulos; Latinoamérica Series: 714), SubSense devolviendo subtítulos en español.
- Backup de la colección anterior (18 addons) en `.backups/addons-backup-1781057201346.json`.

## Next Steps (priorizados)

1. **Cambiar la contraseña de Stremio** — se compartió en texto plano durante la sesión del
   2026-06-09 (higiene de seguridad; nada quedó guardado en el repo).
2. **Verificación visual del player** — reproducir un stream y confirmar que el menú de
   subtítulos muestra las entradas de SubSense (único tramo no verificado visualmente).
3. **Smoke test en CI** — agregar un job post-deploy en `deploy.yml` que corra
   `node scripts/smoke-test.mjs <url de Pages>` para detectar regresiones en producción.
4. **Paso opcional de AIOLists en el wizard** — hoy es instrucción manual; evaluar pedir la URL
   configurada de aiolists.elfhosted.com como paso 3 opcional e instalarla como customAddon.
5. **Sync periódico con upstream** — traer mejoras de DryKillLogic/stremio-account-bootstrapper
   (los archivos de servicios/addons casi no divergen; el merge debería ser simple).
