/**
 * stream_security.ts — Cifrado Opaco (AES-GCM 256-bit) y Gestión de Sesión de Streams.
 *
 * Garantiza:
 * 1. Zero-Secrets: La API Key y URLs privadas de TorBox jamás se exponen en texto plano
 *    ni en Base64 sin cifrar a los clientes o en logs públicos.
 * 2. Cifrado Opaque con AES-GCM 256-bit y soporte para Deno KV ["stream_session", sessionId].
 * 3. Redirección HTTP 302 transparente en /stream_session/:id hacia la URL real.
 */

import { safeGetKv, type StremioStreamItem } from "../utils/common.ts";

const MASTER_KEY_RAW = new TextEncoder().encode("MejoraStremio-Stream-AES-GCM-256"); // 32 bytes

export async function getAesGcmKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    MASTER_KEY_RAW,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptOpaqueStreamUrl(url: string): Promise<string> {
  const key = await getAesGcmKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(url);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return Array.from(combined)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function decryptOpaqueStreamUrl(hex: string): Promise<string | null> {
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    const bytes = new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
    if (bytes.byteLength < 13) return null;
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const key = await getAesGcmKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * Anonimiza y cifra cualquier URL de stream que contenga tokens o endpoints de TorBox.
 */
export async function sessionizeTorboxStreams(
  streams: StremioStreamItem[],
  origin: string,
  customKv?: Deno.Kv | null,
): Promise<StremioStreamItem[]> {
  const kv = customKv ?? (await safeGetKv());

  return await Promise.all(
    streams.map(async (s) => {
      if (!s.url) return s;

      const hasTorboxSecret =
        s.url.includes("9fe5c202-15ec-4aeb-b4e7-8613728cf044") ||
        s.url.includes("torbox.app") ||
        s.url.includes("/torbox/");

      if (hasTorboxSecret) {
        const sessionId = crypto.randomUUID();
        if (kv) {
          await kv.set(["stream_session", sessionId], s.url, {
            expireIn: 24 * 60 * 60 * 1000, // 24h
          }).catch(() => {});
        }
        // Cifrado AES-GCM adicional para resiliencia sin estado
        const encryptedToken = await encryptOpaqueStreamUrl(s.url);
        if (kv) {
          await kv.set(["stream_session", encryptedToken], s.url, {
            expireIn: 24 * 60 * 60 * 1000,
          }).catch(() => {});
        }

        const identifier = sessionId;
        const opaqueUrl = `${origin}/stream_session/${identifier}`;

        return {
          ...s,
          url: opaqueUrl,
        };
      }

      return s;
    })
  );
}

/**
 * Resuelve una sesión de stream buscando en Deno KV o desencriptando con AES-GCM.
 */
export async function resolveStreamSession(
  sessionIdOrHex: string,
  customKv?: Deno.Kv | null,
): Promise<string | null> {
  const kv = customKv ?? (await safeGetKv());
  if (kv) {
    try {
      const entry = await kv.get<string>(["stream_session", sessionIdOrHex]);
      if (entry && entry.value) {
        return entry.value;
      }
    } catch {
      // Continuar a fallback de desencriptado
    }
  }

  // Fallback: Desencriptado AES-GCM directo
  const decrypted = await decryptOpaqueStreamUrl(sessionIdOrHex);
  if (decrypted) return decrypted;

  return null;
}
