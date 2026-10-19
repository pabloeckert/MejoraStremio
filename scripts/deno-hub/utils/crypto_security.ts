/**
 * crypto_security.ts — Capa de Seguridad Criptográfica, Firmado HMAC-SHA256 y Rotación Suave (P8).
 *
 * Implementa:
 * 1. Comparación en tiempo constante (timingSafeEqual) resistente a ataques de canal lateral (timing attacks).
 * 2. Firmado de URLs de proxy con expiración temporal obligatoria (`exp`) contra replay attacks.
 * 3. Rotación suave de claves con soporte dual: clave activa (`activeKey`) y clave previa (`previousKey`).
 *
 * Alcance exclusivo: Android TV ZTE ZXV10 B866V2.
 */

import { signHmacSha256 } from "./common.ts";

export interface ProxySigningOptions {
  activeKey: string;
  previousKey?: string;
  ttlSeconds?: number; // Por defecto: 3600s (1 hora)
}

export interface ProxyVerificationResult {
  valid: boolean;
  expired: boolean;
  reason?: string;
  keyUsed?: "active" | "previous";
  expiresAt?: number;
}

/**
 * Comparación en tiempo constante de dos buffers de bytes (Uint8Array).
 * Previene ataques de timing al tardar exactamente el mismo tiempo sin importar
 * en qué byte difieran los buffers.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Comparación en tiempo constante de dos cadenas codificadas en UTF-8.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  return timingSafeEqual(bufA, bufB);
}

/**
 * Genera la representación canónica de una URL para el cálculo de la firma HMAC.
 * Ordena alfabéticamente los parámetros de consulta excluyendo `sig`.
 */
export function canonicalizeUrlForSigning(url: URL): string {
  const pathname = url.pathname;
  const params = new URLSearchParams();

  // Ordenar alfabéticamente todas las claves excepto 'sig'
  const keys = [...url.searchParams.keys()].filter((k) => k !== "sig").sort();
  for (const k of keys) {
    const vals = url.searchParams.getAll(k).sort();
    for (const v of vals) {
      params.append(k, v);
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Firma una URL para consumo seguro del proxy con timestamp de expiración (`exp`)
 * y firma criptográfica HMAC-SHA256 (`sig`).
 */
export async function signProxyUrl(
  inputUrl: string | URL,
  activeKey: string,
  ttlSeconds = 3600,
): Promise<string> {
  if (!activeKey) {
    throw new Error("Se requiere una activeKey no vacía para firmar URLs de proxy.");
  }

  const u = new URL(String(inputUrl));
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + ttlSeconds;

  // Inyectar parámetro exp
  u.searchParams.set("exp", String(expiresAt));
  u.searchParams.delete("sig"); // Asegurar que no haya firma previa al calcular

  const canonical = canonicalizeUrlForSigning(u);
  const sig = await signHmacSha256(canonical, activeKey);

  u.searchParams.set("sig", sig);
  return u.toString();
}

/**
 * Valida la autenticidad, vigencia y no-manipulación de una URL firmada.
 * Implementa el Plan de Rotación de Claves (Doble Validación):
 * 1. Comprueba primero la clave activa.
 * 2. Si difiere y existe clave previa configurada, evalúa la clave previa.
 * Toda comparación se ejecuta en tiempo constante.
 */
export async function verifyProxyUrl(
  inputUrl: string | URL,
  activeKey: string,
  previousKey?: string,
): Promise<ProxyVerificationResult> {
  let u: URL;
  try {
    u = new URL(String(inputUrl));
  } catch {
    return { valid: false, expired: false, reason: "invalid_url" };
  }

  const sig = u.searchParams.get("sig");
  const expStr = u.searchParams.get("exp");

  if (!sig || !expStr) {
    return { valid: false, expired: false, reason: "missing_signature_or_expiration" };
  }

  const expiresAt = parseInt(expStr, 10);
  if (isNaN(expiresAt)) {
    return { valid: false, expired: false, reason: "invalid_expiration_format" };
  }

  // Validación de Replay / Expiración
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > expiresAt) {
    return {
      valid: false,
      expired: true,
      reason: "signature_expired",
      expiresAt,
    };
  }

  // Construir mensaje canónico a verificar (sin el parámetro 'sig')
  const testUrl = new URL(u.toString());
  testUrl.searchParams.delete("sig");
  const canonical = canonicalizeUrlForSigning(testUrl);

  // 1. Validación con Clave Activa
  if (activeKey) {
    const expectedActive = await signHmacSha256(canonical, activeKey);
    if (timingSafeEqualString(sig.toLowerCase(), expectedActive.toLowerCase())) {
      return {
        valid: true,
        expired: false,
        keyUsed: "active",
        expiresAt,
      };
    }
  }

  // 2. Validación con Clave Previa (Ventana de Rotación Suave)
  if (previousKey && previousKey !== activeKey) {
    const expectedPrev = await signHmacSha256(canonical, previousKey);
    if (timingSafeEqualString(sig.toLowerCase(), expectedPrev.toLowerCase())) {
      return {
        valid: true,
        expired: false,
        keyUsed: "previous",
        expiresAt,
      };
    }
  }

  return {
    valid: false,
    expired: false,
    reason: "invalid_signature",
    expiresAt,
  };
}

/**
 * Obtiene las claves HMAC de entorno para el proxy con soporte de rotación suave.
 */
export function getHmacProxyKeys(): { activeKey: string; previousKey?: string } {
  const activeKey =
    (typeof Deno !== "undefined" && Deno.env?.get?.("HMAC_PROXY_ACTIVE_KEY")) ||
    (typeof Deno !== "undefined" && Deno.env?.get?.("HMAC_TELEMETRY_SECRET")) ||
    (typeof process !== "undefined" && process.env?.HMAC_PROXY_ACTIVE_KEY) ||
    "default-active-hmac-key-v142";

  const previousKey =
    (typeof Deno !== "undefined" && Deno.env?.get?.("HMAC_PROXY_PREVIOUS_KEY")) ||
    (typeof process !== "undefined" && process.env?.HMAC_PROXY_PREVIOUS_KEY) ||
    undefined;

  return { activeKey, previousKey };
}
