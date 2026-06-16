# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- `pnpm run dev` — dev server en localhost:5173.
- `pnpm run build` — `vue-tsc -b && vite build` (type-check + bundle).
- `pnpm run preview` — sirve el build de `dist/` en localhost:4173 para probar el build localmente.
- `vue-tsc -b --noEmit` — solo type-check sin compilar (más rápido para verificar tipos).
- `node scripts/smoke-test.mjs [url]` — smoke test de Playwright del wizard (default: dev server
  local; acepta la URL de GitHub Pages). Capturas en `.screenshots/` (gitignorado).
- `node scripts/e2e-install.mjs` — instalación REAL en una cuenta de Stremio. Credenciales por
  env vars: `ST_EMAIL`, `ST_PASS`, `TMDB_KEY`, `SUBSENSE_URL`. Hace backup previo de los addons
  en `.backups/` (gitignorado). ⚠️ Sobreescribe la colección de addons de la cuenta.

## Arquitectura

### Flujo de datos principal

`App.vue` monta tres componentes en secuencia:
1. `Authentication` — login/registro con email+password; emite `auth-key` (string JWT de Stremio).
2. `Backup` — descarga/restaura la colección de addons antes de instalar.
3. `PabloFreeWizard` — wizard de 3 pasos que recibe `authKey` por prop.

Al completar el wizard, `PabloFreeWizard` llama:
1. `buildPresetService(params)` → resuelve `preset.json`, aplica todos los `configure*` de addons,
   y devuelve `{ selectedAddons, collections, errors }`.
2. `loadPresetService({ addons, key, platform })` → llama `platformApi.setAddonCollection` →
   `stremioApi.setAddonCollection` → sincroniza con los servidores de Stremio.

### Preset pablo-free

- `public/preset.json` — define `"pablo-free": ["aiometadata", "aiostreams"]` + 4 catálogos
  TMDB Discover custom (ids `*.pablo001`–`pablo004`: Cine/Series Argentina y Latinoamérica,
  con `showInHome: false` → solo visibles en Discover, no en el board).
- `src/components/PabloFreeWizard.vue` — wizard de 3 pasos (TMDB key → URL SubSense → instalar).
  Texto en español hardcodeado, sin claves i18n. Streaming Catalogs y SubSense se instalan como
  `customAddons` (URLs de manifest externas).
- `src/services/presetService.ts` — `buildPresetService` carga `preset.json` via
  `import.meta.env.BASE_URL` (ruta absoluta daba 404 bajo el base path `/MejoraStremio/` de
  GitHub Pages), construye `presetConfig` mergeando las secciones del JSON, y aplica cada
  `configure*`. Particularidades del fork:
  - `pablo-free` está excluido de la inyección de addons regionales (como `allinone`), para que
    instale exactamente 4 addons.
  - `advanced` se pasa en el `context` para que la TMDB key llegue a AIOStreams.

### Patrón de addons (`src/services/addons/`)

Cada archivo exporta una función `configure<Name>(presetConfig, context, ...)`:
- Recibe `presetConfig` (objeto mutable con claves = nombre del addon) y `AddonConfigContext`
  (language, debridEntries, preset, advanced, etc.).
- Puede devolver `{ shouldReplace: true, rebuilt: Record<string, any> }` para reemplazar la clave
  del addon manteniendo el orden del objeto (hay addons que generan múltiples instancias, como
  torrentio con un debrid por instancia).
- O mutarse directamente sobre `presetConfig` si no necesita reordenar.
- Las `configure*` que requieren red son `async` (aiometadata, mediafusion, aiostreams,
  stremthrustore); las demás son síncronas.

### Capa de plataforma (`src/api/platformApi.ts`)

Abstrae Stremio vs Nuvio. Todas las llamadas pasan por `getApi(platform)` que selecciona entre
`stremioApi` y `nuvioApi`. Las respuestas se normalizan a `{ result: { authKey | addons | success } }`
vía `normalizePlatformResponse`. Este fork solo usa `platform: 'stremio'`.

### `src/worker.ts` (Cloudflare Workers, no usado en GitHub Pages)

Entry point para el deploy alternativo a Cloudflare Workers (`pnpm run deploy`). Actúa como proxy
para la API de Nuvio (inyecta `NUVIO_API_KEY` desde env) y sirve la SPA con fallback a `index.html`.
No afecta el deploy a GitHub Pages.

### Build base path

`vite.config.ts` — `base` se calcula desde `GITHUB_REPOSITORY` solo en CI (`GITHUB_ACTIONS=true`);
localmente es `/`. Esto explica por qué los assets funcionan tanto en dev como en Pages.

## Reglas del repo

- Commits en formato conventional (commitlint vía husky; cuerpo con líneas ≤ 100 caracteres).
- Mensajes de commit en español.
- No eliminar el preset `pablo-free`: es el corazón del proyecto.
- Sin Vercel Analytics (se quitó: generaba 404 en GitHub Pages).
- Ante dudas sobre cómo debería ser el código, comparar con el upstream original.
