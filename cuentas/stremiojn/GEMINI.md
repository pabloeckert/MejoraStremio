# GEMINI.md — Arquitectura y Gobernanza: Perfil stremiojn (Joaquín)

Guía de referencia y especificación técnica para la cuenta secundaria **`stremiojn@gmail.com`** ("Joaquín") en el ecosistema **MejoraStremio**.

---

## 1. Propósito y Perfil de Usuario

El perfil **stremiojn** está diseñado para un consumo de entretenimiento enfocado en adrenalina, combate y ritmo cinemático continuo sobre hardware Android TV (TV Box Leanback UI).

- **Usuario**: Joaquín.
- **Dispositivo Principal**: Android TV / TV Box (ZTE ZXV10 B866V2, Amlogic S905X2, 2GB RAM, UI Leanback).
- **Enfoque Temático**:
  - **Deportes de Combate**: UFC (Ultimate Fighting Championship), MMA (Bellator, ONE Championship, PFL), Boxeo profesional (campeonatos mundiales, veladas estelares).
  - **Cine de Acción**: Blockbusters de acción, artes marciales, persecuciones y espionaje.
  - **Suspense y Policial**: Thrillers de alta tensión, drama policial, misterio procedimental y cine criminal contemporáneo.
- **Exclusión Estricta (Filtro Zero-Tolerance)**:
  - **Infantil / Preescolar**: Purgado total de dibujos animados infantiles, animaciones para niños pequeños y contenido preescolar.
  - **Melodrama / Telenovelas**: Exclusión completa de telenovelas, culebrones y dramas románticos lacrimógenos.

---

## 2. Topología Canónica v2.1 (Monopolio de 2 Addons)

Siguiendo el estándar unificado de infraestructura como código v2.1, esta cuenta implementa la política de **monopolio de exactamente 2 addons** en la colección remota de Stremio:

| Posición | ID del Addon | Nombre | Rol Arquitectural |
| :---: | :--- | :--- | :--- |
| **#0** | `com.mejorastremio.hub` | **MejoraStremio Hub** | Router unificado en Edge (Deno Deploy). Despliega streams cacheados en TorBox Debrid, interceptor inteligente de audio latino, filtrado de subtítulos sin SDH y traducción IA con caché global compartida (Deno KV). |
| **#1** | `com.linvo.cinemeta` | **Cinemeta** | Proveedor de metadatos oficial canónico de Stremio. |

> [!IMPORTANT]
> Todo addon secundario, scraper P2P sin debrid o proveedor externo de subtítulos competidor queda formalmente **prohibido y desinstalado** por los scripts de purga (`purge-and-unify-account.mjs`). Cualquier adición manual no autorizada es tratada como una **deriva de configuración (drift)** por el monitor de salud (`health-check.mjs`).

---

## 3. Gobernanza Leanback UX (TV Box)

Para garantizar 60 FPS fluidos y prevenir agotamiento de memoria (OOM) en el hardware con 2GB de RAM:

1. **Tope de Filas en Inicio (`maxHomeRows: 20`)**:
   - La pantalla de inicio no debe exceder bajo ninguna circunstancia 20 filas activas simultáneas.
   - Todo catálogo secundario o complementario permanece disponible en la sección *Descubrir*, pero con `showInHome: false`.
2. **Blindaje Anti-Portadas Vacías (`minVoteCountHome: 3`)**:
   - Cada fila de TMDB Discover debe requerir `vote_count.gte >= 3` para asegurar metadatos y pósters gráficos en alta resolución.
3. **Orden Dinámico por Fecha Reciente (`orderLaw: "release_date_desc"`)**:
   - Prohibidas listas de popularidad estáticas o congeladas en el tiempo (`sort_by: popularity.desc` sin ventana temporal).
   - Se priorizan fechas de estreno decrecientes (`primary_release_date.desc`) y carteleras sincronizadas al día.

---

## 4. Prioridad Innegociable de Audio y Subtítulos

- **Puesto #1 de Audio**:
  - Regla absoluta: Todo stream cacheado en TorBox con audio latino se clasifica en el puesto número 1 con el badge semántico visual `[⚡ INSTANTÁNEO] [🌎 LATINO]`.
  - Jerarquía: `1. latino` ➔ `2. original (eng)` ➔ Último recurso: `castellano (-80 puntos)`.
- **Subtítulos sin SDH**:
  - Modo `strict_no_sdh` activo.
  - Purgado de tags auditivos `[SDH]`, `(CC)`, `hi=true`, etc.
  - Subtítulos duales: Emisión sincronizada de etiquetas en `spl` (Español Latinoamericano) y `spa` (Español neutro).
- **Caché Global de IA Compartida**:
  - Acceso directo al almacén central en Deno KV. Subtítulos generados por traducción generativa Gemini Flash en cualquier perfil del hogar quedan instantáneamente disponibles para `stremiojn`.

---

## 5. Gestión Zero-Trust de Secretos e Integración CI/CD

Las operaciones automatizadas contra la API de Stremio para esta cuenta se ejecutan bajo estricto principio Zero-Trust:

- **Variables de Entorno**:
  - Email: `ST_EMAIL_JN` (fallback: `STREMIO_EMAIL_JN`).
  - Contraseña: `ST_PASS_JN` (fallback: `STREMIO_PASS_JN`).
- **Scripts Orquestadores**:
  - `apply-stremioeg-profile.mjs --account=stremiojn`: Aplica y audita la configuración contra el perfil `cuentas/stremiojn/profile.json`.
  - `purge-and-unify-account.mjs --account=stremiojn`: Ejecuta la purga atómica garantizando el monopolio de 2 addons.
  - `health-check.mjs --account=stremiojn`: Monitorea la salud del perfil y alerta ante cualquier deriva topológica.
  - `test-multi-account-p9.ts`: Suite E2E de certificación multi-perfil.
- **Prohibición**: Queda terminantemente prohibido quemar contraseñas o tokens en archivos del repositorio.
