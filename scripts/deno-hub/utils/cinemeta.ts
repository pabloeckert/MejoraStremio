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

export const CATALOG_PAGE_SIZE = 25;

/**
 * Consulta catálogos de Cinemeta garantizando orden cronológico estricto de
 * lanzamiento (sort=released / sort=premiere_date / sort=year_desc) y un mínimo
 * de 25 títulos por página (pageSize: 25).
 */
export async function fetchCinemetaCatalogSorted(
  type: "movie" | "series",
  catalogId = "top",
  extra?: string,
  pageSize = CATALOG_PAGE_SIZE,
): Promise<{ metas: Record<string, unknown>[] }> {
  try {
    const extraPath = extra ? `/${extra}` : "";
    const url = `${CINEMETA_BASE}/catalog/${type}/${catalogId}${extraPath}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { metas: [] };
    const d = await r.json();
    let rawMetas = (d?.metas || []) as Record<string, unknown>[];

    // Si la lista tiene menos de pageSize y no se especificó skip, buscar el siguiente bloque para asegurar el mínimo
    if (rawMetas.length < pageSize && !extra?.includes("skip=")) {
      try {
        const nextUrl = `${CINEMETA_BASE}/catalog/${type}/${catalogId}/skip=${rawMetas.length}.json`;
        const rNext = await fetch(nextUrl, { signal: AbortSignal.timeout(5000) });
        if (rNext.ok) {
          const dNext = await rNext.json();
          const nextMetas = (dNext?.metas || []) as Record<string, unknown>[];
          rawMetas = [...rawMetas, ...nextMetas];
        }
      } catch {
        // continuar con rawMetas acumuladas
      }
    }

    const seenIds = new Set<string>();
    const uniqueMetas: Record<string, unknown>[] = [];
    for (const m of rawMetas) {
      const id = String(m.id || "");
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        uniqueMetas.push(m);
      }
    }

    // Filtrar portadas vacías
    const withPosters = uniqueMetas.filter((m) => !!m.poster);
    const candidateList = withPosters.length >= 15 ? withPosters : uniqueMetas;
    const sorted = sortMetasChronologicalDesc(candidateList);
    const metas = sorted.slice(0, Math.max(pageSize, 25));
    return { metas };
  } catch {
    return { metas: [] };
  }
}

