/**
 * test-kv-blob-cache.ts — Test Unitario de Blindaje Anti-OOM para Persistencia Global Deno KV.
 *
 * Valida:
 * 1. Payload de texto pequeño (mono-chunk <= 60 KiB) con compresión Gzip y SHA-256.
 * 2. Payload masivo (>130 KiB) con fragmentación atómica multi-chunk (n_chunks >= 2).
 * 3. Reconstrucción bit a bit, validación constante de SHA-256 y descompresión limpia.
 * 4. Detección de corrupción / manipulación de hash y purga atómica defensiva (cache-miss).
 * 5. Retrocompatibilidad transparente con valores legacy uncompressed.
 * 6. Persistencia y recuperación de estructuras JSON.
 */

import {
  setCompressedKvText,
  getCompressedKvText,
  setCompressedKvJson,
  getCompressedKvJson,
  calculateSha256,
  KV_BLOB_CHUNK_SIZE,
} from "./deno-hub/utils/kv_blob_cache.ts";

function generateTestText(targetBytes: number): string {
  const randomBytes = new Uint8Array(targetBytes);
  for (let offset = 0; offset < targetBytes; offset += 32768) {
    const slice = randomBytes.subarray(offset, Math.min(offset + 32768, targetBytes));
    crypto.getRandomValues(slice);
  }
  let binary = "";
  for (let i = 0; i < randomBytes.length; i++) {
    binary += String.fromCharCode(randomBytes[i]);
  }
  return btoa(binary);
}

Deno.test("Zero-Trust SRE: kv_blob_cache — Capa de Persistencia Anti-OOM Deno KV", async (t) => {
  const kv = await Deno.openKv(":memory:");

  await t.step("1. Mono-chunk (<= 60 KiB) con compresión Gzip y validación SHA-256", async () => {
    const text = "Subtítulo ligero de prueba para Android TV Leanback ZTE B866V2";
    const key = ["test", "blob", "small"];

    const ok = await setCompressedKvText(kv, key, text);
    if (!ok) throw new Error("Fallo al escribir mono-chunk en KV");

    // Verificar en KV crudo que esté marcado como comprimido
    const raw = await kv.get<any>(key);
    if (!raw.value || raw.value._compressed !== true || raw.value.chunked !== false) {
      throw new Error("El manifest mono-chunk no coincide con la especificación");
    }

    const recovered = await getCompressedKvText(kv, key);
    if (recovered !== text) {
      throw new Error(`Texto recuperado no coincide. Esperado='${text}', Recibido='${recovered}'`);
    }
  });

  await t.step("2. Multi-chunk masivo (>130 KiB) con fragmentación atómica (chunks <= 60 KiB)", async () => {
    const targetSize = 140 * 1024;
    const massiveText = generateTestText(targetSize);
    const key = ["test", "blob", "massive"];

    const ok = await setCompressedKvText(kv, key, massiveText);
    if (!ok) throw new Error("Fallo al persistir payload masivo");

    const raw = await kv.get<any>(key);
    if (!raw.value || raw.value._compressed !== true || raw.value.chunked !== true) {
      throw new Error("El manifest multi-chunk no fue marcado como chunked: true");
    }

    if (raw.value.n_chunks < 2) {
      throw new Error(`Se esperaba n_chunks >= 2, pero se obtuvo ${raw.value.n_chunks}`);
    }

    // Verificar que ningún chunk supere el tope de 60 KiB
    for (let i = 0; i < raw.value.n_chunks; i++) {
      const c = await kv.get<Uint8Array>([...key, "chunk", i]);
      if (!c.value || c.value.length > KV_BLOB_CHUNK_SIZE) {
        throw new Error(`Chunk #${i} excede el límite de 60 KiB: ${c.value?.length} bytes`);
      }
    }

    const recovered = await getCompressedKvText(kv, key);
    if (!recovered) throw new Error("Recuperación devolvió null");
    if (recovered.length !== massiveText.length) {
      throw new Error(`Longitud discordante: esperada=${massiveText.length}, recuperada=${recovered.length}`);
    }
    if (recovered !== massiveText) {
      throw new Error("El contenido del texto masivo recuperado difiere del original");
    }
  });

  await t.step("3. Detección de corrupción SHA-256 y purga defensiva atómica", async () => {
    const text = "Contenido confidencial que será manipulado";
    const key = ["test", "blob", "corrupt"];

    await setCompressedKvText(kv, key, text);

    // Corromper el hash SHA-256 en el manifest
    const entry = await kv.get<any>(key);
    const fakeManifest = { ...entry.value, sha256: "0000000000000000000000000000000000000000000000000000000000000000" };
    await kv.set(key, fakeManifest);

    // Debe detectar la discordancia, retornar null y purgar la clave
    const attempt = await getCompressedKvText(kv, key);
    if (attempt !== null) {
      throw new Error("getCompressedKvText debió retornar null ante discordancia SHA-256");
    }

    const checkPurged = await kv.get(key);
    if (checkPurged.value !== null) {
      throw new Error("La clave corrupta debió ser purgada atómicamente de Deno KV");
    }
  });

  await t.step("4. Retrocompatibilidad transparente con strings legacy uncompressed", async () => {
    const legacyKey = ["test", "blob", "legacy_string"];
    const legacyValue = "1\n00:00:01,000 --> 00:00:03,000\nSubtítulo plano sin comprimir grabado en v1.0\n\n";

    await kv.set(legacyKey, legacyValue);

    const recovered = await getCompressedKvText(kv, legacyKey);
    if (recovered !== legacyValue) {
      throw new Error("No se pudo leer la cadena legacy no comprimida");
    }
  });

  await t.step("5. Persistencia y recuperación de JSON con Gzip y SHA-256", async () => {
    const jsonKey = ["test", "blob", "json_obj"];
    const data = {
      streamId: "tb-1080p-latino",
      title: "Spider-Man: Across the Spider-Verse",
      audio: "latino",
      verified: true,
      codecs: ["hevc", "ac3"],
      tags: ["[⚡ INSTANTÁNEO]", "[🌎 LATINO]"],
    };

    const ok = await setCompressedKvJson(kv, jsonKey, data);
    if (!ok) throw new Error("Fallo al persistir JSON comprimido");

    const recovered = await getCompressedKvJson<typeof data>(kv, jsonKey);
    if (!recovered) throw new Error("Recuperación de JSON devolvió null");
    if (recovered.streamId !== data.streamId || recovered.audio !== data.audio) {
      throw new Error("Objeto JSON recuperado no coincide con el original");
    }
  });
});
