# CLAUDE.md — Cuenta principal: stremioeg (Pablo)

Documentación del perfil formal de la cuenta principal de Stremio: `stremioeg@gmail.com`.
Este archivo detalla la política estricta de reproducción y experiencia de visualización para la **TV Box**, complementando el `CLAUDE.md` raíz del repositorio.

Credenciales: `ST_EMAIL` / `ST_PASS` (en secrets de GitHub Actions y en variables locales de entorno; nunca commitear contraseñas en texto plano).

---

## Directivas Estrictas del Perfil TV Box

La cuenta de Pablo en su TV Box (Android TV / Leanback) está configurada bajo tres reglas estrictas e innegociables:

### 1. Subtítulos en Español Latino / Español SIN SDH

* **Regla estricta**: Cero subtítulos para personas con discapacidad auditiva (SDH / CC / Hearing Impaired). Quedan descartadas etiquetas `[SDH]`, `(SDH)`, `[CC]`, `(CC)` o flags `hi=true` (subdl/opensubtitles).
* **Prioridad de idioma**:
  1. **Español Latinoamericano** (`ea` en OpenSubtitles REST moderna, `es-419` / `latino`).
  2. **Español neutro / estándar** (`es` limpio, sin SDH).
  3. **Español España / Castellano** (`sp` / `castellano`) únicamente como último recurso si no existiera ninguna otra opción.
* **Stack de Add-ons de Subtítulos provisto por `mejorastremio-hub`**:
  - `com.mejorastremio.opensubtitles-latino`: API moderna filtrando `hearing_impaired=false` y `languages=ea`.
  - `com.mejorastremio.subdl`: API de SubDL con filtro nativo de `hi=false`.
  - `com.mejorastremio.opensubtitles`: OpenSubtitles general con filtro de `hearing_impaired=false`.
  - Fallbacks comunitarios secundarios: SubSense, SubMaker ElfHosted.

### 2. Audio Original y Doblado Latino Prioritarios

* **Regla estricta**: Al seleccionar o reproducir contenido, el audio original en inglés/idioma de origen y el doblaje al Español Latino tienen prioridad absoluta.
* **Español España / Castellano**: Relegado a la última instancia posible. No debe anteponerse nunca a una versión con audio latino o con audio original subtitulado.
* **Configuración en add-ons de streams**:
  - **Torrentio**: Configurado con segmento `language=latino` en su `transportUrl`. Esto prioriza streams con audio latino en el scraper y ordenamiento.
  - **Comet**: Configurado con `languages.preferred: ["la", "en"]` (latino primero, original en segundo lugar) y `sortCachedUncachedTogether: false` (streams cacheados en TorBox siempre primero).
  - **Jerarquía de fiabilidad de streams**:
    1. TorBox-backed primero: Torrentio (`com.stremio.torrentio.addon`), Comet (`stremio.comet.fast`).
    2. Scrapers HTTP (sin depender de debrid ni P2P propio): NoTorrent, WebStreamrMBG, Nuvio Streams.
    3. P2P puro: Meteor (último recurso).

### 3. Sincronización Diaria de Catálogos de Estrenos

* **Sincronización automática**: Gestionada por el workflow `.github/workflows/daily-catalog-refresh.yml` a las **07:00 ART (10:00 UTC)** todos los días.
* **Ventanas de fecha**:
  - *En Cartelera* (`now_playing` cine): ventana deslizante `[hoy - span, hoy]`.
  - *Próximos Estrenos* (`upcoming` cine y series): `primary_release_date.gte = hoy`.
* **Ley de orden de estreno**: Orden cronológico descendente en catálogos de novedades para que los estrenos reales aparezcan primero en la pantalla principal de la TV Box.
* **Auditoría de orden**: Respaldada por `scripts/audit-catalog-order.mjs` y `scripts/refresh-dates.mjs`.

---

## Herramientas y Mantenimiento

* **Script de aplicación y auditoría**:
  ```bash
  # Modo auditoría / dry-run (sin tocar la cuenta):
  node scripts/apply-stremioeg-profile.mjs --check

  # Aplicar cambios en la cuenta Stremio con backup y guard anti-congelado:
  ST_EMAIL=stremioeg@gmail.com ST_PASS=... node scripts/apply-stremioeg-profile.mjs --apply
  ```
* **Especificación formal**: [`cuentas/stremioeg/profile.json`](file:///c:/Personales/MejoraStremio/cuentas/stremioeg/profile.json).
