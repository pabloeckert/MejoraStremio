/**
 * stremio-api.mjs — Helper compartido de login + POST a la API de Stremio (api.strem.io/api).
 *
 * Antes vivía copiado literalmente en 21 scripts de scripts/ (ver REPORTE_AUDITORIA.md,
 * hallazgo de severidad media, 2026-09-10) en vez de extraerse a scripts/lib/ como ya se
 * hizo con addon-signals.mjs y collection-guard.mjs. Se extrae acá para que cualquier
 * script futuro lo reuse en vez de reimplementarlo.
 */

export const STREMIO_API = 'https://api.strem.io/api';

export const apiPost = (path, body, { timeout = 25000 } = {}) =>
  fetch(`${STREMIO_API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  }).then((r) => r.json());

export async function stremioLogin(email, password, opts) {
  const login = await apiPost('login', { authKey: null, email, password }, opts);
  const authKey = login?.result?.authKey;
  if (!authKey) throw new Error('Login fallido: ' + JSON.stringify(login?.error || login));
  return authKey;
}
