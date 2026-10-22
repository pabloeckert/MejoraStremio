/**
 * hasher.ts — Implementación oficial OpenSubtitles Moviehash (64 KiB + 64 KiB + BigInt uint64).
 *
 * Algoritmo oficial:
 * 1. Obtiene el tamaño total del archivo (Content-Length o Content-Range vía HEAD o Range: bytes=0-0).
 * 2. Descarga los primeros 64 KiB (bytes=0-65535).
 * 3. Descarga los últimos 64 KiB (bytes=(filesize-65536)-(filesize-1)).
 * 4. Suma en Little-Endian con aritmética BigInt de 64 bits (uint64):
 *    hash = (filesize + sum(first_64k) + sum(last_64k)) & 0xFFFFFFFFFFFFFFFFn
 * 5. Retorna la cadena hexadecimal de 16 caracteres paddeada con ceros a la izquierda.
 */

export const HASH_CHUNK_SIZE = 65536; // 64 KiB
export const MASK_64 = 0xFFFFFFFFFFFFFFFFn;

/**
 * Calcula el OpenSubtitles moviehash a partir del tamaño y los buffers de 64 KiB inicial y final.
 */
export function computeMovieHashFromBuffers(
  filesize: bigint | number,
  headChunk: Uint8Array,
  tailChunk: Uint8Array,
): string {
  let hash = (typeof filesize === "bigint" ? filesize : BigInt(filesize)) & MASK_64;

  const processChunk = (chunk: Uint8Array) => {
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const limit = chunk.byteLength - (chunk.byteLength % 8);
    for (let i = 0; i < limit; i += 8) {
      const val = view.getBigUint64(i, true); // true = little-endian uint64
      hash = (hash + val) & MASK_64;
    }
  };

  processChunk(headChunk);
  processChunk(tailChunk);

  return hash.toString(16).padStart(16, "0");
}

/**
 * Obtiene el moviehash oficial de 64 KiB realizando peticiones HTTP Range de bajo impacto
 * sobre el stream multimedia (sin descargar el archivo completo).
 */
export async function fetchMovieHash(
  streamUrl: string,
  timeoutMs = 8000,
): Promise<{ hash: string; size: number } | null> {
  try {
    let filesize = 0;

    // Paso 1: Petición HEAD o Range: bytes=0-0 para conocer el tamaño total
    const headRes = await fetch(streamUrl, {
      method: "HEAD",
      headers: { "User-Agent": "MejoraStremio-MovieHasher/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);

    if (headRes && headRes.ok) {
      const cl = headRes.headers.get("content-length");
      if (cl) filesize = parseInt(cl, 10);
    }

    if (!filesize || isNaN(filesize)) {
      const probeRes = await fetch(streamUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": "MejoraStremio-MovieHasher/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null);

      if (probeRes) {
        const cr = probeRes.headers.get("content-range");
        if (cr) {
          const match = cr.match(/\/(\d+)/);
          if (match) filesize = parseInt(match[1], 10);
        }
      }
    }

    if (!filesize || filesize < HASH_CHUNK_SIZE) {
      return null;
    }

    // Paso 2: Descargar primeros 64 KiB
    const headReq = await fetch(streamUrl, {
      headers: { Range: `bytes=0-${HASH_CHUNK_SIZE - 1}`, "User-Agent": "MejoraStremio-MovieHasher/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!headReq.ok && headReq.status !== 206) return null;
    const headBuffer = new Uint8Array(await headReq.arrayBuffer());

    // Paso 3: Descargar últimos 64 KiB
    const tailStart = filesize - HASH_CHUNK_SIZE;
    const tailEnd = filesize - 1;
    const tailReq = await fetch(streamUrl, {
      headers: { Range: `bytes=${tailStart}-${tailEnd}`, "User-Agent": "MejoraStremio-MovieHasher/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!tailReq.ok && tailReq.status !== 206) return null;
    const tailBuffer = new Uint8Array(await tailReq.arrayBuffer());

    if (headBuffer.byteLength < HASH_CHUNK_SIZE || tailBuffer.byteLength < HASH_CHUNK_SIZE) {
      return null;
    }

    // Paso 4: Suma little-endian BigInt uint64
    const hash = computeMovieHashFromBuffers(BigInt(filesize), headBuffer, tailBuffer);
    return { hash, size: filesize };
  } catch {
    return null;
  }
}
