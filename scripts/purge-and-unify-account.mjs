#!/usr/bin/env node
/**
 * purge-and-unify-account.mjs — Purga Atómica Total y Unificación de Addons Multi-Perfil (v1.4.2).
 *
 * Desinstala y remueve el 100% de los addons secundarios y duplicados en las cuentas:
 *   - stremioeg@gmail.com (Pablo - Principal)
 *   - solotveg@gmail.com (Juvenil / Adolescente)
 *   - stremiojn@gmail.com (Joaquín - Deportes / Acción)
 *
 * Deja en cada cuenta ÚNICAMENTE 2 ADDONS CANÓNICOS:
 *   [0] com.mejorastremio.hub (Puesto #1 Primario Exclusivo con TorBox Debrid y prioridad de audio latino).
 *   [1] com.linvo.cinemeta (Cinemeta Oficial de Stremio).
 *
 * Protocolo Zero-Trust:
 *   --dry-run (por defecto): Muestra diff visual estructurado sin modificar la cuenta.
 *   --apply: Ejecuta la mutación atómica, crea snapshot en .backups/ y valida el estado final en vivo.
 *   --account <eg|solotveg|stremiojn|all>: Selecciona la cuenta objetivo (por defecto 'eg').
 *   --rollback-last: Restaura el último backup atómico generado para la cuenta.
 *   --rollback <file>: Restaura un backup JSON específico.
 *   --baseline-v141 / --v141: Usa manifest v1.4.1 para rollback transparente en Android TV RAM.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiPost, stremioLogin } from './lib/stremio-api.mjs';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BACKUPS = join(ROOT, '.backups');

export const ACCOUNTS_CONFIG = {
  eg: {
    alias: 'stremioeg',
    defaultEmail: 'stremioeg@gmail.com',
    envEmail: ['ST_EMAIL_EG', 'ST_EMAIL', 'STREMIO_EMAIL'],
    envPass: ['ST_PASS_EG', 'ST_PASS', 'STREMIO_PASS'],
    localCredFile: 'C:/Users/tabeg/OneDrive/Documentos/Stemio/Pruebas/baee30cf-9528-4d53-82f3-2c4831853455.txt',
  },
  solotveg: {
    alias: 'solotveg',
    defaultEmail: 'solotveg@gmail.com',
    envEmail: ['ST_EMAIL_TEEN', 'STREMIO_EMAIL_TEEN'],
    envPass: ['ST_PASS_TEEN', 'STREMIO_PASS_TEEN'],
    localCredFile: null,
  },
  stremiojn: {
    alias: 'stremiojn',
    defaultEmail: 'stremiojn@gmail.com',
    envEmail: ['ST_EMAIL_JN', 'STREMIO_EMAIL_JN'],
    envPass: ['ST_PASS_JN', 'STREMIO_PASS_JN'],
    localCredFile: null,
  },
};

export const CINEMETA_TRANSPORT_URL = 'https://v3-cinemeta.strem.io/manifest.json';

export function getCanonicalHubTransportUrl(version = '1.4.2') {
  return `https://mejorastremio-hub.pabloeckert.deno.net/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,nekobt,rutor,rutracker,comando,bludv,micoleaodublado,torrent9,ilcorsaronero,mejortorrent,wolfmax4k,cinecalidad,besttorrents|sort=seeders|qualityfilter=brremux,hdrall,dolbyvision,dolbyvisionwithhdr,threed,cam,scr,unknown,4k,480p|torbox=9fe5c202-15ec-4aeb-b4e7-8613728cf044|language=latino/manifest.json?v=${version}`;
}

export function resolveAccountCredentials(targetKey = 'eg', cliEmail = null, cliPass = null) {
  const normKey = (targetKey || 'eg').toLowerCase();
  let key = null;
  if (normKey === 'solotveg' || normKey === 'teen') key = 'solotveg';
  else if (normKey === 'stremiojn' || normKey === 'jn') key = 'stremiojn';
  else if (normKey === 'eg' || normKey === 'stremioeg') key = 'eg';
  else {
    throw new Error(`Cuenta desconocida: "${targetKey}". Opciones válidas: eg, solotveg, stremiojn, all`);
  }

  const cfg = ACCOUNTS_CONFIG[key];

  let email = cliEmail;
  if (!email) {
    for (const envVar of cfg.envEmail) {
      if (process.env[envVar]) {
        email = process.env[envVar];
        break;
      }
    }
  }
  if (!email) email = cfg.defaultEmail;

  let pass = cliPass;
  if (!pass) {
    for (const envVar of cfg.envPass) {
      if (process.env[envVar]) {
        pass = process.env[envVar];
        break;
      }
    }
  }

  if (!pass && cfg.localCredFile && existsSync(cfg.localCredFile)) {
    try {
      const rawLines = readFileSync(cfg.localCredFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      pass = rawLines.length > 1 ? rawLines[1] : rawLines[0];
    } catch {
      // Ignorar error de lectura local
    }
  }

  return { key, alias: cfg.alias, email, pass };
}

export async function handleRollback(authKey, accountAlias, rollbackLast, rollbackFile, isDryRun) {
  let targetFile = rollbackFile;
  if (rollbackLast) {
    if (!existsSync(BACKUPS)) {
      throw new Error(`No existe el directorio de backups: ${BACKUPS}`);
    }
    const files = readdirSync(BACKUPS)
      .filter((f) => (f.startsWith(`backup-${accountAlias}-`) || f.startsWith('backup-stremioeg-')) && f.endsWith('.json'))
      .map((f) => ({ name: f, path: join(BACKUPS, f), mtime: statSync(join(BACKUPS, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (!files.length) {
      throw new Error(`No se encontraron backups para ${accountAlias} en ${BACKUPS}`);
    }
    targetFile = files[0].path;
  }

  if (!targetFile || !existsSync(targetFile)) {
    throw new Error(`Archivo de backup no encontrado: ${targetFile}`);
  }

  console.log(`\n[ ROLLBACK ] Restaurando estado de ${accountAlias} desde: ${targetFile}`);
  const raw = JSON.parse(readFileSync(targetFile, 'utf8'));
  const restoredAddons = Array.isArray(raw) ? raw : (raw.addons || raw.result?.addons || []);

  if (!restoredAddons.length) {
    throw new Error('El backup seleccionado no contiene addons válidos');
  }

  console.log(`  • Add-ons a restaurar: ${restoredAddons.length}`);
  restoredAddons.forEach((a, i) => console.log(`    ${i}. [${a.manifest?.id || a.id}] ${a.manifest?.name || a.name}`));

  if (isDryRun) {
    console.log('\n  ℹ MODO DRY-RUN: Para aplicar rollback en vivo, agregar --apply');
    return { success: true, dryRun: true, restoredCount: restoredAddons.length };
  }

  const guardOk = await assertNoFrozenEmptyCatalogs(restoredAddons, ['com.mejorastremio.hub', 'com.linvo.cinemeta']);
  if (!guardOk) {
    throw new Error('Abortado por guard anti-catálogos-congelados');
  }

  const saveRes = await apiPost('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: restoredAddons });
  if (!saveRes?.result?.success && !saveRes?.result) {
    throw new Error(`Falló addonCollectionSet durante rollback: ${JSON.stringify(saveRes)}`);
  }
  console.log(`✓ Rollback aplicado exitosamente en la cuenta ${accountAlias}.`);
  return { success: true, dryRun: false, restoredCount: restoredAddons.length };
}

export async function unifySingleAccount(accountCreds, options = {}) {
  const {
    dryRun = true,
    version = '1.4.2',
    rollbackLast = false,
    rollbackFile = null,
  } = options;

  const { key, alias, email, pass } = accountCreds;

  console.log('\n' + '═'.repeat(75));
  console.log(` MejoraStremio — Purga Atómica Total: [${alias.toUpperCase()}] (${email})`);
  console.log(` Versión Hub: v${version} | Modo: ${dryRun ? 'DRY-RUN (Simulación)' : 'APPLY (En Producción Real)'}`);
  console.log('═'.repeat(75));

  if (!pass) {
    const msg = `Credenciales faltantes para ${alias} (${email}). Se requiere contraseña (ST_PASS_${alias.toUpperCase()} o similar).`;
    console.warn(`  ⚠️ ADVERTENCIA: ${msg}`);
    return { success: false, skipped: true, error: msg, alias };
  }

  console.log(`\n[1/4] Autenticando en la API de Stremio como ${email}...`);
  const authKey = await stremioLogin(email, pass);
  console.log('  ✓ Autenticación exitosa (authKey obtenida)');

  if (rollbackLast || rollbackFile) {
    return await handleRollback(authKey, alias, rollbackLast, rollbackFile, dryRun);
  }

  // 1. Obtener addons actuales
  const col = await apiPost('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true });
  const currentAddons = col?.result?.addons || [];
  console.log(`\n[2/4] Estado actual de la cuenta: ${currentAddons.length} addons instalados`);
  currentAddons.forEach((a, i) => {
    console.log(`  ${String(i).padStart(2)}. [${a.manifest?.id || '?'}] ${a.manifest?.name || '?'} (v${a.manifest?.version || '?'})`);
  });

  // 2. Fetch fresco del manifest del Hub Unificado
  const hubUrl = getCanonicalHubTransportUrl(version);
  console.log('\n[3/4] Preparando especificación atónica canónica (2 ADDONS)...');
  console.log(`  • Obteniendo manifest en vivo de MejoraStremio Hub: ${hubUrl}`);
  const hubRes = await fetch(hubUrl, { signal: AbortSignal.timeout(15000) });
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
      transportUrl: hubUrl,
      transportName: '',
      manifest: hubManifest,
      flags: { official: false, protected: false },
    },
    cinemetaAddon,
  ];

  // 3. Diff Visual Estructurado
  console.log('\n' + '─'.repeat(75));
  console.log(` TABLA DE TRANSFORMACIÓN ATÓMICA DE PRODUCCIÓN [${alias.toUpperCase()}]:`);
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
  console.log('  ✓ Invariantes validadas (2 addons, orden [Hub, Cinemeta], catálogos íntegros)');

  if (dryRun) {
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(` ℹ MODO DRY-RUN COMPLETADO PARA ${alias.toUpperCase()}: 0 mutaciones en la API.`);
    console.log(' Para aplicar la mutación en producción, ejecutá con --apply');
    console.log('══════════════════════════════════════════════════════════════════════');
    return {
      success: true,
      dryRun: true,
      alias,
      removedCount: removedAddons.length,
      targetCount: 2,
    };
  }

  // 5. Aplicar con Snapshot Atómico Previo
  mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = join(BACKUPS, `backup-${alias}-pre-purge-atomic-${stamp}.json`);
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

  console.log(`\n  Colección final en vivo en Stremio [${alias.toUpperCase()}]: ${verifiedAddons.length} addons`);
  verifiedAddons.forEach((a, i) => {
    console.log(`    [${i}] ${a.manifest?.name} (${a.manifest?.id}) — v${a.manifest?.version} — ${(a.manifest?.catalogs || []).length} catálogos`);
  });

  if (verifiedAddons.length !== 2) {
    throw new Error(`ADVERTENCIA: Se esperaban 2 addons, pero se encontraron ${verifiedAddons.length}`);
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(` ✨ PURGA ATÓMICA FINALIZADA CON ÉXITO: ${alias.toUpperCase()}`);
  console.log(' Addons canónicos activos:');
  console.log('   #0: MejoraStremio Hub (TorBox Latino + Subtítulos IA + SmartSync)');
  console.log('   #1: Cinemeta');
  console.log('══════════════════════════════════════════════════════════════════════');

  return {
    success: true,
    dryRun: false,
    alias,
    removedCount: removedAddons.length,
    targetCount: 2,
    verifiedAddons,
  };
}

// ── Ejecución CLI ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const ROLLBACK_LAST = args.includes('--rollback-last');
  const rbIdx = args.indexOf('--rollback');
  const ROLLBACK_FILE = rbIdx >= 0 ? args[rbIdx + 1] : null;
  const DRY_RUN = !APPLY && !ROLLBACK_LAST && !ROLLBACK_FILE;

  const BASELINE_V141 = args.includes('--baseline-v141') || args.includes('--v141');
  const targetVersion = BASELINE_V141 ? '1.4.1' : '1.4.2';

  const accIdx = args.indexOf('--account');
  const accountArg = accIdx >= 0 ? args[accIdx + 1] : 'eg';

  const emailIdx = args.indexOf('--email');
  const cliEmail = emailIdx >= 0 ? args[emailIdx + 1] : null;

  const passIdx = args.indexOf('--pass');
  const cliPass = passIdx >= 0 ? args[passIdx + 1] : null;

  const options = {
    dryRun: DRY_RUN,
    version: targetVersion,
    rollbackLast: ROLLBACK_LAST,
    rollbackFile: ROLLBACK_FILE,
  };

  if (accountArg === 'all') {
    const targets = ['eg', 'solotveg', 'stremiojn'];
    const results = [];
    for (const tgt of targets) {
      try {
        const creds = resolveAccountCredentials(tgt, cliEmail, cliPass);
        const res = await unifySingleAccount(creds, options);
        results.push(res);
      } catch (err) {
        console.error(`✗ Error procesando ${tgt}:`, err.message || err);
        results.push({ success: false, alias: tgt, error: err.message });
      }
    }
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log(' RESUMEN MULTI-CUENTA:');
    results.forEach((r) => {
      const status = r.success ? (r.dryRun ? 'DRY-RUN OK' : 'MUTADO OK') : (r.skipped ? 'OMITIDO (Sin pass)' : 'ERROR');
      console.log(`  • ${r.alias}: ${status}`);
    });
    console.log('══════════════════════════════════════════════════════════════════════');
  } else {
    const creds = resolveAccountCredentials(accountArg, cliEmail, cliPass);
    await unifySingleAccount(creds, options);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('\n✗ ERROR FATAL EN PURGA ATÓMICA:', err.message || err);
    process.exit(1);
  });
}
