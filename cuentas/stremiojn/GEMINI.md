# GEMINI.md — Cuenta Secundaria: stremiojn (Joaquín - Deportes / Acción)

Documentación del perfil formal de la cuenta secundaria de Stremio: `stremiojn@gmail.com`.
Este archivo detalla la política de curaduría orientada a deportes de combate (UFC, MMA, Boxeo), cine de acción y monopolio de 2 addons canónicos en la **TV Box** (Android TV Leanback).

Credenciales de entorno: `ST_EMAIL_JN` / `ST_PASS_JN` (en secrets de GitHub Actions como `STREMIO_EMAIL_JN` / `STREMIO_PASS_JN`).

---

## 1. Directivas de Gobernanza

1. **Monopolio Canónico de 2 Addons**:
   - `[0] com.mejorastremio.hub` (v1.4.2): TorBox Debrid con audio latino y subtítulos IA compartidos.
   - `[1] com.linvo.cinemeta` (v3.0.14): Metadatos oficiales de Stremio.
2. **Subtítulos y Audio**:
   - Prioridad absoluta a Español Latinoamericano (`spl` / `spa`) sin marcas auditivas SDH (`hearing_impaired=false`).
   - Relegación de doblajes peninsulares.
3. **Caché Global de IA Compartida**:
   - Acceso inmediato al caché de subtítulos IA de Deno KV generado por las demás cuentas del hogar.
