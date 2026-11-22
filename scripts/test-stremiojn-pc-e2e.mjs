#!/usr/bin/env node
/**
 * scripts/test-stremiojn-pc-e2e.mjs
 *
 * SUITE INTEGRAL E2E (5 FASES) — STREMIO 5 WINDOWS PC + PERFIL UFC/COMBATE (stremiojn@gmail.com)
 *
 * Fases auditadas:
 *   Fase 1: Entorno PC Windows, binarios Stremio 5 (libmpv-2/ffprobe/runtime), procesos vivos y server-settings.
 *   Fase 2: WebView2 LevelDB Local Storage (SSTable Snappy + WAL + UTF-16LE) para stremiojn@gmail.com.
 *   Fase 3: Paridad Stremio Cloud 1:1 y aislamiento estricto de stremioeg@gmail.com.
 *   Fase 4: Deno Deploy — Manifiesto 42 catálogos UFC, 7 catálogos nuevos, filtro INCAA, Para vos UFC y Live TV.
 *   Fase 5: Reproducción real PC (PPV UFC, Warrior, Smashing Machine, TUF/Kingdom), byte-range, ffprobe.exe,
 *           descarga y parseo SRT sin SDH, Tráilers Latino y sonda HLS real de TV en Vivo UFC/Combate.
 *
 * Node >= 20, sin dependencias externas. Nunca imprime contraseñas, authKeys ni tokens de TorBox.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './lib/env.mjs';
import {
  isCachedStream,
  isLatinoStream,
  parseSrtToCues,
} from './lib/addon-signals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROD_HUB = (process.env.HUB_URL || 'https://mejorastremio-hub.pabloeckert.deno.net').replace(/\/$/, '');
const RUNTIME_URL = 'http://127.0.0.1:11470';

const LOCAL_STREMIO_DIR = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Stremio');
const LEVELDB_DIR = path.join(
  LOCAL_STREMIO_DIR,
  'stremio-shell-ng.exe.WebView2',
  'EBWebView',
  'Default',
  'Local Storage',
  'leveldb',
);
const SERVER_SETTINGS_PATH = path.join(
  process.env.APPDATA || '',
  'stremio',
  'stremio-server',
  'server-settings.json',
);

const results = { passed: 0, failed: 0, advisories: [], phases: [] };
let currentPhase = null;

function startPhase(name) {
  currentPhase = { name, passed: 0, failed: 0 };
  results.phases.push(currentPhase);
  console.log(`\n── ${name} ${'─'.repeat(Math.max(4, 74 - name.length))}`);
}

function check(label, ok, detail = '') {
  if (ok) {
    results.passed++;
    if (currentPhase) currentPhase.passed++;
    console.log(`  ✓ [PASS] ${label}${detail ? ` (${detail})` : ''}`);
  } else {
    results.failed++;
    if (currentPhase) currentPhase.failed++;
    console.error(`  ✗ [FAIL] ${label}${detail ? ` (${detail})` : ''}`);
  }
  return Boolean(ok);
}

function advisory(msg) {
  results.advisories.push(msg);
  console.log(`  ℹ [AVISO] ${msg}`);
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...options });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { res, status: res.status, ok: res.ok, data, text };
}

function hasValidVideoMagic(buf) {
  if (!buf || buf.length < 12) return { ok: false, kind: 'too-short' };
  const hex4 = buf.subarray(0, 4).toString('hex');
  if (hex4 === '1a45dfa3') return { ok: true, kind: 'EBML/MKV/WebM' };
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return { ok: true, kind: 'ISO-BMFF/MP4' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'AVI ') {
    return { ok: true, kind: 'AVI' };
  }
  if (buf[0] === 0x47 && buf.length >= 189 && buf[188] === 0x47) return { ok: true, kind: 'MPEG-TS' };
  const headText = buf.subarray(0, 200).toString('utf8').trimStart().toLowerCase();
  if (headText.startsWith('<!doctype') || headText.startsWith('<html') || headText.startsWith('{')) {
    return { ok: false, kind: `non-media(${headText.slice(0, 40)})` };
  }
  return { ok: false, kind: `unknown(${buf.subarray(0, 8).toString('hex')})` };
}

// ── Decodificador LevelDB Chromium (SSTable Snappy + WAL + UTF-16LE) ─────────

function unsnappy(src) {
  let pos = 0;
  let len = 0;
  let shift = 0;
  while (pos < src.length) {
    const b = src[pos++];
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  if (len <= 0 || len > 16 * 1024 * 1024) return null;
  const out = Buffer.allocUnsafe(len);
  let op = 0;
  while (pos < src.length && op < len) {
    const tag = src[pos++];
    const type = tag & 0x03;
    if (type === 0) {
      let l = (tag >> 2) + 1;
      if (l > 60) {
        const extra = l - 60;
        l = 0;
        for (let i = 0; i < extra; i++) l |= src[pos++] << (8 * i);
        l += 1;
      }
      if (pos + l > src.length || op + l > out.length) return null;
      src.copy(out, op, pos, pos + l);
      pos += l;
      op += l;
    } else {
      let l;
      let off;
      if (type === 1) {
        l = ((tag >> 2) & 0x07) + 4;
        off = ((tag & 0xe0) << 3) | src[pos++];
      } else if (type === 2) {
        l = (tag >> 2) + 1;
        off = src[pos++] | (src[pos++] << 8);
      } else {
        l = (tag >> 2) + 1;
        off = src[pos++] | (src[pos++] << 8) | (src[pos++] << 16) | (src[pos++] << 24);
      }
      if (off === 0 || op - off < 0 || op + l > out.length) return null;
      for (let i = 0; i < l; i++) out[op + i] = out[op - off + i];
      op += l;
    }
  }
  return op === len ? out : null;
}

function readVarint64(b, o) {
  let val = 0;
  let s = 0;
  while (o < b.length) {
    const byte = b[o++];
    val += (byte & 0x7f) * (2 ** s);
    if ((byte & 0x80) === 0) return [val, o];
    s += 7;
  }
  return [val, o];
}

function parseSstBlock(blk, handler) {
  if (!blk || blk.length < 4) return;
  const numRestarts = blk.readUInt32LE(blk.length - 4);
  const end = blk.length - 4 - numRestarts * 4;
  let k = 0;
  let lastKey = Buffer.alloc(0);
  while (k < end) {
    let sh;
    let ns;
    let vl;
    [sh, k] = readVarint64(blk, k);
    [ns, k] = readVarint64(blk, k);
    [vl, k] = readVarint64(blk, k);
    const key = Buffer.concat([lastKey.subarray(0, sh), blk.subarray(k, k + ns)]);
    lastKey = key;
    k += ns;
    const val = blk.subarray(k, k + vl);
    k += vl;
    handler(key, val);
  }
}

function readSafeFile(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    const tmp = path.join(process.env.TEMP || ROOT, `ldb_ro_${Date.now()}_${path.basename(filePath)}`);
    fs.copyFileSync(filePath, tmp);
    try {
      return fs.readFileSync(tmp);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // Ignorar limpieza temporal
      }
    }
  }
}

function readWebView2Profiles() {
  const entries = [];
  if (!fs.existsSync(LEVELDB_DIR)) return entries;

  const files = fs.readdirSync(LEVELDB_DIR);
  for (const fname of files) {
    const full = path.join(LEVELDB_DIR, fname);
    if (fname.endsWith('.ldb')) {
      const buf = readSafeFile(full);
      if (buf.length < 48) continue;
      const ft = buf.subarray(buf.length - 48);
      if (ft.readUInt32LE(40) !== 0x8b80fb57 || ft.readUInt32LE(44) !== 0xdb477524) continue;
      let p1;
      let p2;
      [, p1] = readVarint64(ft, 0);
      [, p2] = readVarint64(ft, p1);
      const [io, p3] = readVarint64(ft, p2);
      const [is] = readVarint64(ft, p3);
      const dec = (o, s) => {
        if (o + s + 1 > buf.length) return null;
        const t = buf[o + s];
        const r = buf.subarray(o, o + s);
        return t === 0 ? r : t === 1 ? unsnappy(r) : null;
      };
      parseSstBlock(dec(io, is), (_k, handle) => {
        const [bo, h1] = readVarint64(handle, 0);
        const [bs] = readVarint64(handle, h1);
        parseSstBlock(dec(bo, bs), (ik, val) => {
          if (ik.length < 8) return;
          const uk = ik.subarray(0, ik.length - 8);
          const ts = ik.subarray(ik.length - 8);
          if (ts[0] !== 1) return;
          const seq = Number(ts.readBigUInt64LE(0) >> 8n);
          const ks = uk.toString('latin1');
          if (ks === '_https://web.stremio.com\x00\x01profile' && val.length > 1) {
            const txt = val[0] === 0 ? val.subarray(1).toString('utf16le') : val.subarray(1).toString('utf8');
            try {
              entries.push({ file: fname, seq, key: ks, data: JSON.parse(txt) });
            } catch {
              // Ignorar registro corrupto
            }
          }
        });
      });
    } else if (fname.endsWith('.log')) {
      const buf = readSafeFile(full);
      const BLOCK = 32768;
      const batches = [];
      let pending = [];
      for (let off = 0; off < buf.length; off += BLOCK) {
        const bEnd = Math.min(buf.length, off + BLOCK);
        let pos = off;
        while (pos + 7 <= bEnd) {
          const len = buf.readUInt16LE(pos + 4);
          const type = buf[pos + 6];
          if (type === 0 || pos + 7 + len > bEnd) break;
          const payload = buf.subarray(pos + 7, pos + 7 + len);
          pos += 7 + len;
          if (type === 1) batches.push(payload);
          else if (type === 2) pending = [payload];
          else if (type === 3) pending.push(payload);
          else if (type === 4) {
            pending.push(payload);
            batches.push(Buffer.concat(pending));
            pending = [];
          }
        }
      }
      for (const batch of batches) {
        if (batch.length < 12) continue;
        const seq = batch.readUInt32LE(0) + batch.readUInt32LE(4) * 4294967296;
        const count = batch.readUInt32LE(8);
        let p = 12;
        for (let i = 0; i < count && p < batch.length; i++) {
          const tag = batch[p++];
          let klen;
          let vlen;
          [klen, p] = readVarint64(batch, p);
          const key = batch.subarray(p, p + klen);
          p += klen;
          if (tag === 1) {
            [vlen, p] = readVarint64(batch, p);
            const val = batch.subarray(p, p + vlen);
            p += vlen;
            const ks = key.toString('latin1');
            if (ks === '_https://web.stremio.com\x00\x01profile' && val.length > 1) {
              const txt = val[0] === 0 ? val.subarray(1).toString('utf16le') : val.subarray(1).toString('utf8');
              try {
                entries.push({ file: fname, seq, key: ks, data: JSON.parse(txt) });
              } catch {
                // Ignorar registro parcial
              }
            }
          }
        }
      }
    }
  }
  entries.sort((a, b) => a.seq - b.seq);
  return entries;
}

function runFfprobe(url, timeoutMs = 18000, quiet = false) {
  const ffprobePath = path.join(LOCAL_STREMIO_DIR, 'ffprobe.exe');
  const args = [
    '-v',
    quiet ? 'quiet' : 'error',
    '-analyzeduration',
    '4000000',
    '-probesize',
    '3000000',
    '-show_entries',
    'stream=codec_type,codec_name,width,height',
    '-of',
    'json',
    url,
  ];
  const raw = execFileSync(ffprobePath, args, {
    timeout: timeoutMs,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

console.log('═'.repeat(80));
console.log('  🥊 SUITE INTEGRAL E2E (5 FASES) — STREMIO 5 WINDOWS PC · stremiojn@gmail.com');
console.log(`  Hub Producción: ${PROD_HUB}`);
console.log(`  Runtime Local:  ${RUNTIME_URL}`);
console.log('═'.repeat(80));

// ═════════════════════════════════════════════════════════════════════════════
// FASE 1: Entorno PC & Streaming Runtime
// ═════════════════════════════════════════════════════════════════════════════
startPhase('FASE 1: Entorno PC & Streaming Runtime Local');

const binaries = ['stremio-shell-ng.exe', 'stremio-runtime.exe', 'libmpv-2.dll', 'ffprobe.exe'];
for (const bin of binaries) {
  const full = path.join(LOCAL_STREMIO_DIR, bin);
  check(`Binario Stremio 5 PC presente: ${bin}`, fs.existsSync(full), full);
}

let procs = [];
try {
  const raw = execSync(
    'powershell -NoProfile -Command "Get-Process stremio* -ErrorAction SilentlyContinue | Select-Object Name,Id | ConvertTo-Json"',
    { encoding: 'utf8', timeout: 8000 },
  ).trim();
  const parsed = raw ? JSON.parse(raw) : [];
  procs = Array.isArray(parsed) ? parsed : [parsed];
} catch {
  procs = [];
}
const procNames = procs.map((p) => String(p.Name || '').toLowerCase());
check('Proceso vivo: stremio-shell-ng', procNames.includes('stremio-shell-ng'));
check('Proceso vivo: stremio-runtime', procNames.includes('stremio-runtime'));

const rtRes = await fetchJson(`${RUNTIME_URL}/settings`, {}, 8000);
const rtVals = rtRes.data?.values || {};
check('Streaming Runtime HTTP 200 (/settings)', rtRes.status === 200 && Boolean(rtRes.data?.values), `v${rtVals.serverVersion || '?'}`);
check('Runtime cacheSize == 5 GB (5368709120)', rtVals.cacheSize === 5368709120, `actual=${rtVals.cacheSize}`);
check('Runtime btMaxConnections == 120', rtVals.btMaxConnections === 120, `actual=${rtVals.btMaxConnections}`);
check('Runtime btDownloadSpeedSoftLimit == 10 MB/s', rtVals.btDownloadSpeedSoftLimit === 10485760, `actual=${rtVals.btDownloadSpeedSoftLimit}`);
check('Runtime btDownloadSpeedHardLimit == 20 MB/s', rtVals.btDownloadSpeedHardLimit === 20971520, `actual=${rtVals.btDownloadSpeedHardLimit}`);
check('Runtime transcodeMaxWidth == 1920 (FullHD PC)', rtVals.transcodeMaxWidth === 1920, `actual=${rtVals.transcodeMaxWidth}`);
check('Runtime localAddonEnabled == false & remoteHttps == ""', rtVals.localAddonEnabled === false && rtVals.remoteHttps === '');

let diskSettings = null;
if (fs.existsSync(SERVER_SETTINGS_PATH)) {
  try {
    diskSettings = JSON.parse(fs.readFileSync(SERVER_SETTINGS_PATH, 'utf8'));
  } catch {
    diskSettings = null;
  }
}
check(
  'Persistencia 1:1 en server-settings.json',
  Boolean(diskSettings) &&
    diskSettings.cacheSize === rtVals.cacheSize &&
    diskSettings.btMaxConnections === rtVals.btMaxConnections &&
    diskSettings.transcodeMaxWidth === rtVals.transcodeMaxWidth,
  SERVER_SETTINGS_PATH,
);

const profileJsonPath = path.join(ROOT, 'cuentas', 'stremiojn', 'profile.json');
const profileJson = JSON.parse(fs.readFileSync(profileJsonPath, 'utf8'));
const pcOpt = profileJson?.rules?.playerOptimization || {};
check(
  'cuentas/stremiojn/profile.json orientado a PC Windows',
  String(profileJson.deviceTarget || '').includes('PC Windows') &&
    String(pcOpt.target || '').includes('Windows PC') &&
    pcOpt.hardwareDecoding === true &&
    pcOpt.audioPassthrough === false &&
    pcOpt.frameRateMatchingStrategy === 'Disabled' &&
    pcOpt.streamingServer?.cacheSizeBytes === 5368709120,
  `deviceTarget="${profileJson.deviceTarget}"`,
);

// ═════════════════════════════════════════════════════════════════════════════
// FASE 2: WebView2 LevelDB Local State
// ═════════════════════════════════════════════════════════════════════════════
startPhase('FASE 2: WebView2 LevelDB Local Storage (stremiojn@gmail.com)');

const ldbProfiles = readWebView2Profiles();
check('Registros de perfil decodificados en WebView2 LevelDB', ldbProfiles.length > 0, `total=${ldbProfiles.length}`);
const latestProfileSnap = ldbProfiles[ldbProfiles.length - 1] || null;
const localProfile = latestProfileSnap?.data || {};
const localAddons = Array.isArray(localProfile.addons) ? localProfile.addons : [];

check(
  'Sesión activa local == stremiojn@gmail.com',
  localProfile.auth?.user?.email === 'stremiojn@gmail.com',
  `SEQ=${latestProfileSnap?.seq} (${latestProfileSnap?.file})`,
);
check('addonsLocked == false (colección desbloqueada)', localProfile.addonsLocked === false, `addonsLocked=${localProfile.addonsLocked}`);
check('4 add-ons canónicos sincronizados en PC', localAddons.length === 4, localAddons.map((a) => a.manifest?.id).join(', '));

const localHub = localAddons.find((a) => a.manifest?.id === 'com.mejorastremio.hub');
const localLivetv = localAddons.find((a) => a.manifest?.id === 'com.mejorastremio.livetv');
const localTrailers = localAddons.find((a) => a.manifest?.id === 'com.mejorastremio.trailers-latino');
const localCinemeta = localAddons.find((a) => a.manifest?.id === 'com.linvo.cinemeta');

check('Hub local v3.4.0 con 42 catálogos UFC', localHub?.manifest?.version === '3.4.0' && (localHub?.manifest?.catalogs?.length || 0) === 42, `cats=${localHub?.manifest?.catalogs?.length}`);
check('TV en Vivo local v1.2.0 con 1 catálogo', localLivetv?.manifest?.version === '1.2.0' && (localLivetv?.manifest?.catalogs?.length || 0) === 1);
check('Tráilers Oficiales Latino v1.0.0 & Cinemeta v3.0.14 presentes', localTrailers?.manifest?.version === '1.0.0' && localCinemeta?.manifest?.version === '3.0.14');

const localAllJson = JSON.stringify(localAddons);
for (const marker of ['ufc-eventos', 'ufc-series-hub', 'cine-ufc-mma', 'livetv-combate', 'saga-marvel', 'stream-netflix']) {
  check(`Marcador presente en colección local: ${marker}`, localAllJson.includes(marker));
}

const ls = localProfile.settings || {};
check(
  'profile.settings de escritorio PC validados',
  ls.hardwareDecoding === true &&
    ls.streamingServerUrl === 'http://127.0.0.1:11470/' &&
    ls.audioPassthrough === false &&
    ls.frameRateMatchingStrategy === 'Disabled' &&
    ls.escExitFullscreen === true &&
    ls.bingeWatching === true,
  `hwDecode=${ls.hardwareDecoding}, passthrough=${ls.audioPassthrough}, afr=${ls.frameRateMatchingStrategy}`,
);

if (ls.interfaceLanguage === 'eng' || ls.audioLanguage === 'eng' || ls.subtitlesLanguage === 'eng') {
  advisory(
    `Ajustes de idioma locales en Stremio 5 PC siguen en '${ls.interfaceLanguage}/${ls.audioLanguage}/${ls.subtitlesLanguage}'. Recomendar en Ajustes: Interfaz Español, Audio Español, Subtítulos Español (América Latina).`,
  );
}

// Extract sanitized base Hub config segment for Phase 5 stream/subtitle probes (zero printing of secrets)
const rawHubTransport = String(localHub?.transportUrl || '');
const cfgMatch = rawHubTransport.match(/^https?:\/\/[^/]+\/([^/]+)\/manifest\.json/);
const HUB_CFG_PATH = cfgMatch ? `${PROD_HUB}/${cfgMatch[1]}` : `${PROD_HUB}/profile=stremiojn`;

// ═════════════════════════════════════════════════════════════════════════════
// FASE 3: Stremio Cloud Parity & Multi-Account Isolation
// ═════════════════════════════════════════════════════════════════════════════
startPhase('FASE 3: Paridad Stremio Cloud y Aislamiento Multi-Cuenta');

async function stremioCloudReadonly(email, password) {
  const login = await fetchJson('https://api.strem.io/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: null, email, password }),
  });
  const authKey = login.data?.result?.authKey;
  if (!authKey) return { ok: false, error: 'login failed' };
  const col = await fetchJson('https://api.strem.io/api/addonCollectionGet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'AddonCollectionGet', authKey, update: false }),
  });
  return {
    ok: Boolean(col.data?.result?.addons),
    userLastModified: login.data?.result?.user?.lastModified,
    colLastModified: col.data?.result?.lastModified,
    addons: col.data?.result?.addons || [],
  };
}

const jnEmail = process.env.ST_EMAIL_JN || 'stremiojn@gmail.com';
const jnPass = process.env.ST_PASS_JN || process.env.STREMIO_PASS_JN || '';
const egEmail = process.env.ST_EMAIL_EG || 'stremioeg@gmail.com';
const egPass = process.env.ST_PASS_EG || process.env.STREMIO_PASS_EG || '';

const jnCloud = jnPass ? await stremioCloudReadonly(jnEmail, jnPass) : { ok: false, error: 'missing env ST_PASS_JN' };
check('Login + addonCollectionGet(update:false) en stremiojn@gmail.com', jnCloud.ok, `addons=${jnCloud.addons?.length}`);

const cloudIds = (jnCloud.addons || []).map((a) => `${a.manifest?.id}@${a.manifest?.version}:${a.manifest?.catalogs?.length ?? 0}`);
const localIds = localAddons.map((a) => `${a.manifest?.id}@${a.manifest?.version}:${a.manifest?.catalogs?.length ?? 0}`);
check(
  'Paridad 1:1 entre nube stremiojn y LevelDB local PC',
  cloudIds.length === 4 && JSON.stringify(cloudIds) === JSON.stringify(localIds),
  cloudIds.join(' | '),
);
check(
  'Transport URL del Hub en nube incluye profile=stremiojn',
  String(jnCloud.addons?.[0]?.transportUrl || '').includes('profile=stremiojn'),
);

const egCloud = egPass ? await stremioCloudReadonly(egEmail, egPass) : { ok: false, error: 'missing env ST_PASS_EG' };
check(
  'Aislamiento estricto: stremioeg@gmail.com intacta (3 add-ons, 39 catálogos)',
  egCloud.ok &&
    egCloud.addons.length === 3 &&
    egCloud.addons[0]?.manifest?.catalogs?.length === 39 &&
    egCloud.colLastModified === '2026-11-20T02:03:24.009Z' &&
    egCloud.userLastModified === '2026-11-20T19:56:54.715Z',
  `colLM=${egCloud.colLastModified}`,
);

// ═════════════════════════════════════════════════════════════════════════════
// FASE 4: Deno Deploy Catalogs, INCAA Filter, AI 'Para vos' & Live TV
// ═════════════════════════════════════════════════════════════════════════════
startPhase('FASE 4: Deno Deploy — Catálogos UFC, Filtro INCAA, Para vos y Live TV');

const health = await fetchJson(`${PROD_HUB}/health`);
check('GET /health HTTP 200', health.status === 200);

const mJn = await fetchJson(`${PROD_HUB}/manifest.json?profile=stremiojn`);
const jnCats = mJn.data?.catalogs || [];
const jnHome = jnCats.filter((c) => !(c.extra || []).some((e) => e.name === 'genre' && e.isRequired === true));
const jnDisc = jnCats.filter((c) => (c.extra || []).some((e) => e.name === 'genre' && e.isRequired === true));
const jnSlashOpts = jnCats.flatMap((c) => (c.extra || []).flatMap((e) => e.options || [])).filter((o) => String(o).includes('/'));
const jnKidsHome = jnHome.filter((c) => /infantil|familia|dibujo|kids/i.test(`${c.id} ${c.name}`));

check('GET /manifest.json?profile=stremiojn -> 42 catálogos (14 Home, 28 Discover)', jnCats.length === 42 && jnHome.length === 14 && jnDisc.length === 28);
check('Sin filas infantiles en Home stremiojn', jnKidsHome.length === 0);
check('Cero "/" prohibidos en extra.options', jnSlashOpts.length === 0);

const mEg = await fetchJson(`${PROD_HUB}/manifest.json`);
check('GET /manifest.json default (stremioeg) intacto -> 39 catálogos', (mEg.data?.catalogs || []).length === 39);

let ufcEventsMetas = [];
for (const [tp, cid] of [
  ['movie', 'ufc-eventos'],
  ['series', 'ufc-series-hub'],
  ['movie', 'cine-ufc-mma'],
  ['movie', 'accion-adrenalina'],
  ['movie', 'thriller-policial'],
  ['movie', 'combat-boxeo'],
  ['movie', 'combat-motor-deportes'],
]) {
  const cat = await fetchJson(`${PROD_HUB}/profile=stremiojn/catalog/${tp}/${cid}.json`, {}, 20000);
  const metas = cat.data?.metas || [];
  const valid = metas.filter((m) => String(m.id || '').startsWith('tt') && String(m.poster || '').startsWith('http'));
  check(`Catálogo UFC/Combate ${tp}/${cid} -> 25 metas válidos`, cat.status === 200 && metas.length === 25 && valid.length === 25, `valid=${valid.length}/${metas.length}`);
  if (cid === 'ufc-eventos') ufcEventsMetas = metas;
}

const incaa = await fetchJson(`${PROD_HUB}/profile=stremiojn/catalog/movie/accion-adrenalina/genre=%2B16%20%C2%B7%20Mayores%20de%2016.json`, {}, 20000);
check('Filtro compuesto INCAA (+16 · Mayores de 16) en accion-adrenalina', incaa.status === 200 && (incaa.data?.metas || []).length > 0, `metas=${(incaa.data?.metas || []).length}`);

for (const tp of ['movie', 'series']) {
  const pv = await fetchJson(`${PROD_HUB}/profile=stremiojn/catalog/${tp}/para-vos.json`, {}, 20000);
  const metas = pv.data?.metas || [];
  const kidsLeak = metas.filter((m) => /santa paws|peppa|paw patrol|frozen|scooby|donna reed|father knows/i.test(`${m.name} ${m.description || ''}`));
  check(`IA 'Para vos' (${tp}) activo sin fallback infantil/navideño`, pv.status === 200 && metas.length >= 10 && kidsLeak.length === 0, `metas=${metas.length}, top="${metas[0]?.name}"`);
}

const ltvCat = await fetchJson(`${PROD_HUB}/livetv/catalog/tv/livetv-combate.json`);
check('Catálogo TV en Vivo Combate -> 17 canales', ltvCat.status === 200 && (ltvCat.data?.metas || []).length === 17);

// ═════════════════════════════════════════════════════════════════════════════
// FASE 5: Reproducción Real PC (TorBox Bytes, ffprobe.exe, SRT sin SDH, Tráilers, Live TV)
// ═════════════════════════════════════════════════════════════════════════════
startPhase('FASE 5: Reproducción Real PC, ffprobe.exe, Subtítulos, Tráilers y TV en Vivo');

// 5.1 PPV dinámico UFC desde ufc-eventos
const ppvCandidates = ufcEventsMetas.filter((m) => /\bUFC\s+\d+/i.test(m.name || '')).slice(0, 8);
let ppvMatched = null;
let ppvTopStream = null;
for (const ev of ppvCandidates) {
  const stRes = await fetchJson(`${HUB_CFG_PATH}/stream/movie/${ev.id}.json`, {}, 20000);
  const cached = (stRes.data?.streams || []).filter((s) => isCachedStream(s) && s.url);
  if (cached.length > 0) {
    ppvMatched = ev;
    ppvTopStream = cached[0];
    break;
  }
}
check('Evento PPV UFC dinámico con stream TorBox cacheado', Boolean(ppvMatched && ppvTopStream), ppvMatched ? `${ppvMatched.name} (${ppvMatched.id})` : 'none');

if (ppvTopStream?.url) {
  const rangeRes = await fetch(ppvTopStream.url, {
    headers: { Range: 'bytes=0-65535' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const magic = hasValidVideoMagic(Buffer.from(await rangeRes.arrayBuffer()));
  check(`Byte-Range contenedor video real PPV (${ppvMatched.name})`, (rangeRes.status === 200 || rangeRes.status === 206) && magic.ok, `HTTP ${rangeRes.status}, ${magic.kind}`);
}

// 5.2 Warrior (tt1291584) — Stream + Bytes + ffprobe + Subs SRT + Tráiler
const warriorStreams = await fetchJson(`${HUB_CFG_PATH}/stream/movie/tt1291584.json`, {}, 20000);
const wTop = warriorStreams.data?.streams?.[0];
check('Warrior #1 [⚡ INSTANTÁNEO] [🌎 LATINO]', Boolean(wTop && isCachedStream(wTop) && isLatinoStream(wTop)), wTop?.name);

if (wTop?.url) {
  const rRes = await fetch(wTop.url, {
    headers: { Range: 'bytes=0-65535' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  const magic = hasValidVideoMagic(Buffer.from(await rRes.arrayBuffer()));
  check('Warrior HTTP Range (0-65535) devuelve bytes de video reales (sin pantalla verde)', (rRes.status === 200 || rRes.status === 206) && magic.ok, `HTTP ${rRes.status}, ${magic.kind}`);

  try {
    const probe = runFfprobe(wTop.url, 22000, false);
    const vStream = (probe.streams || []).find((s) => s.codec_type === 'video');
    const aStreams = (probe.streams || []).filter((s) => s.codec_type === 'audio');
    check(
      'ffprobe.exe PC decodifica Warrior (video H.264/HEVC <= 1920p SDR + audio)',
      Boolean(vStream && /h264|hevc/i.test(vStream.codec_name || '') && (vStream.width || 0) <= 1920 && aStreams.length >= 1),
      `${vStream?.codec_name} ${vStream?.width}x${vStream?.height}, audios=${aStreams.length}`,
    );
  } catch (err) {
    check('ffprobe.exe PC decodifica Warrior', false, err.message.slice(0, 120));
  }
}

const wSubs = await fetchJson(`${HUB_CFG_PATH}/subtitles/movie/tt1291584.json`, {}, 20000);
const wSubList = wSubs.data?.subtitles || [];
const topSub = wSubList[0];
check(
  'Subtítulos Warrior no vacíos y limpios sin marcas SDH (spl/spa)',
  wSubList.length > 0 && ['spl', 'spa'].includes(topSub?.lang) && !/\[SDH\]|\(CC\)/i.test(topSub?.id || topSub?.title || ''),
  `count=${wSubList.length}, lang=${topSub?.lang}`,
);

if (topSub?.url) {
  const srtRes = await fetch(topSub.url, { signal: AbortSignal.timeout(15000) });
  const srtTxt = srtRes.ok ? await srtRes.text() : '';
  const cues = parseSrtToCues(srtTxt);
  let monotonic = cues.length > 500;
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].startMs < cues[i - 1].startMs) {
      monotonic = false;
      break;
    }
  }
  const sdhSample = cues.slice(0, 100).some((c) => /\[SDH\]|\[CC\]|\(sighs\)|♪/i.test(c.text));
  check('Descarga real SRT Warrior >500 cues, monotónico y sin SDH', srtRes.ok && monotonic && !sdhSample, `cues=${cues.length}`);
}

const wTrailer = await fetchJson(`${PROD_HUB}/trailers/stream/movie/tt1291584.json`, {}, 15000);
const tFirst = wTrailer.data?.streams?.[0];
check('Tráilers Oficiales Latino responde stream para Warrior', wTrailer.status === 200 && Boolean(tFirst && (tFirst.ytId || tFirst.url)), tFirst?.title || tFirst?.ytId);

// 5.3 The Smashing Machine (tt11214558)
const smashStreams = await fetchJson(`${HUB_CFG_PATH}/stream/movie/tt11214558.json`, {}, 20000);
const smashTop = smashStreams.data?.streams?.[0];
check('The Smashing Machine #1 [⚡ INSTANTÁNEO] [🌎 LATINO]', Boolean(smashTop && isCachedStream(smashTop) && isLatinoStream(smashTop)), smashTop?.name);

// 5.4 Series Combate: TUF S32E01 (tt0445912:32:1) & Kingdom S01E01 (tt3673794:1:1)
for (const [sname, epId] of [
  ['The Ultimate Fighter S32E01', 'tt0445912:32:1'],
  ['Kingdom S01E01', 'tt3673794:1:1'],
]) {
  const sRes = await fetchJson(`${HUB_CFG_PATH}/stream/series/${epId}.json`, {}, 20000);
  const cachedCount = (sRes.data?.streams || []).filter(isCachedStream).length;
  check(`Serie Combate ${sname} con streams TorBox cacheados`, sRes.status === 200 && cachedCount >= 1, `cached=${cachedCount}`);
}

const kSubs = await fetchJson(`${HUB_CFG_PATH}/subtitles/series/tt3673794:1:1.json`, {}, 20000);
const kTopSub = kSubs.data?.subtitles?.[0];
check('Subtítulos limpios Kingdom S01E01 (spl/spa)', (kSubs.data?.subtitles?.length || 0) > 0 && ['spl', 'spa'].includes(kTopSub?.lang), `count=${kSubs.data?.subtitles?.length || 0}, lang=${kTopSub?.lang}`);

// 5.5 Live TV UFC / Combate — Sonda real #EXTM3U + ffprobe.exe
let liveDecodedChannel = null;
let liveProbeSummary = '';
for (const chId of ['iptv-ESPNLatinAmerica.us', 'iptv-FightNetwork.ca', 'iptv-PFLMMA.us']) {
  const chRes = await fetchJson(`${PROD_HUB}/livetv/stream/tv/${chId}.json`, {}, 15000);
  const streams = chRes.data?.streams || [];
  for (const st of streams) {
    if (!st?.url) continue;
    try {
      const m3uRes = await fetch(st.url, { signal: AbortSignal.timeout(8000) });
      const m3uTxt = m3uRes.ok ? await m3uRes.text() : '';
      if (!m3uRes.ok || !m3uTxt.includes('#EXTM3U')) continue;
      const probe = runFfprobe(st.url, 15000, true);
      const v = (probe.streams || []).find((x) => x.codec_type === 'video' && /h264|hevc|mpeg2video/i.test(x.codec_name || ''));
      const a = (probe.streams || []).find((x) => x.codec_type === 'audio');
      if (v && a) {
        liveDecodedChannel = chId;
        liveProbeSummary = `${chId} -> ${v.codec_name} ${v.width}x${v.height} + ${a.codec_name}`;
        break;
      }
    } catch {
      // Probar siguiente señal viva
    }
  }
  if (liveDecodedChannel) break;
}
check('TV en Vivo UFC/Combate: playlist #EXTM3U + decodificación real H.264/audio via ffprobe.exe', Boolean(liveDecodedChannel), liveProbeSummary || 'ninguna señal decodificó');

console.log('\n' + '═'.repeat(80));
console.log(`  RESUMEN E2E STREMIO 5 PC (stremiojn): ${results.passed} PASS / ${results.failed} FAIL`);
for (const ph of results.phases) {
  console.log(`   • ${ph.name}: ${ph.passed} ok, ${ph.failed} fail`);
}
if (results.advisories.length) {
  console.log('\n  Avisos:');
  for (const adv of results.advisories) console.log(`   - ${adv}`);
}
console.log('═'.repeat(80));

process.exit(results.failed === 0 ? 0 : 1);
