#!/usr/bin/env node
/**
 * purge-and-unify-account.mjs — Purga Atómica Total y Unificación de Addons en la Cuenta stremioeg@gmail.com.
 *
 * Desinstala y remueve el 100% de los addons secundarios y duplicados (SubSource, OpenSubtitles Latino,
 * SubDL, Traducción IA, MejoraStremio Streams, Comet, Mediathek DE, NoTorrent, WebStreamMBG, Nuvio Streams,
 * Streailer, MyTrakt Sync, Mubi Catalog, Streaming Catalogs, Descubrir Maestro, Miniseries, Comedias Cortas,
 * TV en Vivo, Synopsis IA, Trakt Integration, AIOMetadata).
 *
 * Deja en la cuenta ÚNICAMENTE 2 ADDONS:
 *   [0] com.mejorastremio.hub (Puesto #1 Primario Exclusivo) con la URL canónica de TorBox Latino.
 *   [1] com.linvo.cinemeta (Cinemeta Oficial de Stremio).
 *
 * Protocolo Zero-Trust:
 *   --dry-run (por defecto): Muestra diff visual estructurado sin modificar la cuenta.
 *   --apply: Ejecuta la purga atómica, crea backup en .backups/ y verifica el estado final.
 *   --rollback-last: Restaura el último backup atómico generado.
 *   --rollback <file>: Restaura un backup JSON específico.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiPost, stremioLogin } from './lib/stremio-api.mjs';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ROLLBACK_LAST = args.includes('--rollback-last');
const rbIdx = args.indexOf('--rollback');
const ROLLBACK_FILE = rbIdx >= 0 ? args[rbIdx + 1] : null;
const DRY_RUN = !APPLY && !ROLLBACK_LAST && !ROLLBACK_FILE;

const BASELINE_V141 = args.includes('--baseline-v141') || args.includes('--v141');
const targetVersion = BASELINE_V141 ? '1.4.1' : '1.4.2';

const CANONICAL_HUB_TRANSPORT_URL =
  `https://mejorastremio-hub.pabloeckert.deno.net/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,nekobt,rutor,rutracker,comando,bludv,micoleaodublado,torrent9,ilcorsaronero,mejortorrent,wolfmax4k,cinecalidad,besttorrents|sort=seeders|qualityfilter=brremux,hdrall,dolbyvision,dolbyvisionwithhdr,threed,cam,scr,unknown,4k,480p|torbox=9fe5c202-15ec-4aeb-b4e7-8613728cf044|language=latino/manifest.json?v=${targetVersion}`;

const CINEMETA_TRANSPORT_URL = 'https://v3-cinemeta.strem.io/manifest.json';

// ── Cargar Credenciales ───────────────────────────────────────────────────────
function getCredentials() {
  const email = process.env.ST_EMAIL || 'stremioeg@gmail.com';
  let pass = process.env.ST_PASS || '';

  if (!pass) {
    const localCred = 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt';
    if (existsSync(localCred)) {
      try {
        const rawLines = readFileSync(localCred, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        pass = rawLines.length > 1 ? rawLines[1] : rawLines[0];
      } catch {
        // Ignorar
      }
    }
  }

  if (!pass) {
    console.error('✗ Faltan credenciales de Stremio (ST_PASS o archivo de credenciales no disponible)');
    process.exit(1);
  }

  return { email, pass };
}

// ── Rollback Handler ─────────────────────────────────────────────────────────
async function handleRollback(authKey, rollbackLast, rollbackFile) {
  let targetFile = rollbackFile;
  if (rollbackLast) {
    if (!existsSync(BACKUPS)) {
      console.error('✗ No existe el directorio de backups:', BACKUPS);
      process.exit(1);
    }
    const files = readdirSync(BACKUPS)
      .filter((f) => f.startsWith('backup-stremioeg-') && f.endsWith('.json'))
      .map((f) => ({ name: f, path: join(BACKUPS, f), mtime: statSync(join(BACKUPS, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (!files.length) {
      console.error('✗ No se encontraron backups de stremioeg en', BACKUPS);
      process.exit(1);
    }
    targetFile = files[0].path;
  }

  if (!targetFile || !existsSync(targetFile)) {
    console.error('✗ Archivo de backup no encontrado:', targetFile);
    process.exit(1);
  }

  console.log(`\n[ ROLLBACK ] Restaurando estado desde: ${targetFile}`);
  const raw = JSON.parse(readFileSync(targetFile, 'utf8'));
  const restoredAddons = Array.isArray(raw) ? raw : (raw.addons || raw.result?.addons || []);

  if (!restoredAddons.length) {
    console.error('✗ El backup seleccionado no contiene addons válidos');
    process.exit(1);
  }

  console.log(`  • Add-ons a restaurar: ${restoredAddons.length}`);
  restoredAddons.forEach((a, i) => console.log(`    ${i}. [${a.manifest?.id || a.id}] ${a.manifest?.name || a.name}`));

  if (DRY_RUN) {
    console.log('\n  ℹ MODO DRY-RUN: Para aplicar rollback en vivo, agregar --apply');
    return;
  }

  const guardOk = await assertNoFrozenEmptyCatalogs(restoredAddons, ['com.mejorastremio.hub', 'com.linvo.cinemeta']);
  if (!guardOk) {
    console.error('✗ Abortado por guard anti-catálogos-congelados');
    process.exit(1);
  }

  const saveRes = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: restoredAddons });
  if (!saveRes?.result?.success && !saveRes?.result) {
    console.error('✗ Falló addonCollectionSet durante rollback:', JSON.stringify(saveRes));
    process.exit(1);
  }
  console.log('✓ Rollback aplicado exitosamente en la cuenta Stremio.');
}

// ── Ejecución Principal ───────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(75));
  console.log(' MejoraStremio — Purga Atómica Total y Unificación de Addons');
  console.log(` Fecha: ${new Date().toISOString()}`);
  console.log(` Modo: ${DRY_RUN ? 'DRY-RUN (Simulación)' : 'APPLY (En Producción Real)'}`);
  console.log('═'.repeat(75));

  const { email, pass } = getCredentials();
  console.log(`\n[1/4] Conectando a la API de Stremio como ${email}...`);
  const authKey = await stremioLogin(email, pass);
  console.log('  ✓ Autenticación exitosa (authKey obtenida)');

  if (ROLLBACK_LAST || ROLLBACK_FILE) {
    await handleRollback(authKey, ROLLBACK_LAST, ROLLBACK_FILE);
    return;
  }

  // 1. Obtener addons actuales
  const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const currentAddons = col?.result?.addons || [];
  console.log(`\n[2/4] Estado actual de la cuenta: ${currentAddons.length} addons instalados`);
  currentAddons.forEach((a, i) => {
    console.log(`  ${String(i).padStart(2)}. [${a.manifest?.id || '?'}] ${a.manifest?.name || '?'} (v${a.manifest?.version || '?'})`);
  });

  // 2. Fetch fresco del manifest del Hub Unificado
  console.log('\n[3/4] Preparando especificación atómica canónica (2 ADDONS)...');
  console.log(`  • Obteniendo manifest en vivo de MejoraStremio Hub: ${CANONICAL_HUB_TRANSPORT_URL}`);
  const hubRes = await fetch(CANONICAL_HUB_TRANSPORT_URL, { signal: AbortSignal.timeout(15000) });
  if (!hubRes.ok) {
    throw new Error(`Falló fetch del manifest del Hub: HTTP ${hubRes.status}`);
  }
  const hubManifest = await hubRes.json();
  console.log(`    ✓ Manifest Hub OK: "${hubManifest.name}" (v${hubManifest.version}), ${hubManifest.catalogs?.length || 0} catálogos, resources: [${hubManifest.resources?.join(', ')}]`);

  // Obtener o preservar manifest de Cinemeta
  let cinemetaAddon = currentAddons.find((a) => a.manifest?.id === 'com.linvo.cinemeta' || a.manifest?.id === 'com.stremio.cinemeta');
  if (!cinemetaAddon) {
    console.log(`  • Obteniendo manifest en vivo de Cinemeta: ${CINEMETA_TRANSPORT_URL}`);
    const cineRes = await fetch(CINEMETA_TRANSPORT_URL, { signal: AbortSignal.timeout(15000) });
    if (!cineRes.ok) throw new Error(`Falló fetch de Cinemeta: HTTP ${cineRes.status}`);
    const cineManifest = await cineRes.json();
    cinemetaAddon = {
      transportUrl: CINEMETA_TRANSPORT_URL,
      transportName: '',
      manifest: cineManifest,
      flags: { official: true, protected: true },
    };
  }

  const targetAddons = [
    {
      transportUrl: CANONICAL_HUB_TRANSPORT_URL,
      transportName: '',
      manifest: hubManifest,
      flags: { official: false, protected: false },
    },
    cinemetaAddon,
  ];

  // 3. Diff Visual Estructurado
  console.log('\n' + '─'.repeat(75));
  console.log(' TABLA DE TRANSFORMACIÓN ATÓMICA DE PRODUCCIÓN:');
  console.log('─'.repeat(75));

  const removedAddons = currentAddons.filter((a) => {
    const id = a.manifest?.id;
    return id !== 'com.mejorastremio.hub' && id !== 'com.linvo.cinemeta' && id !== 'com.stremio.cinemeta';
  });

  removedAddons.forEach((a) => {
    console.log(`  [-] REMOVIDO   : [${a.manifest?.id || '?'}] ${a.manifest?.name || '?'}`);
  });

  console.log(`  [^] POSICIÓN #0: [com.mejorastremio.hub] ${hubManifest.name} (v${hubManifest.version}) ➔ PUESTO #1 PRIMARIO`);
  console.log(`  [^] POSICIÓN #1: [${cinemetaAddon.manifest?.id}] ${cinemetaAddon.manifest?.name} (v${cinemetaAddon.manifest?.version}) ➔ PUESTO #2 METADATOS`);
  console.log('─'.repeat(75));
  console.log(` Total addons a remover: ${removedAddons.length}`);
  console.log(` Total addons a conservar: 2 (Hub Unificado + Cinemeta)`);
  console.log('─'.repeat(75));

  // 4. Pre-flight Guards
  console.log('\n[4/4] Verificando Pre-Flight Guards de Integridad...');
  if (targetAddons.length !== 2) {
    throw new Error(`Invariante violada: la colección resultante debe tener exactamente 2 addons, tiene ${targetAddons.length}`);
  }
  if (targetAddons[0].manifest.id !== 'com.mejorastremio.hub') {
    throw new Error('Invariante violada: la posición #0 debe ser com.mejorastremio.hub');
  }
  if (targetAddons[1].manifest.id !== 'com.linvo.cinemeta' && targetAddons[1].manifest.id !== 'com.stremio.cinemeta') {
    throw new Error('Invariante violada: la posición #1 debe ser Cinemeta');
  }

  const guardOk = await assertNoFrozenEmptyCatalogs(targetAddons, ['com.mejorastremio.hub', 'com.linvo.cinemeta']);
  if (!guardOk) {
    throw new Error('Pre-flight fallido: assertNoFrozenEmptyCatalogs reportó catálogos congelados');
  }
  console.log('  ✓ Invariantes del perfil validadas (2 addons, orden [Hub, Cinemeta], catálogos íntegros)');

  if (DRY_RUN) {
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(' ℹ MODO DRY-RUN COMPLETADO CON ÉXITO: 0 mutaciones en la API.');
    console.log(' Para ejecutar la purga atómica en producción, ejecutá con --apply:');
    console.log(' node scripts/purge-and-unify-account.mjs --apply');
    console.log('══════════════════════════════════════════════════════════════════════');
    return;
  }

  // 5. Aplicar con Snapshot Atómico Previo
  mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = join(BACKUPS, `backup-stremioeg-pre-purge-atomic-${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify(col, null, 2));
  console.log(`  ✓ Snapshot atómico de respaldo generado en: ${backupFile}`);

  console.log('\n  Enviando addonCollectionSet a la API de Stremio...');
  const setRes = await apiPost('addonCollectionSet', {
    type: 'AddonCollectionSet',
    authKey,
    addons: targetAddons,
  });

  if (!setRes?.result?.success && !setRes?.result) {
    throw new Error(`Falló addonCollectionSet: ${JSON.stringify(setRes)}`);
  }
  console.log('  ✓ addonCollectionSet aceptado por la API de Stremio');

  // 6. Verificación Cruda Post-Mutación
  console.log('\n  Verificando estado post-mutación en la API (addonCollectionGet)...');
  const verifyCol = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const verifiedAddons = verifyCol?.result?.addons || [];

  console.log(`\n  Colección final en vivo en Stremio: ${verifiedAddons.length} addons`);
  verifiedAddons.forEach((a, i) => {
    console.log(`    [${i}] ${a.manifest?.name} (${a.manifest?.id}) — v${a.manifest?.version} — ${(a.manifest?.catalogs || []).length} catálogos`);
  });

  if (verifiedAddons.length !== 2) {
    console.error(`✗ ADVERTENCIA: Se esperaban 2 addons, pero se encontraron ${verifiedAddons.length}`);
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(' ✨ PURGA ATÓMICA Y UNIFICACIÓN FINALIZADA CON ÉXITO AL 100%');
  console.log(' La cuenta stremioeg@gmail.com ahora tiene exclusivamente:');
  console.log('   #0: MejoraStremio Hub (TorBox Latino + Subtítulos IA + SmartSync)');
  console.log('   #1: Cinemeta');
  console.log('══════════════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\n✗ ERROR FATAL EN PURGA ATÓMICA:', err.message || err);
  process.exit(1);
});
