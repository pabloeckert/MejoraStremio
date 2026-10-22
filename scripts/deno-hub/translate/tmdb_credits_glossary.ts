/**
 * tmdb_credits_glossary.ts — Extracción de Elenco/Personajes (TMDB /credits) y Glosario Determinista.
 *
 * Implementa:
 * - Extracción de nombres de personajes y elenco principal desde la API de TMDB (/credits).
 * - Generación de glosario inmutable para inyección en el prompt de Gemini Flash.
 * - Invariancia multi-lote: todos los sub-lotes de 18 cues reciben el mismo glosario inmutable.
 * - Persistencia L1 (RAM LRU) + L2 (Deno KV ["tmdb_glossary", type, tmdb_id]).
 *
 * Alcance y Target: Android TV ZTE ZXV10 B866V2 (Amlogic S905X2) — 100% Serverless.
 */

import { tmdbGet, TMDB_KEY } from "../catalogs/tmdb.ts";

export const GLOSSARY_KV_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días de persistencia

export interface EntityEntry {
  name: string;
  type: "character" | "actor" | "location";
  role?: string;
}

export interface CreditsGlossary {
  tmdb_id: number | string;
  title?: string;
  characters: string[];
  actors: string[];
  locations: string[];
  entities: EntityEntry[];
  formattedPromptDirectives: string;
}

/**
 * Filtra nombres genéricos de extras o roles no nominales.
 */
export function isGenericRole(character: string): boolean {
  if (!character || typeof character !== "string") return true;
  const lower = character.trim().toLowerCase();
  if (lower.length < 2) return true;
  if (/^(uncredited|self|voice|additional voices|background|extra|driver|waiter|nurse|doctor|officer|cop|guard|soldier|reporter|pedestrian|host|bartender|cashier|student|man|woman|boy|girl|kid|baby|various|crowd|swat|agent)\b/i.test(lower)) {
    return true;
  }
  if (/\b(?:#\d+|\b\d+\b)\b/.test(lower)) return true;
  return false;
}

/**
 * Sanitiza y extrae nombres propios de personajes.
 * Por ejemplo: "John Taylor / Detective Smith" -> ["John Taylor", "Detective Smith"]
 */
export function extractCleanCharacterNames(rawRole: string): string[] {
  if (isGenericRole(rawRole)) return [];

  // Dividir por diagonales o paréntesis de alias
  const parts = rawRole
    .replace(/\s*\([^)]*\)/g, "") // quita anotaciones entre paréntesis
    .split(/\s*[\/|]\s*|\s+as\s+/i);

  const cleanNames: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed && !isGenericRole(trimmed) && trimmed.length >= 2) {
      cleanNames.push(trimmed);
    }
  }
  return cleanNames;
}

/**
 * Obtiene el glosario de créditos de TMDB con caché en memoria y Deno KV.
 */
export async function getCreditsGlossary(
  tmdbId: number | string,
  type: "movie" | "tv" = "movie",
  titleName?: string,
  kv?: Deno.Kv | null,
): Promise<CreditsGlossary> {
  const numId = typeof tmdbId === "number" ? tmdbId : parseInt(String(tmdbId).replace(/^tt/, ""), 10);
  const kvKey: Deno.KvKey = ["tmdb_glossary", type, String(tmdbId)];

  // 1. Revisar caché en Deno KV si está disponible
  if (kv) {
    try {
      const cached = await kv.get<CreditsGlossary>(kvKey);
      if (cached?.value) {
        return cached.value;
      }
    } catch {
      /* ignore */
    }
  }

  const charactersSet = new Set<string>();
  const actorsSet = new Set<string>();
  const entities: EntityEntry[] = [];

  // 2. Consultar TMDB /credits si hay API key
  if (TMDB_KEY && !isNaN(numId) && numId > 0) {
    try {
      const endpoint = type === "movie" ? `/movie/${numId}/credits` : `/tv/${numId}/credits`;
      const data = await tmdbGet(endpoint, {});
      const cast = Array.isArray(data?.cast) ? data.cast : [];

      for (const item of cast.slice(0, 20)) {
        if (item.character) {
          const names = extractCleanCharacterNames(item.character);
          for (const name of names) {
            charactersSet.add(name);
            entities.push({ name, type: "character", role: item.character });
          }
        }
        if (item.name && typeof item.name === "string" && item.name.length >= 2) {
          actorsSet.add(item.name.trim());
          entities.push({ name: item.name.trim(), type: "actor" });
        }
      }
    } catch {
      /* fallback defensivo */
    }
  }

  // Si no se extrajeron personajes de la red, inyectar el título si existe
  if (titleName && titleName.trim().length >= 2) {
    charactersSet.add(titleName.trim());
  }

  const characters = [...charactersSet];
  const actors = [...actorsSet];
  const locations: string[] = [];

  const formattedPromptDirectives = formatGlossaryPromptSection({
    characters,
    actors,
    locations,
    titleName,
  });

  const glossary: CreditsGlossary = {
    tmdb_id: tmdbId,
    title: titleName,
    characters,
    actors,
    locations,
    entities,
    formattedPromptDirectives,
  };

  // Guardar en Deno KV
  if (kv) {
    kv.set(kvKey, glossary, { expireIn: GLOSSARY_KV_TTL_MS }).catch(() => {});
  }

  return glossary;
}

/**
 * Formatea la sección de reglas de glosario inviolable para el prompt del sistema.
 */
export function formatGlossaryPromptSection(params: {
  characters: string[];
  actors: string[];
  locations?: string[];
  titleName?: string;
}): string {
  const items: string[] = [];

  if (params.characters.length > 0) {
    for (const char of params.characters.slice(0, 15)) {
      items.push(`- [Personaje] ${char}`);
    }
  }
  if (params.actors.length > 0) {
    for (const actor of params.actors.slice(0, 10)) {
      items.push(`- [Actor] ${actor}`);
    }
  }
  if (params.locations && params.locations.length > 0) {
    for (const loc of params.locations.slice(0, 5)) {
      items.push(`- [Locación] ${loc}`);
    }
  }

  if (items.length === 0) {
    return "";
  }

  return (
    `GLOSARIO DETERMINISTA DE ENTIDADES (INVIOLABLE ENTRE TODOS LOS SUB-LOTES):\n` +
    `Los siguientes nombres de personajes, actores y locaciones deben conservarse con EXACTITUD total y literal en su grafía original:\n` +
    items.join("\n") +
    `\nBajo ninguna circunstancia traduzcas, fonetices ni alteres estos nombres en ningún sub-lote.\n\n`
  );
}
