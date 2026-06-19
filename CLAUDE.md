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
- `node scripts/health-check.mjs` — verifica manifests de addons clave, subtítulos en español
  (SubSense) y streams P2P. Credenciales opcionales: `ST_EMAIL`, `ST_PASS`.

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

## Mantenimiento

### Script de health-check

```
node scripts/health-check.mjs
ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/health-check.mjs
```

Con credenciales hace una auditoría **dinámica**: lee la colección real de la cuenta y prueba
los addons efectivamente instalados (no una lista hardcodeada). Verifica 5 cosas:
1. Cuenta: login, ≥10 addons, y **ningún `manifest.id` duplicado** (guard de regresión: la
   colisión de id es lo que rompía la búsqueda — ver abajo).
2. Manifests: cada addon instalado responde su manifest.
3. Catálogos + búsqueda de AIOMetadata: muestrea catálogos y prueba búsqueda por título y por
   actor (`people_search`).
4. Streams: prueba TODOS los addons de streams (Torrentio, Comet, Meteor, NoTorrent,
   WebStreamr), incluyendo un título de nicho (Will Trent) para no dar falsos OK.
5. Subtítulos: prueba SubSense + GTSubs + OpenSubtitles v3 para español.

Sin credenciales degrada a verificar manifests públicos. Exit code 0 = todo OK.

### Búsqueda rota por `manifest.id` duplicado (resuelto 2026-06-19)

Stremio identifica addons por `manifest.id`, **no** por `transportUrl`. Dos instancias del
mismo addon con el mismo id (típico: dos AIOMetadata, cuyo id `aio-metadata` es fijo) rompen
la búsqueda global aunque cada backend responda bien por separado. La cuenta `stremioeg` tenía
dos AIOMetadata; se consolidaron en **una sola instancia** con todos los catálogos. El
health-check ahora falla si detecta ids duplicados.

### SubSense — reglas críticas

El token de SubSense tiene formato `{userId}-{configString}`:
- `userId` debe ser **exactamente 8 caracteres** (el JS del sitio genera 8 chars con
  `generateUserId()`). Con más caracteres el servidor devuelve solo inglés.
- `configString` = `encodeURIComponent(JSON.stringify({languages:["es"],maxSubtitles:20}))`
- Código de idioma: usar `"es"` (NO `"spa"`, `"es-AR"`, `"es-419"` — esos devuelven inglés)
- Para regenerar: ir a `https://subsense.nepiraw.com`, elegir Spanish, copiar la URL del manifest.

### Backup y restauración de addons

Los backups de `.backups/` no están en el repo (`.gitignore`). Para restaurar una cuenta:

```powershell
# Leer backup y parsear addons (acepta los 3 formatos posibles)
$raw = Get-Content .backups\backup-NAME.json -Raw | ConvertFrom-Json
$addons = if ($raw.result.addons) { $raw.result.addons }
          elseif ($raw.addons) { $raw.addons }
          else { $raw }

# Hacer backup previo
$authKey = "..."   # obtener via login
Invoke-RestMethod -Uri "https://api.strem.io/api/addonCollectionGet" -Method POST `
  -ContentType "application/json" `
  -Body (@{type="AddonCollectionGet";authKey=$authKey;update=$true} | ConvertTo-Json) `
  | ConvertTo-Json -Depth 20 | Out-File ".backups\backup-pre-restore.json"

# Restaurar
Invoke-RestMethod -Uri "https://api.strem.io/api/addonCollectionSet" -Method POST `
  -ContentType "application/json" `
  -Body (@{type="AddonCollectionSet";authKey=$authKey;addons=$addons} | ConvertTo-Json -Depth 20)
```

### Addons que pueden caerse

| Addon                    | Tipo     | Alternativa si cae           |
|--------------------------|----------|------------------------------|
| OpenSubtitlesPRO         | subs     | Removido; usar OpenSubs v3   |
| Community Subtitles      | subs     | Removido; usar SubSense      |
| Streaming Catalogs Plus  | catalogs | URL `7a82163c306e-*.baby-beamup.club`|
| Subsense con userId >8ch | subs     | Regenerar con userId de 8ch  |

### Problemas conocidos: Wild Cards (Vanessa Morgan, CBC) — mitigado

Episodios S01E07+ tienen pocas seeds en Torrentio (2–8) por ser producción canadiense (CBC)
con baja distribución. **Comet lo resuelve**: el audit del 2026-06-19 midió 20–26 streams por
episodio vía Comet (vs 5–11 de Torrentio). No es problema de configuración; con Comet en el
setup el contenido de nicho queda cubierto.

### Catálogos de Discover (AIOMetadata)

Cada catálogo vive en `aioMetadataConfig.catalogs.standard` de `public/preset.json` con
`metadata.discover.params` (lo que se manda a TMDB Discover) y `metadata.discover.formState`
(espejo para el Catalog Builder de la web). Los `pablo00N` son catálogos custom del fork
(Argentina, Latam, Próximos Estrenos, En Cartelera). Para validar un cambio sin esperar al
deploy: POST el `config` (con `catalogs` inyectado) a
`https://aiometadata.elfhosted.com/api/config/save`, te devuelve `installUrl`; GET ese
`manifest.json` y luego `catalog/<type>/<id>.json` para ver resultados reales.

- **Búsqueda por actor**: usar el catálogo dedicado `people_search.people_search_movie/series`
  (no el agregador `search.movie`, que devuelve documentales sobre el actor en vez de su
  filmografía). Requiere `search.engineEnabled.people_search_movie/series = true`.
- **`hideUnreleasedDigital` debe ser `false`** para que "Próximos Estrenos"/"En Cartelera"
  devuelvan resultados (con `true` AIOMetadata oculta todo lo no estrenado, sin override por
  catálogo). Costo: catálogos como Trending mezclan algún título aún no disponible.
- **Caveat de fechas**: "Próximos Estrenos" y "En Cartelera" usan fechas absolutas
  (`primary_release_date.gte/lte`) hardcodeadas a la fecha de generación del JSON. TMDB Discover
  no soporta fechas relativas, así que se degradan con el tiempo (envejecen ~meses). Para
  refrescar: regenerar el `preset.json` con la fecha actual. **No** regenerar la instancia viva
  de `stremioeg` sin el usuario presente: crea un UUID nuevo y **pierde la conexión OAuth de
  Trakt/Simkl** (los tokens viven server-side ligados al UUID, no en el `config` que se guarda).

## Reglas del repo

- Commits en formato conventional (commitlint vía husky; cuerpo con líneas ≤ 100 caracteres).
- Mensajes de commit en español.
- No eliminar el preset `pablo-free`: es el corazón del proyecto.
- Sin Vercel Analytics (se quitó: generaba 404 en GitHub Pages).
- Ante dudas sobre cómo debería ser el código, comparar con el upstream original.
