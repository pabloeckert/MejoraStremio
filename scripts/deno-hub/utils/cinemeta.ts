/**
 * cinemeta.ts — Cliente para consultas de metadatos de Cinemeta.
 */

export const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

export function canonicalImdbId(rawId: string): string {
  if (rawId === "tt13854128" || rawId === "tt13000282") return "tt14060708";
  if (rawId === "tt3488720") return "tt3488710"; // Alias: "The Walk" / "En la cuerda floja" (2015)
  return rawId;
}

// deno-lint-ignore no-explicit-any
export async function fetchCinemetaMeta(type: string, rawId: string): Promise<any | null> {
  try {
    const id = canonicalImdbId(rawId);
    const url = `${CINEMETA_BASE}/meta/${type}/${id}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.meta ?? null;
  } catch {
    return null;
  }
}
