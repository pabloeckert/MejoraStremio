/**
 * swr_cache.ts — Estrategia SWR (Stale-While-Revalidate) y Segmentación de Cachés en Deno KV.
 * MejoraStremio v1.4.2 (Bloque 4: P5).
 *
 * Funcionalidad:
 * 1. Segmentación de TTL por Tipo (Catálogos 24-48h, Streams 15min fresco + 5min stale).
 * 2. Control de Thundering Herd con candado atómico en ["swr", "lock", ...key].
 * 3. Verificación obligatoria en tiempo real para streams [⚡ INSTANTÁNEO] antes de servir stale.
 * 4. Alcance: Android TV ZTE ZXV10 B866V2.
 */

import { getKv, type StremioStreamItem } from "./common.ts";

export const TTL_SEGMENTS = {
  // Catálogos y Metadatos (TMDB/Cinemeta): 24h a 48h
  CATALOG_METADATA: {
    freshMs: 24 * 60 * 60 * 1000,    // 24 horas ventana fresca
    staleMs: 24 * 60 * 60 * 1000,    // 24 horas ventana stale adicional
    totalTtlMs: 48 * 60 * 60 * 1000, // 48 horas TTL total en Deno KV
  },
  // Streams de Scrapers: 15 min fresco + 5 min ventana stale
  SCRAPER_STREAMS: {
    freshMs: 15 * 60 * 1000,         // 15 minutos fresco
    staleMs: 5 * 60 * 1000,          // 5 minutos ventana stale adicional
    totalTtlMs: 20 * 60 * 1000,      // 20 minutos TTL total en Deno KV
  },
  // Subtítulos
  SUBTITLES: {
    freshMs: 15 * 60 * 1000,         // 15 minutos fresco
    staleMs: 5 * 60 * 1000,          // 5 minutos ventana stale adicional
    totalTtlMs: 20 * 60 * 1000,      // 20 minutos TTL total en Deno KV
  },
} as const;

export type TorboxCacheChecker = (hashes: string[]) => Promise<Set<string>>;

export interface SwrOptions<T> {
  ttlMs?: number;
  staleMs?: number;
  type?: "catalog" | "streams" | "subtitles" | "general";
  isStreamsData?: boolean;
  torboxChecker?: TorboxCacheChecker;
}

/**
 * Consulta la API de TorBox para verificar si un conjunto de infoHashes sigue en caché.
 */
export async function queryTorboxApiCheckCached(hashes: string[], timeoutMs = 2500): Promise<Set<string>> {
  const cached = new Set<string>();
  if (!hashes.length) return cached;

  const apiKey =
    (typeof Deno !== "undefined" && Deno.env?.get?.("TORBOX_API_KEY")) ||
    (typeof process !== "undefined" && process.env?.TORBOX_API_KEY);

  if (!apiKey) {
    return cached;
  }

  try {
    const list = hashes.map((h) => h.toLowerCase()).join(",");
    const url = `https://api.torbox.app/v1/api/torrents/checkcached?hash=${list}&format=object`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return cached;
    const body = await res.json();
    if (body?.success && body?.data) {
      for (const [h, val] of Object.entries(body.data)) {
        if (val) cached.add(h.toLowerCase());
      }
    }
  } catch {
    // Si falla la red de TorBox, retorna conjunto vacío (degradación segura)
  }
  return cached;
}

/**
 * Re-verifica en tiempo real si los streams [⚡ INSTANTÁNEO] siguen realmente cacheados
 * en TorBox antes de servirlos desde una respuesta stale.
 * Si un stream instantáneo ya no está en caché de debrid, se degrada a [⏳ REQUIERE BUFFER]
 * para no engañar al usuario ni bloquear el reproductor en Android TV.
 */
export async function verifyTorboxInstantStreams<T extends StremioStreamItem>(
  streams: T[],
  cacheChecker?: TorboxCacheChecker,
): Promise<T[]> {
  if (!Array.isArray(streams) || streams.length === 0) return streams;

  // Filtrar streams que tienen badge instantáneo
  const instantStreams = streams.filter((s) => {
    const text = `${s.name || ""} ${s.title || ""} ${s.description || ""}`;
    return text.includes("⚡") || text.includes("INSTANTÁNEO") || text.includes("[TB+]");
  });

  if (instantStreams.length === 0) {
    return streams;
  }

  // Extraer hashes
  const hashToStreams = new Map<string, T[]>();
  for (const s of instantStreams) {
    let hash = (s.infoHash || "").toLowerCase();
    if (!hash && s.url) {
      const match = s.url.match(/([a-fA-F0-9]{40})/);
      if (match) hash = match[1].toLowerCase();
    }
    if (hash) {
      if (!hashToStreams.has(hash)) hashToStreams.set(hash, []);
      hashToStreams.get(hash)!.push(s);
    }
  }

  const hashesToCheck = Array.from(hashToStreams.keys());
  let verifiedHashes = new Set<string>();

  if (hashesToCheck.length > 0) {
    if (cacheChecker) {
      try {
        verifiedHashes = await cacheChecker(hashesToCheck);
      } catch {
        verifiedHashes = new Set<string>();
      }
    } else {
      verifiedHashes = await queryTorboxApiCheckCached(hashesToCheck);
    }
  }

  // Re-evaluar cada stream instantáneo: si su hash no está en verifiedHashes, degradar
  return streams.map((s) => {
    let hash = (s.infoHash || "").toLowerCase();
    if (!hash && s.url) {
      const match = s.url.match(/([a-fA-F0-9]{40})/);
      if (match) hash = match[1].toLowerCase();
    }
    const isInstant = (s.name || "").includes("⚡") || (s.name || "").includes("INSTANTÁNEO");
    if (isInstant && (!hash || !verifiedHashes.has(hash))) {
      const updatedName = (s.name || "")
        .replace(/\[⚡\s*INSTANTÁNEO\]/g, "[⏳ REQUIERE BUFFER]")
        .replace(/⚡/g, "⏳")
        .replace(/\[TB\+\]/g, "[TB download]");
      return {
        ...s,
        name: updatedName,
      };
    }
    return s;
  });
}

/**
 * Estrategia SWR (Stale-While-Revalidate) de Alto Rendimiento para Deno KV:
 * 1. Entrega inmediata si está fresco (age <= freshMs).
 * 2. Si está stale (freshMs < age <= totalTtlMs):
 *    - Adquiere candado atómico ["swr", "lock", ...key] para deduplicar la revalidación.
 *    - Solo 1 worker ejecuta el fetcher en background; las demás peticiones reciben stale de inmediato (cero thundering herd).
 *    - Si los datos contienen streams instantáneos, re-verifica obligatoriamente el cache de TorBox en tiempo real.
 * 3. Si expiró totalmente (> totalTtlMs) o es miss, ejecuta fetcher y puebla la caché.
 */
export async function getOrSetSwrCache<T>(
  cacheKey: (string | number)[],
  fetcher: () => Promise<T>,
  optionsOrTtl?: SwrOptions<T> | number,
  legacyStaleMs?: number,
): Promise<T> {
  let opts: SwrOptions<T> = {};
  if (typeof optionsOrTtl === "number") {
    opts = {
      ttlMs: optionsOrTtl,
      staleMs: legacyStaleMs ?? Math.floor(optionsOrTtl / 3),
    };
  } else if (optionsOrTtl) {
    opts = optionsOrTtl;
  }

  const freshMs = opts.ttlMs ?? TTL_SEGMENTS.SCRAPER_STREAMS.freshMs;
  const staleMs = opts.staleMs ?? TTL_SEGMENTS.SCRAPER_STREAMS.staleMs;
  const totalTtlMs = freshMs + staleMs;
  const isStreamsData = opts.isStreamsData ?? (opts.type === "streams" || String(cacheKey[0]).includes("stream"));

  if (typeof Deno === "undefined" || typeof Deno.openKv !== "function") {
    return await fetcher();
  }

  try {
    const kv = await getKv();
    const entry = await kv.get<{ data: T; timestamp: number }>(cacheKey);
    const now = Date.now();

    if (entry.value) {
      const age = now - entry.value.timestamp;

      // 1. CASO FRESCO: edad <= freshMs -> Entrega inmediata
      if (age <= freshMs) {
        return entry.value.data;
      }

      // 2. CASO STALE: edad > freshMs y age <= totalTtlMs -> Deduplicación con candado atómico
      if (age <= totalTtlMs) {
        const lockKey = ["swr", "lock", ...cacheKey];
        const lockRes = await kv.atomic()
          .check({ key: lockKey, versionstamp: null })
          .set(lockKey, now, { expireIn: 30000 })
          .commit();

        if (lockRes.ok) {
          // Revalidación única en segundo plano
          (async () => {
            try {
              const fresh = await fetcher();
              await kv.set(cacheKey, { data: fresh, timestamp: Date.now() }, { expireIn: totalTtlMs });
            } catch (err) {
              console.error(`[swr] Error en revalidación background para ${cacheKey.join("/")}: ${(err as Error).message}`);
            } finally {
              try {
                await kv.delete(lockKey);
              } catch {
                /* ignore */
              }
            }
          })();
        }

        // VERIFICACIÓN OBLIGATORIA PARA STREAMS INSTANTÁNEOS EN RESPUESTA STALE:
        if (isStreamsData && Array.isArray(entry.value.data)) {
          const verifiedStreams = await verifyTorboxInstantStreams(
            entry.value.data as unknown as StremioStreamItem[],
            opts.torboxChecker,
          );
          return verifiedStreams as unknown as T;
        }

        return entry.value.data;
      }
    }

    // 3. CACHE MISS O EXPIRADO TOTAL
    const fresh = await fetcher();
    await kv.set(cacheKey, { data: fresh, timestamp: now }, { expireIn: totalTtlMs });
    return fresh;
  } catch {
    return await fetcher();
  }
}
