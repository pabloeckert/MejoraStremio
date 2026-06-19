![logo](public/logo.png)

# MejoraStremio

Fork personalizado de [DryKillLogic/stremio-account-bootstrapper](https://github.com/DryKillLogic/stremio-account-bootstrapper).
SPA en Vue 3 + TypeScript + Vite + Tailwind/daisyUI que configura una cuenta de Stremio con
un único preset (`pablo-free`) mediante un wizard de 3 pasos, 100% en español.

Sitio publicado: https://pabloeckert.github.io/MejoraStremio/ (deploy automático a GitHub
Pages en cada push a `main`).

**⚠️ El wizard sobreescribe la colección de addons de la cuenta. Hacé un backup desde la
sección "Copia de seguridad" antes de instalar.**

## Qué instala

- **AIOMetadata** — metadata profunda (TMDB/TVDB/Fanart) + catálogos de Cine/Series
  Argentina y Latinoamérica.
- **AIOStreams** — streams P2P gratuitos (Comet, StremThru Torz, MediaFusion, Torrentio).
- **Streaming Catalogs** — catálogos de Netflix, HBO Max, Disney+, Prime Video, etc.
- **SubSense** — subtítulos en español, configurado con la URL que pega el usuario.

Ver [CLAUDE.md](./CLAUDE.md) para el detalle de arquitectura, comandos de desarrollo y
procedimientos de mantenimiento.

## Desarrollo

```sh
pnpm install        # requiere pnpm 11+
pnpm run dev         # localhost:5173
pnpm run build       # type-check + bundle
pnpm run preview     # sirve dist/ en localhost:4173
pnpm run format      # formatea con Prettier
```

Scripts de verificación en `scripts/`: `health-check.mjs` (chequeo rápido de manifests/subs/
streams), `smoke-test.mjs` (Playwright contra el wizard) y `e2e-install.mjs` (instalación real
contra una cuenta de Stremio).

## Changelog

Ver [CHANGELOG.md](./CHANGELOG.md).

## Créditos

Basado en el trabajo original de pancake3000 y el fork de redd-ravenn, con la colaboración de
Sleeyax y &#60;Code/&#62;.
