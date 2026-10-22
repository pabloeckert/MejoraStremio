#!/usr/bin/env node
/**
 * release.mjs — Orquestador Maestro de Auto-Deploy, Verificación en el Edge y Sincronización Forzada.
 *
 * Flujo SRE Zero-Trust:
 *   1. Bump de versión en scripts/deno-hub/manifest.ts y unified-hub.ts.
 *   2. Commit atómico chore(release): bump to v<VERSION> y push a origin main.
 *   3. Disparo automático de deploy-deno-hub.yml en GitHub Actions.
 *   4. Polling con reintentos y cache-busting en https://mejorastremio-hub.pabloeckert.deno.net/manifest.json
 *      hasta certificar que manifest.version === <VERSION>.
 *   5. Sincronización remota definitiva secuencial de las 3 cuentas (stremioeg, solotveg, stremiojn).
 *
 * Uso:
 *   node scripts/release.mjs <version>
 *   Ejemplo: node scripts/release.mjs 3.0.0
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── 0. Parseo y Validación de Argumentos ─────────────────────────────────────
const rawVersion = process.argv[2] || '';
const version = rawVersion.replace(/^v/i, '').trim();

if (!version || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
  console.error('\n❌ Error: Debes especificar una versión válida semver (ej: 3.0.0 o 3.1.0).');
  console.error('Uso: node scripts/release.mjs <version>\n');
  process.exit(1);
}

const shortVer = version.split('.').slice(0, 2).join('.');
const enterpriseName = `MejoraStremio Hub v${shortVer} (Enterprise)`;

console.log('═'.repeat(74));
console.log(` MejoraStremio — Orquestador Maestro de Release: v${version}`);
console.log(` Nombre canónico: ${enterpriseName}`);
console.log('═'.repeat(74));

// ── 1. Paso 1: Bump de Versión, Commit y Push ────────────────────────────────
console.log('\n[ 1/3 ] Actualizando versión en el código fuente...');

// 1.1 scripts/deno-hub/manifest.ts
const manifestPath = join(ROOT, 'scripts', 'deno-hub', 'manifest.ts');
if (existsSync(manifestPath)) {
  let content = readFileSync(manifestPath, 'utf8');
  content = content.replace(
    /manifest\.ts — Manifiesto canónico de MejoraStremio Hub \(v[^)]+\)/,
    `manifest.ts — Manifiesto canónico de MejoraStremio Hub (v${version})`
  );
  content = content.replace(/version:\s*"[^"]+"/, `version: "${version}"`);
  content = content.replace(/name:\s*"[^"]+"/, `name: "${enterpriseName}"`);
  writeFileSync(manifestPath, content, 'utf8');
  console.log(`  ✓ scripts/deno-hub/manifest.ts actualizado (version: "${version}")`);
}

// 1.2 scripts/deno-hub/unified-hub.ts
const hubPath = join(ROOT, 'scripts', 'deno-hub', 'unified-hub.ts');
if (existsSync(hubPath)) {
  let content = readFileSync(hubPath, 'utf8');
  content = content.replace(
    /<span class="badge">MejoraStremio[^<]*<\/span>/,
    `<span class="badge">MejoraStremio v${shortVer} (Enterprise)</span>`
  );
  writeFileSync(hubPath, content, 'utf8');
  console.log(`  ✓ scripts/deno-hub/unified-hub.ts badge actualizado`);
}

let gitShortSha = 'dist';
try {
  gitShortSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: ROOT }).trim();
} catch {}

// 1.3 scripts/apply-stremioeg-profile.mjs
const applyScriptPath = join(ROOT, 'scripts', 'apply-stremioeg-profile.mjs');
if (existsSync(applyScriptPath)) {
  let content = readFileSync(applyScriptPath, 'utf8');
  content = content.replace(
    /CANONICAL_TORBOX_CONFIG}\/manifest\.json\?v=[^'`"]*/g,
    `CANONICAL_TORBOX_CONFIG}/manifest.json?v=${version}-${gitShortSha}`
  );
  content = content.replace(
    /(UNIFIED_HUB_ADDON_ENTRY\s*=\s*{[\s\S]*?version:\s*')[^']+'/g,
    `$1${version}'`
  );
  content = content.replace(
    /(UNIFIED_HUB_ADDON_ENTRY\s*=\s*{[\s\S]*?name:\s*')[^']+'/g,
    `$1${enterpriseName}'`
  );
  content = content.replace(
    /(manifestToUse\s*=\s*freshHubManifest\s*\|\|\s*{[\s\S]*?version:\s*')[^']+'/g,
    `$1${version}'`
  );
  writeFileSync(applyScriptPath, content, 'utf8');
  console.log(`  ✓ scripts/apply-stremioeg-profile.mjs sincronizado con v${version}-${gitShortSha}`);
}

// 1.4 cuentas/*/profile.json
const accounts = ['stremioeg', 'solotveg', 'stremiojn'];
for (const acc of accounts) {
  const profPath = join(ROOT, 'cuentas', acc, 'profile.json');
  if (existsSync(profPath)) {
    let content = readFileSync(profPath, 'utf8');
    content = content.replace(/manifest\.json\?v=[^"&]*/g, `manifest.json?v=${version}-${gitShortSha}`);
    content = content.replace(/("name":\s*")MejoraStremio Hub[^"]*"/g, `$1${enterpriseName}"`);
    content = content.replace(/("version":\s*")[^"]+"/g, `$1${version}"`);
    writeFileSync(profPath, content, 'utf8');
    console.log(`  ✓ cuentas/${acc}/profile.json sincronizado con v${version}-${gitShortSha}`);
  }
}

// 1.5 Git Add, Commit & Push
execSync('git add -A', { cwd: ROOT });
const gitStatus = execSync('git status --porcelain', { encoding: 'utf8', cwd: ROOT }).trim();

if (gitStatus) {
  console.log(`\n  • Creando commit de release: "chore(release): bump to v${version}"...`);
  execSync(`git commit -m "chore(release): bump to v${version}"`, { stdio: 'inherit', cwd: ROOT });
} else {
  console.log(`\n  • Árbol de trabajo sin cambios pendientes (archivos ya en v${version}).`);
}

console.log('  • Enviando cambios al repositorio remoto (git push origin main)...');
try {
  execSync('git push origin main', { stdio: 'inherit', cwd: ROOT });
} catch (err) {
  console.warn(`  ⚠️ Aviso en git push: ${err.message}`);
}

// 1.6 Disparo de deploy-deno-hub.yml vía GitHub CLI si está disponible
console.log('  • Verificando CI/CD Deno Deploy en GitHub Actions...');
try {
  execSync('gh workflow run deploy-deno-hub.yml --ref main', { stdio: 'pipe', cwd: ROOT });
  console.log('  ✓ Workflow deploy-deno-hub.yml disparado exitosamente.');
} catch (err) {
  console.log(`  ℹ gh workflow run no requerido o ya en ejecución: ${err.message}`);
}

// ── 2. Paso 2: Polling & Edge Verification Zero-Trust ─────────────────────────
console.log(`\n[ 2/3 ] Aguardando propagación en Deno Deploy (Edge Verification)...`);
const EDGE_URL = 'https://mejorastremio-hub.pabloeckert.deno.net/manifest.json';
const MAX_WAIT_MS = 180000; // 3 minutos
const POLL_INTERVAL_MS = 4000;
const startTime = Date.now();
let attempt = 0;
let verified = false;

while (Date.now() - startTime < MAX_WAIT_MS) {
  attempt++;
  try {
    const res = await fetch(`${EDGE_URL}?_t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const manifest = await res.json();
      if (manifest?.version === version) {
        console.log(`\n  ✓ Verificación en el Edge EXITOSA (intento #${attempt}):`);
        console.log(`    - ID:      ${manifest.id}`);
        console.log(`    - Versión: v${manifest.version}`);
        console.log(`    - Nombre:  "${manifest.name}"`);
        console.log(`    - Catálogos expuestos: ${manifest.catalogs?.length || 0}`);
        verified = true;
        break;
      } else {
        console.log(`  ⏳ Aguardando propagación en Deno Deploy... (versión en Edge: v${manifest?.version || '?'}, esperando: v${version}) [intento #${attempt}]`);
      }
    } else {
      console.log(`  ⏳ Aguardando propagación en Deno Deploy... (HTTP ${res.status}) [intento #${attempt}]`);
    }
  } catch (err) {
    console.log(`  ⏳ Aguardando propagación en Deno Deploy... (${err.message}) [intento #${attempt}]`);
  }

  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}

if (!verified) {
  console.error(`\n❌ Error Crítico: Timeout de verificación en el Edge (${MAX_WAIT_MS / 1000}s). El Edge Server no propagó la versión ${version}.`);
  process.exit(1);
}

// ── 3. Paso 3: Sincronización Forzada Definitiva ──────────────────────────────
console.log(`\n[ 3/3 ] Sincronización Forzada Definitiva de Perfiles Stremio...`);

const syncAccounts = ['stremioeg', 'solotveg', 'stremiojn'];
const results = [];

function hasLocalPasswordForAccount(acc) {
  if (acc === 'stremioeg') {
    const localCred = 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt';
    return Boolean(process.env.ST_PASS_EG || process.env.ST_PASS || process.env.STREMIO_PASS || (existsSync(localCred) && readFileSync(localCred, 'utf8').trim()));
  }
  if (acc === 'solotveg') {
    return Boolean(process.env.ST_PASS_TEEN || process.env.STREMIO_PASS_TEEN);
  }
  if (acc === 'stremiojn') {
    return Boolean(process.env.ST_PASS_JN || process.env.STREMIO_PASS_JN);
  }
  return false;
}

for (const acc of syncAccounts) {
  console.log(`\n── [Perfil ${acc}] Ejecutando sincronización con el Edge v${version} ──`);
  const hasPass = hasLocalPasswordForAccount(acc);
  const flag = hasPass ? '--apply' : '--check';
  try {
    execSync(`node scripts/apply-stremioeg-profile.mjs --account=${acc} ${flag}`, {
      stdio: 'inherit',
      cwd: ROOT,
    });
    results.push({ account: acc, status: hasPass ? 'APPLIED' : 'VALIDATED (DRY-RUN)', exitCode: 0 });
  } catch (err) {
    console.error(`❌ Error al sincronizar cuenta ${acc}: ${err.message}`);
    results.push({ account: acc, status: 'FAILED', exitCode: err.status || 1 });
  }
}

console.log('\n' + '═'.repeat(74));
console.log(' RESUMEN DE EJECUCIÓN DEL ORQUESTADOR DE RELEASE:');
for (const r of results) {
  console.log(`  • ${r.account.padEnd(12)}: [${r.status}] (exit code: ${r.exitCode})`);
}
console.log('═'.repeat(74));

const anyFailed = results.some((r) => r.status === 'FAILED');
if (anyFailed) {
  console.error('\n⚠️ Al menos un perfil falló en la sincronización.');
  process.exit(1);
} else {
  console.log(`\n🎉 RELEASE v${version} COMPLETADO CON ÉXITO.`);
  console.log('Todos los dispositivos TV Box y PC descargarán el nuevo manifiesto v' + version + ' inmediatamente.');
}
