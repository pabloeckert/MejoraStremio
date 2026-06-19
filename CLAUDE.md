# CLAUDE.md

Guía para Claude Code (claude.ai/code) al trabajar en este repositorio.

# MejoraStremio

**Caja de herramientas personal de mantenimiento de una cuenta de Stremio** (la de Pablo,
`stremioeg@gmail.com`), operada por terminal contra las APIs de Stremio y de los addons. **No es
una app web.**

Empezó como un fork de la SPA
[DryKillLogic/stremio-account-bootstrapper](https://github.com/DryKillLogic/stremio-account-bootstrapper)
— un wizard web que instalaba un preset de addons. El 2026-06-19 se **eliminó toda la SPA** (Vue,
Vite, deploy a GitHub Pages, etc.): Pablo gestiona el setup por terminal, no usaba el sitio. El
sitio `pabloeckert.github.io/MejoraStremio` se despublicó. El historial de git conserva la versión
SPA si alguna vez hiciera falta.

## Estructura

```
data/preset.json          Fuente de verdad de los catálogos de AIOMetadata (config completa +
                          definición de catálogos). Se usa para reconstruir la config si hace falta.
scripts/health-check.mjs  Auditoría de la cuenta y los addons (ver abajo).
scripts/fix-subtitles.*   Regenera la config de SubSense en una cuenta (.mjs Node, .ps1 PowerShell).
```

Los scripts son Node ≥ 20 sin dependencias (`fetch`/`https` nativos). No hay `package.json` ni
build: es un toolkit, no un paquete. No usar `npm install`.

## Estado actual de la cuenta (stremioeg, 2026-06-19)

13 addons. AIOMetadata consolidado en **una sola instancia** (UUID `2e265900-0f7c-483c-848b-c24acd554d32`),
con 110 catálogos: globales (Trending, Latest, Top Rated, géneros, plataformas + Top 10 FlixPatrol,
décadas), 12 países (Argentina, Latam, España, Francia, Alemania, Italia, Reino Unido, Portugal,
México, Colombia, Chile, Brasil, Perú), "Próximos Estrenos", "En Cartelera", y búsqueda por título
y por actor. Trakt y Simkl conectados. Streams: Torrentio, Comet, Meteor, NoTorrent, WebStreamr.
Subtítulos: SubSense (español), GTSubs, OpenSubtitles v3.

## Mantenimiento

### Script de health-check

```
node scripts/health-check.mjs
ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/health-check.mjs
```

Con credenciales hace una auditoría **dinámica**: lee la colección real de la cuenta y prueba los
addons efectivamente instalados (no una lista hardcodeada). Verifica 5 cosas:
1. Cuenta: login, ≥10 addons, y **ningún `manifest.id` duplicado** (guard de regresión: la
   colisión de id es lo que rompía la búsqueda — ver abajo).
2. Manifests: cada addon instalado responde su manifest (normaliza URLs sin `manifest.json`).
3. Catálogos + búsqueda de AIOMetadata: muestrea catálogos y prueba búsqueda por título y por
   actor (`people_search`).
4. Streams: prueba TODOS los addons de streams (Torrentio, Comet, Meteor, NoTorrent, WebStreamr),
   incluyendo un título de nicho (Will Trent) para no dar falsos OK.
5. Subtítulos: prueba SubSense + GTSubs + OpenSubtitles v3 para español.

Sin credenciales degrada a verificar manifests públicos. Exit code 0 = todo OK.

### Búsqueda rota por `manifest.id` duplicado (resuelto 2026-06-19)

Stremio identifica addons por `manifest.id`, **no** por `transportUrl`. Dos instancias del mismo
addon con el mismo id (típico: dos AIOMetadata, cuyo id `aio-metadata` es fijo) rompen la búsqueda
global aunque cada backend responda bien por separado. La cuenta tenía dos AIOMetadata; se
consolidaron en una sola. El health-check ahora falla si detecta ids duplicados.

### AIOMetadata — reconstruir/editar la instancia

La config se guarda con un POST a `https://aiometadata.elfhosted.com/api/config/save` con
`{ config, password }`; devuelve `installUrl` (un UUID nuevo). Para validar sin instalar: GET ese
`manifest.json` y luego `catalog/<type>/<id>.json` para ver resultados reales. La base de `config`
está en `data/preset.json` → `aioMetadataConfig.config`; los catálogos en `aioMetadataConfig.catalogs.standard`
(cada uno con `metadata.discover.params` = lo que va a TMDB Discover, y `formState` = espejo para
el Catalog Builder web). Los `pablo0NN` son catálogos custom (países, Próximos Estrenos, En Cartelera).

- **Búsqueda por actor**: usar el catálogo dedicado `people_search.people_search_movie/series` (no
  el agregador `search.movie`, que devuelve documentales SOBRE el actor en vez de su filmografía).
  Requiere `search.engineEnabled.people_search_movie/series = true`.
- **`hideUnreleasedDigital` debe ser `false`** para que "Próximos Estrenos"/"En Cartelera" devuelvan
  resultados (con `true` AIOMetadata oculta todo lo no estrenado, sin override por catálogo). Costo:
  catálogos como Trending mezclan algún título aún no disponible.
- **Caveat de fechas**: "Próximos Estrenos"/"En Cartelera" usan fechas absolutas
  (`primary_release_date.gte/lte`) fijadas al generar el JSON. TMDB Discover no soporta fechas
  relativas → se degradan con los meses. Refrescar = regenerar con la fecha actual.
- **Trakt/Simkl**: los tokens OAuth viven server-side y NO aparecen en `config.apiKeys`. Hallazgo
  2026-06-19: parecen compartidos a nivel cuenta de ElfHosted (leer `/api/config?id=<cualquier-uuid>`
  devuelve los tokens reales). Al regenerar la instancia conviene **pasar `trakt`/`simkl` en el
  payload del save** (top-level, `config.trakt/simkl` y `config.apiKeys.trakt/simkl`); el swap del
  2026-06-19 (añadir "En Cartelera") se hizo así y la instancia nueva mostró los tokens. **Confirmar
  igual en la app** (que el watch-tracking siga andando) tras cualquier regeneración; si falla,
  restaurar la colección (los UUID viejos persisten en el server → reversible).

### SubSense — reglas críticas

Token con formato `{userId}-{configString}`:
- `userId` debe ser **exactamente 8 caracteres**. Con más, el servidor devuelve solo inglés.
- `configString` = `encodeURIComponent(JSON.stringify({languages:["es"],maxSubtitles:20}))`
- Idioma: `"es"` (NO `"spa"`, `"es-AR"`, `"es-419"` — esos devuelven inglés).
- Regenerar: `https://subsense.nepiraw.com` → Spanish → copiar la URL del manifest. O usar
  `scripts/fix-subtitles.mjs <email> <password> <subsense-manifest-url>`.

### Backup y restauración de addons

Backups en `.backups/` (gitignorado). Para restaurar una cuenta:

```powershell
$raw = Get-Content .backups\backup-NAME.json -Raw | ConvertFrom-Json
$addons = if ($raw.result.addons) { $raw.result.addons }
          elseif ($raw.addons) { $raw.addons }
          else { $raw }
$authKey = "..."   # obtener via login
Invoke-RestMethod -Uri "https://api.strem.io/api/addonCollectionSet" -Method POST `
  -ContentType "application/json" `
  -Body (@{type="AddonCollectionSet";authKey=$authKey;addons=$addons} | ConvertTo-Json -Depth 20)
```

### Addons que pueden caerse

| Addon                    | Tipo     | Alternativa si cae                    |
|--------------------------|----------|---------------------------------------|
| OpenSubtitlesPRO         | subs     | Removido; usar OpenSubtitles v3       |
| Community Subtitles      | subs     | Removido; usar SubSense / GTSubs      |
| Subsense con userId >8ch | subs     | Regenerar con userId de 8 chars       |
| WebStreamr (0–3 streams) | streams  | Normal: es HTTP, aporta poco; no está roto |

### Wild Cards (Vanessa Morgan, CBC) — mitigado

Episodios S01E07+ tienen pocas seeds en Torrentio (2–8) por ser producción canadiense con baja
distribución. **Comet lo resuelve** (20–26 streams/episodio medidos el 2026-06-19). No es problema
de configuración.

## Reglas del repo

- Commits en formato conventional, mensajes en español, cuerpo con líneas ≤ 100 caracteres.
- `data/preset.json` es la fuente de verdad de los catálogos: no perderlo.
- Pendiente (requiere a Pablo presente): recomendaciones por gustos vía **AIOLists** (login manual
  a Trakt/MDBList).
