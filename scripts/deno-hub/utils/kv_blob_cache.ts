/**
 * kv_blob_cache.ts — Capa de Persistencia Global Bounded & Comprimida en Deno KV.
 *
 * Arquitectura Zero-Trust Anti-OOM (Deno Deploy 512MB RAM isolate):
 * 1. Superación estricta del límite de 64 KiB en Deno KV mediante compresión Gzip nativa.
 * 2. Fragmentación atómica en Chunks <= 60 KiB para payloads masivos (>100 KiB).
 * 3. Integridad criptográfica SHA-256 con verificación en tiempo constante (timingSafeEqual).
 * 4. Cache-miss defensivo: purga automática de entradas corruptas o truncadas.
 * 5. Retrocompatibilidad total: lectura transparente de entradas legacy no comprimidas (string/json).
 */

import { timingSafeEqualString } from "./crypto_security.ts";

export const KV_BLOB_CHUNK_SIZE = 60 * 1024; // 60 KiB (Tope seguro bajo el límite estricto de 64 KiB)
export const DEFAULT_BLOB_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

export interface BlobManifest {
  _compressed: true;
  chunked: boolean;
  n_chunks: number;
  uncompressedBytes: number;
  compressedBytes: number;
  sha256: string;
  timestamp: number;
  singleData?: Uint8Array;
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
 * Almacena texto arbitrario (ej. SRT, JSON) en Deno KV con compresión Gzip,
 * hash SHA-256 y fragmentación atómica si excede 60 KiB.
 */
export async function setCompressedKvText(
  kv: Deno.Kv,
  key: Deno.KvKey,
  text: string,
  options?: { expireIn?: number },
): Promise<boolean> {
  if (!text || text.trim().length === 0) return false;

  const rawBytes = new TextEncoder().encode(text);
  const sha256 = await calculateSha256(rawBytes);
  const compressed = await compressGzip(rawBytes);
  const ttl = options?.expireIn ?? DEFAULT_BLOB_TTL_MS;
  const now = Date.now();

  if (compressed.length <= KV_BLOB_CHUNK_SIZE) {
    // Almacenamiento directo mono-chunk
    const manifest: BlobManifest = {
      _compressed: true,
      chunked: false,
      n_chunks: 1,
      uncompressedBytes: rawBytes.length,
      compressedBytes: compressed.length,
      sha256,
      timestamp: now,
      singleData: compressed,
    };
    const res = await kv.set(key, manifest, { expireIn: ttl });
    return res.ok;
  }

  // Payload masivo: fragmentar en chunks de <= 60 KiB
  const nChunks = Math.ceil(compressed.length / KV_BLOB_CHUNK_SIZE);
  let atomicOp = kv.atomic();

  for (let i = 0; i < nChunks; i++) {
    const start = i * KV_BLOB_CHUNK_SIZE;
    const end = Math.min(start + KV_BLOB_CHUNK_SIZE, compressed.length);
    const chunkData = compressed.subarray(start, end);
    const chunkKey = [...key, "chunk", i];
    atomicOp = atomicOp.set(chunkKey, chunkData, { expireIn: ttl });
  }

  const manifest: BlobManifest = {
    _compressed: true,
    chunked: true,
    n_chunks: nChunks,
    uncompressedBytes: rawBytes.length,
    compressedBytes: compressed.length,
    sha256,
    timestamp: now,
  };

  atomicOp = atomicOp.set(key, manifest, { expireIn: ttl });
  const res = await atomicOp.commit();
  return res.ok;
}

/**
 * Recupera texto de Deno KV validando integridad SHA-256 y descomprimiendo Gzip.
 * Si detecta discordancia o corrupción, purga atómicamente la clave (cache-miss defensivo).
 * Soporta de forma transparente entradas legacy uncompressed string.
 */
export async function getCompressedKvText(
  kv: Deno.Kv,
  key: Deno.KvKey,
): Promise<string | null> {
  const entry = await kv.get<unknown>(key);
  if (!entry || entry.value === null || entry.value === undefined) {
    return null;
  }

  // 1. Compatibilidad transparente con string legacy no comprimido
  if (typeof entry.value === "string") {
    return entry.value;
  }

  // deno-lint-ignore no-explicit-any
  const manifest = entry.value as any;
  if (!manifest || manifest._compressed !== true || typeof manifest.sha256 !== "string") {
    return null;
  }

  try {
    let compressedBytes: Uint8Array;

    if (!manifest.chunked) {
      if (!(manifest.singleData instanceof Uint8Array)) {
        await purgeCorruptedBlob(kv, key, 0);
        return null;
      }
      compressedBytes = manifest.singleData;
    } else {
      const nChunks = Number(manifest.n_chunks);
      if (!nChunks || nChunks < 1) {
        await purgeCorruptedBlob(kv, key, 0);
        return null;
      }

      const chunkPromises = [];
      for (let i = 0; i < nChunks; i++) {
        chunkPromises.push(kv.get<Uint8Array>([...key, "chunk", i]));
      }
      const chunkEntries = await Promise.all(chunkPromises);

      const totalLen = manifest.compressedBytes || (nChunks * KV_BLOB_CHUNK_SIZE);
      const combined = new Uint8Array(totalLen);
      let offset = 0;

      for (let i = 0; i < nChunks; i++) {
        const cVal = chunkEntries[i]?.value;
        if (!(cVal instanceof Uint8Array)) {
          console.warn(`[kv_blob_cache] Chunk #${i} faltante o corrupto para ${key.join("/")}`);
          await purgeCorruptedBlob(kv, key, nChunks);
          return null;
        }
        combined.set(cVal, offset);
        offset += cVal.length;
      }
      compressedBytes = offset === combined.length ? combined : combined.subarray(0, offset);
    }

    const decompressed = await decompressGzip(compressedBytes);
    const computedSha256 = await calculateSha256(decompressed);

    // Verificación criptográfica en tiempo constante
    if (!timingSafeEqualString(computedSha256, manifest.sha256)) {
      console.error(
        `[kv_blob_cache] Discordancia SHA-256 en ${key.join("/")}: esperado=${manifest.sha256}, actual=${computedSha256}. Purgando.`,
      );
      await purgeCorruptedBlob(kv, key, manifest.chunked ? manifest.n_chunks : 0);
      return null;
    }

    return new TextDecoder("utf-8").decode(decompressed);
  } catch (err) {
    console.error(`[kv_blob_cache] Error en descompresión para ${key.join("/")}: ${(err as Error).message}`);
    await purgeCorruptedBlob(kv, key, manifest.chunked ? manifest.n_chunks : 0);
    return null;
  }
}

/**
 * Purga defensiva atómica de manifest y posibles chunks corruptos.
 */
async function purgeCorruptedBlob(kv: Deno.Kv, key: Deno.KvKey, nChunks: number): Promise<void> {
  try {
    let atomicOp = kv.atomic().delete(key);
    for (let i = 0; i < nChunks; i++) {
      atomicOp = atomicOp.delete([...key, "chunk", i]);
    }
    await atomicOp.commit();
  } catch {
    /* ignore fallback */
  }
}

/**
 * Almacena un objeto serializable en JSON con compresión Gzip y SHA-256.
 */
export async function setCompressedKvJson<T>(
  kv: Deno.Kv,
  key: Deno.KvKey,
  data: T,
  options?: { expireIn?: number },
): Promise<boolean> {
  const jsonStr = JSON.stringify(data);
  return await setCompressedKvText(kv, key, jsonStr, options);
}

/**
 * Recupera y deserializa un objeto JSON almacenado con compresión Gzip y SHA-256.
 */
export async function getCompressedKvJson<T>(
  kv: Deno.Kv,
  key: Deno.KvKey,
): Promise<T | null> {
  const text = await getCompressedKvText(kv, key);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
