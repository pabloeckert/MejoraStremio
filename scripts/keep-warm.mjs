#!/usr/bin/env node
/**
 * Pingea el manifest de AIOMetadata para mantener la instancia ElfHosted activa
 * y evitar el cold start que congela Stremio al abrir (~11h/~23h).
 *
 * Uso manual:
 *   node scripts/keep-warm.mjs
 *
 * Pensado para correr via Windows Task Scheduler cada 20 minutos (ver setup abajo).
 * Exit 0 = instancia caliente. Exit 1 = timeout o error (Task Scheduler puede alertar).
 *
 * Setup Task Scheduler (una sola vez, como Admin):
 *   pwsh scripts/setup-keep-warm.ps1
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LOG_PATH = join(ROOT, "logs", "keep-warm.log");

mkdirSync(join(ROOT, "logs"), { recursive: true });

const log = (line) => {
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
};

const preset = JSON.parse(
  readFileSync(join(ROOT, "data", "preset.json"), "utf8")
);

const uuid = preset.aioMetadataConfig?.instanceId;
if (!uuid) {
  console.error("ERROR: no se encontró aioMetadataConfig.instanceId en preset.json");
  process.exit(1);
}

const url = `https://aiometadata.elfhosted.com/stremio/${uuid}/manifest.json`;
const TIMEOUT_MS = 15_000;

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19);

try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  const res = await fetch(url, { signal: ctrl.signal });
  clearTimeout(timer);
  const ms = Date.now() - t0;

  if (!res.ok) {
    console.error(`[${ts()}] WARN: AIOMetadata respondió HTTP ${res.status} en ${ms}ms`);
    process.exit(1);
  }

  const data = await res.json();
  log(`[${ts()}] OK: AIOMetadata "${data.name ?? uuid}" caliente en ${ms}ms`);
  process.exit(0);
} catch (err) {
  const msg = err.name === "AbortError"
    ? `TIMEOUT: AIOMetadata no respondió en ${TIMEOUT_MS}ms — cold start en curso`
    : `ERROR: ${err.message}`;
  log(`[${ts()}] ${msg}`);
  process.exit(1);
}
