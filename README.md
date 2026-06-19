# MejoraStremio

Caja de herramientas personal para mantener una cuenta de [Stremio](https://www.stremio.com/)
con un setup gratuito (metadata profunda, catálogos latinos y de plataformas, streams P2P y
subtítulos en español). **No es una app web** — se opera por terminal, hablando con las APIs de
Stremio y de los addons directamente.

> Empezó como un fork de la SPA
> [DryKillLogic/stremio-account-bootstrapper](https://github.com/DryKillLogic/stremio-account-bootstrapper)
> (un wizard web que instalaba un preset). Ese wizard se eliminó: el setup se gestiona ahora con
> los scripts de este repo. El historial de git conserva la versión SPA si hiciera falta.

## Contenido

```
data/preset.json          Definición de los catálogos de AIOMetadata (fuente de datos /
                          referencia para reconstruir la config si hace falta).
scripts/health-check.mjs  Auditoría del estado de la cuenta y los addons.
scripts/fix-subtitles.*   Regenera la config de SubSense (subtítulos en español) en la cuenta.
CLAUDE.md                 Guía de mantenimiento: reglas de SubSense, catálogos de AIOMetadata,
                          backup/restore, problemas conocidos.
```

Los scripts corren con Node ≥ 20 (usan `fetch`/`https` nativos, sin dependencias). No hay
`package.json` ni build: es un toolkit, no un paquete.

## Uso

```sh
# Auditoría completa (login + addons + catálogos + búsqueda + streams + subtítulos)
ST_EMAIL=tu@email ST_PASS=tu_pass node scripts/health-check.mjs

# Sin credenciales: solo verifica manifests públicos
node scripts/health-check.mjs

# Regenerar SubSense en una cuenta
node scripts/fix-subtitles.mjs <email> <password> <subsense-manifest-url>
```

Los backups de colecciones de addons van a `.backups/` (gitignorado). Ver **CLAUDE.md** para el
procedimiento de backup/restauración y las reglas críticas del setup.
