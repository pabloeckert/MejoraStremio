/**
 * kv_sub_cache.ts — Capa de Persistencia de Subtítulos Traducidos por IA en Deno KV.
 *
 * Implementa:
 * - P1: Caché de traducciones IA con claves compuestas, single-flight locks y criterio estricto.
 * - P2: Superación de límites de 64 KiB en Deno KV mediante compresión Gzip y fragmentación en chunks ≤60 KiB.
 *
 * Alcance y Compatibilidad: Android TV (ZTE ZXV10 B866V2 / Amlogic S905X2).
 */

export const SUB_CACHE_CHUNK_SIZE = 60 * 1024; // 60 KiB (Tope seguro bajo el límite de 64 KiB)
export const SUB_CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 días
export const SUB_LOCK_TTL_MS = 25 * 1000; // 25 segundos para operaciones de traducción
export const BATCH_CUE_SIZE = 18; // Sub-lotes atómicos de 18 cues

export interface SubCacheKeyParams {
  tmdb_id: string | number;
  season: number;
  episode: number;
  lang: string;
  sourceSrtHash: string;
}

export interface SmartSyncParams {
  ratio?: number;
  offsetMs?: number;
  framerate?: string;
  twoAnchor?: {
    anchor1?: { sourceMs: number; targetMs: number };
    anchor2?: { sourceMs: number; targetMs: number };
  };
  [key: string]: unknown;
}

export interface CachedSubPayload {
  srt: string;
  smartSync?: SmartSyncParams;
  allBatchesOk: boolean;
  timestamp: number;
}

export interface SubCacheManifest {
  n_chunks: number;
  bytes: number;
  sha256: string;
  timestamp: number;
  smartSync?: SmartSyncParams;
}

/**
 * Genera la clave base de almacenamiento en Deno KV:
 * ["sub", "ai", tmdb_id, season, episode, lang, hash(srt_fuente)]
 */
export function buildSubCacheBaseKey(params: SubCacheKeyParams): Deno.KvKey {
  return [
    "sub",
    "ai",
    String(params.tmdb_id),
    Number(params.season),
    Number(params.episode),
    String(params.lang).toLowerCase(),
    String(params.sourceSrtHash),
  ];
}

/**
 * Genera la clave del candado temporal single-flight:
 * ["sub", "lock", tmdb_id, season, episode, lang, hash(srt_fuente)]
 */
export function buildSubLockKey(params: SubCacheKeyParams): Deno.KvKey {
  return [
    "sub",
    "lock",
    String(params.tmdb_id),
    Number(params.season),
    Number(params.episode),
    String(params.lang).toLowerCase(),
    String(params.sourceSrtHash),
  ];
}

/**
 * Calcula el hash SHA-256 en formato hexadecimal de un string o buffer.
 */
export async function calculateSha256(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hashBuf = await crypto.subtle.digest("SHA-256", buf.buffer as ArrayBuffer);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Comprime un buffer utilizando el estándar nativo CompressionStream("gzip").
 */
export async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Descomprime un buffer Gzip utilizando DecompressionStream("gzip").
 */
export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(data as unknown as BufferSource);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Adquiere un lock temporal atómico single-flight en Deno KV para evitar llamadas dobles.
 */
export async function acquireSingleFlightLock(
  kv: Deno.Kv,
  params: SubCacheKeyParams,
  ttlMs = SUB_LOCK_TTL_MS,
): Promise<boolean> {
  const lockKey = buildSubLockKey(params);
  const res = await kv
    .atomic()
    .check({ key: lockKey, versionstamp: null })
    .set(lockKey, Date.now(), { expireIn: ttlMs })
    .commit();
  return res.ok;
}

/**
 * Libera el lock single-flight de manera inmediata.
 */
export async function releaseSingleFlightLock(
  kv: Deno.Kv,
  params: SubCacheKeyParams,
): Promise<void> {
  const lockKey = buildSubLockKey(params);
  try {
    await kv.delete(lockKey);
  } catch {
    /* ignore */
  }
}

/**
 * Almacena el subtítulo traducido en Deno KV aplicando:
 * - Criterio estricto de inclusión (allBatchesOk === true).
 * - Compresión Gzip.
 * - Fragmentación en chunks ≤60 KiB.
 * - Manifest como marcador de commit final.
 */
export async function putCachedSub(
  kv: Deno.Kv,
  params: SubCacheKeyParams,
  payload: CachedSubPayload,
  ttlMs = SUB_CACHE_TTL_MS,
): Promise<boolean> {
  // Criterio de Inclusión Estricto: solo guardar si el 100% de los sub-lotes están OK
  if (!payload.allBatchesOk || !payload.srt || payload.srt.trim().length === 0) {
    return false;
  }

  const baseKey = buildSubCacheBaseKey(params);
  const rawJson = JSON.stringify({
    srt: payload.srt,
    smartSync: payload.smartSync,
    allBatchesOk: true,
    timestamp: payload.timestamp || Date.now(),
  });

  const rawBytes = new TextEncoder().encode(rawJson);
  const compressed = await compressGzip(rawBytes);
  const totalBytes = compressed.byteLength;
  const sha256 = await calculateSha256(compressed);

  const n_chunks = Math.max(1, Math.ceil(totalBytes / SUB_CACHE_CHUNK_SIZE));

  // Gobernanza de TTL: garantizar formalmente que expireIn(chunks) >= expireIn(manifest)
  const manifestTtlMs = ttlMs;
  const chunkTtlMs = manifestTtlMs + 60_000;
  if (chunkTtlMs < manifestTtlMs) {
    throw new Error("Violación de gobernanza: expireIn(chunks) debe ser >= expireIn(manifest)");
  }

  // Purga explícita de chunks sobrantes o huérfanos del commit anterior
  try {
    const prevManifestEntry = await kv.get<SubCacheManifest>([...baseKey, "manifest"]);
    const prevNChunks = prevManifestEntry?.value?.n_chunks ?? 0;
    if (prevNChunks > n_chunks) {
      let purgeAtomic = kv.atomic();
      for (let i = n_chunks; i < prevNChunks; i++) {
        purgeAtomic = purgeAtomic.delete([...baseKey, "chunk", i]);
      }
      await purgeAtomic.commit();
    }

    // Escaneo defensivo para eliminar cualquier residuo huérfano con índice >= n_chunks
    const chunkIter = kv.list<Uint8Array>({ prefix: [...baseKey, "chunk"] });
    let orphanAtomic = kv.atomic();
    let orphanCount = 0;
    for await (const entry of chunkIter) {
      const idxPart = entry.key[entry.key.length - 1];
      if (typeof idxPart === "number" && idxPart >= n_chunks) {
        orphanAtomic = orphanAtomic.delete(entry.key);
        orphanCount++;
        if (orphanCount >= 10) {
          await orphanAtomic.commit();
          orphanAtomic = kv.atomic();
          orphanCount = 0;
        }
      }
    }
    if (orphanCount > 0) {
      await orphanAtomic.commit();
    }
  } catch {
    /* fallback defensivo */
  }

  const manifest: SubCacheManifest = {
    n_chunks,
    bytes: totalBytes,
    sha256,
    timestamp: Date.now(),
    smartSync: payload.smartSync,
  };

  // Si cabe en un solo commit atómico (chunks + manifest <= 10 mutaciones)
  if (n_chunks + 1 <= 10) {
    let atomic = kv.atomic();
    for (let i = 0; i < n_chunks; i++) {
      const start = i * SUB_CACHE_CHUNK_SIZE;
      const end = Math.min(totalBytes, (i + 1) * SUB_CACHE_CHUNK_SIZE);
      const chunkData = compressed.subarray(start, end);
      atomic = atomic.set([...baseKey, "chunk", i], chunkData, { expireIn: chunkTtlMs });
    }
    atomic = atomic.set([...baseKey, "manifest"], manifest, { expireIn: manifestTtlMs });
    const res = await atomic.commit();
    return res.ok;
  }

  // Si excede 10 mutaciones, escribir los chunks primero en bloques y el manifest al final como señal de commit
  for (let i = 0; i < n_chunks; i += 8) {
    let atomic = kv.atomic();
    const batchLimit = Math.min(n_chunks, i + 8);
    for (let j = i; j < batchLimit; j++) {
      const start = j * SUB_CACHE_CHUNK_SIZE;
      const end = Math.min(totalBytes, (j + 1) * SUB_CACHE_CHUNK_SIZE);
      const chunkData = compressed.subarray(start, end);
      atomic = atomic.set([...baseKey, "chunk", j], chunkData, { expireIn: chunkTtlMs });
    }
    const chunkRes = await atomic.commit();
    if (!chunkRes.ok) {
      await purgeCachedSub(kv, params, n_chunks);
      return false;
    }
  }

  // Manifest final como señal de validez
  const manifestRes = await kv
    .atomic()
    .set([...baseKey, "manifest"], manifest, { expireIn: manifestTtlMs })
    .commit();

  return manifestRes.ok;
}

/**
 * Lee y reconstruye el subtítulo almacenado en Deno KV:
 * 1. Lee el manifest (si falta, es un cache miss).
 * 2. Lee los chunks en lote con getMany().
 * 3. Valida la integridad del buffer con SHA-256.
 * 4. Descomprime Gzip y deserializa el contenido.
 */
export async function getCachedSub(
  kv: Deno.Kv,
  params: SubCacheKeyParams,
): Promise<CachedSubPayload | null> {
  const baseKey = buildSubCacheBaseKey(params);
  const manifestEntry = await kv.get<SubCacheManifest>([...baseKey, "manifest"]);

  if (!manifestEntry || !manifestEntry.value) {
    return null; // Cache miss
  }

  const manifest = manifestEntry.value;
  const chunkKeys: Deno.KvKey[] = [];
  for (let i = 0; i < manifest.n_chunks; i++) {
    chunkKeys.push([...baseKey, "chunk", i]);
  }

  // Lectura en bloques mediante kv.getMany()
  const chunkEntries: Deno.KvEntryMaybe<Uint8Array>[] = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunkKeys.length; i += BATCH_SIZE) {
    const slice = chunkKeys.slice(i, i + BATCH_SIZE);
    const res = await kv.getMany<Uint8Array[]>(slice);
    chunkEntries.push(...res);
  }

  // Verificar que todos los chunks existan
  for (const entry of chunkEntries) {
    if (!entry || entry.value === null) {
      // Entrada corrupta o incompleta -> purgar y tratar como cache miss
      await purgeCachedSub(kv, params, manifest.n_chunks);
      return null;
    }
  }

  // Reensamblar el buffer comprimido
  const reconstructed = new Uint8Array(manifest.bytes);
  let offset = 0;
  for (const entry of chunkEntries) {
    const chunk = entry.value as Uint8Array;
    reconstructed.set(chunk, offset);
    offset += chunk.length;
  }

  // Validar checksum SHA-256
  const computedSha256 = await calculateSha256(reconstructed);
  if (computedSha256 !== manifest.sha256) {
    // Discordancia de hash -> purgar entradas corruptas
    await purgeCachedSub(kv, params, manifest.n_chunks);
    return null;
  }

  try {
    const decompressed = await decompressGzip(reconstructed);
    const jsonStr = new TextDecoder().decode(decompressed);
    const payload = JSON.parse(jsonStr) as CachedSubPayload;
    return payload;
  } catch {
    await purgeCachedSub(kv, params, manifest.n_chunks);
    return null;
  }
}

/**
 * Purga de manera atómica una entrada de subtítulo fragmentado.
 */
export async function purgeCachedSub(
  kv: Deno.Kv,
  params: SubCacheKeyParams,
  maxChunksToPurge = 20,
): Promise<void> {
  const baseKey = buildSubCacheBaseKey(params);
  let atomic = kv.atomic().delete([...baseKey, "manifest"]);
  for (let i = 0; i < maxChunksToPurge; i++) {
    atomic = atomic.delete([...baseKey, "chunk", i]);
  }
  try {
    await atomic.commit();
  } catch {
    /* ignore */
  }
}

/**
 * Coordinador Single-Flight:
 * Ejecuta la función generativa de traducción impidiendo que solicitudes concurrentes
 * dupliquen llamadas a la API de Gemini para la misma clave compuesta.
 */
export async function runWithSingleFlight(
  kv: Deno.Kv,
  params: SubCacheKeyParams,
  generator: () => Promise<CachedSubPayload | null>,
  pollIntervalMs = 250,
  maxWaitMs = 12000,
): Promise<CachedSubPayload | null> {
  // 1. Intento de lectura inmediata de caché
  const cached = await getCachedSub(kv, params);
  if (cached) return cached;

  // 2. Intentar adquirir el candado single-flight
  const acquired = await acquireSingleFlightLock(kv, params);

  if (acquired) {
    try {
      const generated = await generator();
      if (generated && generated.allBatchesOk) {
        await putCachedSub(kv, params, generated);
      }
      return generated;
    } finally {
      await releaseSingleFlightLock(kv, params);
    }
  }

  // 3. Si otra solicitud tiene el candado, esperar y sondear la caché
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const polled = await getCachedSub(kv, params);
    if (polled) return polled;

    // Verificar si el lock ya expiró o fue liberado
    const lockCheck = await kv.get(buildSubLockKey(params));
    if (lockCheck.value === null) {
      // El candado fue liberado: reintentar lectura final o salir
      const finalCheck = await getCachedSub(kv, params);
      if (finalCheck) return finalCheck;
      break;
    }
  }

  // Si tras esperar no hubo resultado en caché, ejecutar fallback
  return null;
}
