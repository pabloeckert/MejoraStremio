/**
 * gemini.ts — Conectores para LLMs (Google Gemini Flash & OpenRouter) y generación de prompts de traducción.
 * Preserva las directivas estrictas de traducción cinematográfica, nombres propios y anti-SDH.
 */

export const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
export const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free";
export const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
export const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";

export const NL = "§Z"; // Sentinel para saltos de línea internos al mandar a la IA
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GEMINI_SAFETY_OFF = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

export async function callGemini(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const model = GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      safetySettings: GEMINI_SAFETY_OFF,
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    }),
    signal,
  });
  if (!r.ok) {
    if (r.status === 404 && model !== "gemini-1.5-flash") {
      const fbUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`;
      const fb = await fetch(fbUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          safetySettings: GEMINI_SAFETY_OFF,
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
        signal,
      });
      if (fb.ok) {
        const d = await fb.json();
        const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return String(text).trim();
      }
    }
    throw new Error(`Gemini respondió ${r.status}`);
  }
  const d = await r.json();
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini: sin texto (" + (d?.candidates?.[0]?.finishReason || JSON.stringify(d).slice(0, 120)) + ")");
  return String(text).trim();
}

export async function callOpenRouter(prompt: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENROUTER_MODEL, messages: [{ role: "user", content: prompt }] }),
    signal,
  });
  if (!r.ok) throw new Error(`OpenRouter respondió ${r.status}`);
  const d = await r.json();
  const text = d?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter: sin texto en la respuesta");
  return String(text).trim();
}

export function cleanCueForTranslation(text: string): string {
  if (!text) return "";
  let t = text;
  // 1. Eliminar etiquetas HTML y estilos
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\{[^}]+\}/g, "");
  // 2. Eliminar acotaciones sonoras entre corchetes o paréntesis
  t = t.replace(/\[[^\]\n]*\]/g, "");
  t = t.replace(/\([^\)\n]*\)/g, "");
  // 3. Eliminar prefijos de hablante en mayúsculas
  t = t.replace(/^[A-ZÁÉÍÓÚÑÀÂÇÉÈÊËÎÏÔÙÛÜŸ0-9\s._-]{2,30}:\s*/gm, "");
  // 4. Eliminar símbolos musicales
  t = t.replace(/[♪♫#*]+/g, "");
  return t.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

export const LANG_NAMES: Record<string, string> = {
  fr: "idioma francés (fr)",
  en: "idioma inglés (en)",
  de: "idioma alemán (de)",
  it: "idioma italiano (it)",
  pt: "idioma portugués (pt)",
  es: "idioma español (es)",
};

export function buildTranslateSystemPrompt(titleName?: string, sourceLang = "inglés"): string {
  const langLabel = LANG_NAMES[sourceLang.toLowerCase()] || `idioma ${sourceLang}`;
  const showInfo = titleName
    ? `Estás traduciendo la serie/película "${titleName}".`
    : "Estás traduciendo una producción audiovisual de cine o televisión.";

  return (
    `Sos un traductor y adaptador profesional de subtítulos para cine y series de televisión. ` +
    `Tu tarea es traducir del ${langLabel} al ESPAÑOL LATINOAMERICANO NEUTRO (estilo doblaje profesional latinoamericano).\n\n` +
    `${showInfo}\n\n` +
    `DIRECTIVAS ESTRICTAS DE CALIDAD:\n` +
    `1. REGLA INVIOLABLE DE NOMBRES PROPIOS: NUNCA traduzcas nombres propios ni locaciones: NUNCA traduzcas, adaptes ni alteres nombres de personajes (ej: Ludwig, John, James, Holly, Lucy, etc.), apellidos, apodos, nombres de calles, marcas ni topónimos (ej: Cambridge). Deben permanecer EXACTAMENTE en su forma y grafía original.\n` +
    `2. INTERPRETACIÓN CINEMATOGRÁFICA Y SENTIDO DRAMÁTICO: Queda terminantemente prohibida la traducción literal palabra por palabra. Interpreta con naturalidad el humor, la ironía, los dobles sentidos y el registro conversacional, adaptándolo a un español neutro fluido, coloquial y elegante (sin modismos peninsulares como 'vosotros', ni 'coger' por agarrar, ni modismos regionales excesivos).\n` +
    `3. HIGIENE ANTI-SDH: NUNCA generes ni incluyas descripciones de sonido, ruidos entre corchetes o paréntesis ni etiquetas de hablantes (ej: NADA de [Música], (Risas) ni NOMBRE:). Traduce exclusivamente el diálogo humano hablado.\n` +
    `4. CONSERVACIÓN DE FORMATO: Recibís líneas numeradas '<n>▸ <texto>'. Devolvé EXACTAMENTE las mismas líneas numeradas '<n>▸ <traducción>', una por línea, mismo n, misma cantidad, sin texto introductorio ni explicaciones adicionales. El símbolo ${NL} es un salto de línea interno: conservalo en el lugar exacto donde corresponda en la traducción.`
  );
}
