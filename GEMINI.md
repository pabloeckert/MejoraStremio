# GEMINI.md — Arquitectura y Gobernanza Técnica de MejoraStremio

Guía de referencia y gobernanza técnica para **Google Antigravity / Gemini** en el repositorio **MejoraStremio**.
Este documento constituye la fuente de verdad unificada sobre la arquitectura de addons, catálogos, sincronización cloud y perfiles de cuenta.

---

## 1. Naturaleza y Propósito del Repositorio

**MejoraStremio** es una caja de herramientas automatizada para la gestión, curaduría y mantenimiento de perfiles de Stremio operada por terminal y mediante flujos serverless (GitHub Actions y Deno Deploy) contra las APIs de Stremio, TorBox, OpenSubtitles y catálogos de metadatos (AIOMetadata / TMDB).

### Cuentas Gestionadas:
- **`stremioeg@gmail.com`** (Principal / TV Box / Pablo): Documentada formalmente en `cuentas/stremioeg/GEMINI.md` y `cuentas/stremioeg/profile.json`. Configurada con subtítulos estrictos sin SDH, prioridad audio latino/original y orden cronológico de estrenos.
- **`stremiojn@gmail.com`** ("Joaquín"): Curaduría de catálogos y perfiles independientes.
- **`solotveg@gmail.com`**: Perfil juvenil/adolescente (hasta 17 años) con filtros estrictos de clasificación.

---

## 2. Arquitectura de Datos y Catálogos

- `data/preset.json`: Fuente de verdad de la configuración de catálogos de AIOMetadata. Reconstruye la configuración de instancias de metadata.
- `data/test-content.json`: Lista curada de títulos de prueba con IDs de IMDb para testing automatizado de streams.
- `data/anti-frustration-log.json`: Registro de títulos con baja disponibilidad o problemas de cobertura para seguimiento preventivo.
- `data/premiere-radar-state.json`: Estado del radar de estrenos y sincronización de nuevos episodios.
- `data/iptv-channels.json`: Mapeo y estado de listas de canales IPTV en vivo.

---

## 3. Reglas Técnicas y Patrones Críticos

### 3.1 Guard Anti-Manifest-Congelado (`collection-guard.mjs`)
- **Problema de raíz**: Históricamente, ciertos add-ons perdían la propiedad `catalogs` (`catalogs: []` indiscriminado) durante actualizaciones o escrituras concurrentes, rompiendo la interfaz de Stremio.
- **Regla estricta**: Todo script de reordenamiento o actualización (`reorder-addons.mjs`, `install-addon.mjs`, `update-addon-url.mjs`, `repair-frozen-catalogs.mjs`) debe validar contra `collection-guard.mjs` que ningún add-on pierda sus catálogos antes de confirmar cambios en la API.

### 3.2 Sort "Friction-Zero" y TorBox Debrid
- En cuentas con debrid activo (TorBox), los streams cacheados en debrid tienen prioridad absoluta para garantizar reproducción instantánea sin esperas de descarga P2P ni throttling por CGNAT.
- `apply-friction-zero-sort.mjs` orquesta la jerarquía de scrapers (Torrentio + TorBox, Comet + TorBox) sobre HTTP y P2P nativo.

### 3.3 Subtítulos y Preferencias Regionales
- Se prioriza **Español Latinoamericano (`ea`, `es-419`)** sin marcas de accesibilidad auditiva (`hearing_impaired=false`).
- Se descartan marcas SDH / CC en OpenSubtitles y SubDL.
- Español de España / Peninsular (`sp`, `es-ES`) opera estrictamente como último recurso de fallback.

### 3.4 Sincronización Diaria y Ventanas Deslizantes
- El flujo `daily-catalog-refresh.yml` corre a las 07:00 ART (10:00 UTC) ejecutando `refresh-dates.mjs` y `regenerate-aiometadata.mjs`.
- Mantiene dinámicas las ventanas de "En Cartelera" (`now_playing`) y "Próximos Estrenos" (`upcoming`) con la fecha del día actual.

---

## 4. Infraestructura Cloud-Only y Monitoreo

- **Deno Deploy (`mejorastremio-hub`)**: Microservicios HTTP en TypeScript (`scripts/deno-hub.ts`) para filtrado de subtítulos y proxy de metadatos.
- **GitHub Actions Workflows**:
  - `health-monitor.yml`: Monitoreo bicotidiano del estado de add-ons y endpoints.
  - `keep-warm.yml`: Mantiene activos los workers serverless cada 20 minutos.
  - `premiere-radar.yml`, `community-radar.yml`, `torbox-airlock.yml`, `iptv-refresh.yml`: Automatizaciones periódicas de curaduría.
