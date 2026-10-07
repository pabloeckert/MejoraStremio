/**
 * cinemeta.ts — Cliente para consultas de metadatos de Cinemeta.
 */

export const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

// deno-lint-ignore no-explicit-any
export async function fetchCinemetaMeta(type: string, rawId: string): Promise<any | null> {
  try {
    const url = `${CINEMETA_BASE}/meta/${type}/${rawId}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta ?? null;
  } catch {
    return null;
  }
}
