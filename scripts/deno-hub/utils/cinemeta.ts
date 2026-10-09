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

/**
 * Ordena colecciones de metadatos de Stremio cronológicamente desde la fecha
 * de estreno más reciente hacia la más antigua (year_desc / released / premiere_date).
 */
export function sortMetasChronologicalDesc<T extends Record<string, unknown>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const dateA = String(a._d ?? a.released ?? a.first_air_date ?? a.release_date ??
      (a.releaseInfo ? String(a.releaseInfo) : a.year ? String(a.year) : ""));
    const dateB = String(b._d ?? b.released ?? b.first_air_date ?? b.release_date ??
      (b.releaseInfo ? String(b.releaseInfo) : b.year ? String(b.year) : ""));
    return dateB.localeCompare(dateA);
  });
}

/**
 * Consulta catálogos de Cinemeta garantizando orden cronológico estricto de
 * lanzamiento (sort=released / sort=premiere_date / sort=year_desc).
 */
export async function fetchCinemetaCatalogSorted(
  type: "movie" | "series",
  catalogId = "top",
  extra?: string,
): Promise<{ metas: Record<string, unknown>[] }> {
  try {
    const extraPath = extra ? `/${extra}` : "";
    const url = `${CINEMETA_BASE}/catalog/${type}/${catalogId}${extraPath}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { metas: [] };
    const d = await r.json();
    const rawMetas = (d?.metas || []) as Record<string, unknown>[];
    const metas = sortMetasChronologicalDesc(rawMetas);
    return { metas };
  } catch {
    return { metas: [] };
  }
}

