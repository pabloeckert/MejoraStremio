#!/usr/bin/env node
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertNoFrozenEmptyCatalogs } from './lib/collection-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const [,, email, password, subSenseUrl] = process.argv;
if (!email || !password || !subSenseUrl) {
    console.error('Uso: node fix-subtitles.mjs <email> <password> <subsense-manifest-url>');
    process.exit(1);
}

function request(url, opts = {}, body = null, redirects = 5) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const lib = u.protocol === 'https:' ? https : http;
        const options = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: opts.method || 'GET',
            headers: opts.headers || {},
            timeout: opts.timeout || 30000,
            rejectUnauthorized: false
        };
        const req = lib.request(options, res => {
            // Follow redirects
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
                && res.headers.location && redirects > 0) {
                res.resume();
                const nextUrl = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : `${u.protocol}//${u.host}${res.headers.location}`;
                request(nextUrl, opts, body, redirects - 1).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data)); } catch { resolve(data); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

function post(url, data) {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body);
}

function get(url, timeout = 25000) {
    return request(url, { method: 'GET', timeout });
}

function hasSubtitlesResource(manifest) {
    if (!manifest || !manifest.resources) return false;
    return manifest.resources.some(r => r === 'subtitles' || r?.name === 'subtitles');
}

async function main() {
    // ===== PASO 1: LOGIN =====
    console.log('PASO 1: LOGIN');
    const r1 = await post('https://api.strem.io/api/login', { type: 'Login', email, password });
    if (!r1.result?.authKey) {
        console.error('FALLO LOGIN:', JSON.stringify(r1)); process.exit(1);
    }
    const authKey = r1.result.authKey;
    console.log(`  OK - AuthKey: ${authKey.substring(0, 10)}...`);

    // ===== PASO 2: BACKUP =====
    console.log('\nPASO 2: BACKUP');
    const r2 = await post('https://api.strem.io/api/addonCollectionGet', {
        type: 'AddonCollectionGet', authKey, update: true
    });
    if (!r2.result?.addons) {
        console.error('FALLO BACKUP:', JSON.stringify(r2)); process.exit(1);
    }
    const CURR = r2.result.addons;
    const backupDir = path.join(__dirname, '..', '.backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-stremio-${stamp}-pre-subs2.json`);
    fs.writeFileSync(backupFile, JSON.stringify(r2.result, null, 2));
    console.log(`  OK - ${backupFile}`);
    console.log(`  Coleccion actual (${CURR.length} addons):`);
    CURR.forEach((a, i) => console.log(`    ${i+1}. ${a.manifest?.name || a.transportName}`));

    // ===== PASO 3: VERIFICAR MANIFESTS =====
    console.log('\nPASO 3: VERIFICAR MANIFESTS');

    const subsenseManifestUrl = subSenseUrl.endsWith('manifest.json')
        ? subSenseUrl
        : subSenseUrl.replace(/\/$/, '') + '/manifest.json';
    const subsenseTransportUrl = subsenseManifestUrl.replace(/manifest\.json$/, '');

    const candidates = [
        { id: 'subsense',  label: 'SubSense',                   manifestUrl: subsenseManifestUrl,    transportUrl: subsenseTransportUrl },
        { id: 'subsource', label: 'SubSource',                   manifestUrl: 'https://subsource.strem.bar/manifest.json',               transportUrl: 'https://subsource.strem.bar/' },
        { id: 'subdl',     label: 'SubDL',                       manifestUrl: 'https://subdl.strem.bar/manifest.json',                   transportUrl: 'https://subdl.strem.bar/' },
        { id: 'community', label: 'Stremio Community Subtitles', manifestUrl: 'https://stremio-community-subtitles.top/manifest.json',   transportUrl: 'https://stremio-community-subtitles.top/' }
    ];

    const VALID = [];
    const manifestStatus = {};

    for (const c of candidates) {
        process.stdout.write(`  ${c.label}... `);
        try {
            const manifest = await get(c.manifestUrl);
            if (hasSubtitlesResource(manifest)) {
                console.log(`OK (${manifest.name})`);
                VALID.push({ ...c, manifest });
                manifestStatus[c.id] = `OK - ${manifest.name}`;
            } else {
                console.log('WARN: sin subtitles en resources');
                manifestStatus[c.id] = 'WARN: sin subtitles en resources';
            }
        } catch (e) {
            console.log(`FALLO: ${e.message}`);
            manifestStatus[c.id] = `FALLO: ${e.message}`;
        }
    }
    console.log(`  Validos: ${VALID.length}/4`);

    // ===== PASO 4: DIAGNOSTICO OPENSUBTITLES PRO =====
    console.log('\nPASO 4: DIAGNOSTICO OPENSUBTITLES PRO');
    const osAddonIdx = CURR.findIndex(a => {
        const name = (a.manifest?.name || a.transportName || '').toLowerCase();
        return name.includes('opensubtitles') || (a.transportUrl || '').includes('opensubtitles');
    });

    let osDiag = 'NO ENCONTRADO';
    if (osAddonIdx >= 0) {
        const osAddon = CURR[osAddonIdx];
        const osUrl = osAddon.transportUrl;
        const osName = osAddon.manifest?.name || osAddon.transportName;
        console.log(`  Encontrado en posicion ${osAddonIdx+1}: ${osName}`);
        console.log(`  TransportUrl: ${osUrl}`);

        // Try to decode base64 config from URL
        const match = osUrl.match(/\/([A-Za-z0-9_\-]{20,})\//);
        if (match) {
            try {
                const b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
                const decoded = Buffer.from(b64, 'base64').toString('utf8');
                console.log(`  Config base64 decodificada: ${decoded}`);
                const config = JSON.parse(decoded);
                if (config.langs) {
                    const langs = Array.isArray(config.langs) ? config.langs : [config.langs];
                    const hasSpanish = langs.some(l => l.toLowerCase().includes('spanish') || l.startsWith('es'));
                    osDiag = hasSpanish
                        ? `TIENE espanol configurado: ${langs.join(', ')}`
                        : `Idiomas configurados sin espanol: ${langs.join(', ')}`;
                    console.log(`  Diagnostico: ${osDiag}`);
                }
            } catch (e) {
                console.log(`  No se pudo decodificar config: ${e.message}`);
                osDiag = 'Config no decodificable';
            }
        }

        // Fetch manifest (handle transportUrl that already ends in /manifest.json)
        const osManifestUrl = osUrl.endsWith('manifest.json') ? osUrl : osUrl.replace(/\/$/, '') + '/manifest.json';
        // Transport base (without manifest.json)
        const osBase = osUrl.endsWith('manifest.json') ? osUrl.replace(/manifest\.json$/, '') : osUrl.replace(/\/$/, '') + '/';

        try {
            const osMf = await get(osManifestUrl);
            console.log(`  Manifest: ${osMf.name} v${osMf.version}`);
            const res = Array.isArray(osMf.resources) ? osMf.resources.map(r => r?.name || r).join(', ') : osMf.resources;
            console.log(`  Resources: ${res}`);
        } catch (e) {
            console.log(`  Manifest fresco: FALLO - ${e.message} (servidor posiblemente caido)`);
        }
    } else {
        console.log('  OPENSUBTITLES PRO NO ENCONTRADO en la coleccion');
    }

    // Diagnostico SubSense - decodificar token
    console.log('\n  Diagnostico SubSense URL:');
    console.log(`  TransportUrl configurada: ${subsenseTransportUrl}`);

    // ===== PASO 5: ARMAR NUEVA COLECCION =====
    console.log('\nPASO 5: ARMAR NUEVA COLECCION');

    // Work on a copy; remove any existing instance of addons we're about to add (avoid duplicates)
    const toAddIds = ['subsense', 'subsource', 'subdl', 'community'];
    const toAddLabels = ['subsense', 'subsource', 'subdl', 'stremio community subtitles'];
    let base = [...CURR];

    // Remove duplicates in reverse order so indices stay valid
    for (let i = base.length - 1; i >= 0; i--) {
        const name = (base[i].manifest?.name || base[i].transportName || '').toLowerCase();
        if (toAddLabels.some(l => name.includes(l))) {
            console.log(`  Removiendo duplicado: ${base[i].manifest?.name || base[i].transportName} (posicion ${i+1})`);
            base.splice(i, 1);
        }
    }

    // Find OpenSubtitles PRO after potential removal
    const osIdx = base.findIndex(a => {
        const name = (a.manifest?.name || a.transportName || '').toLowerCase();
        return name.includes('opensubtitles') || (a.transportUrl || '').includes('opensubtitles');
    });
    const insertBefore = osIdx >= 0 ? osIdx : Math.min(8, base.length);

    const NEW = [];
    for (let i = 0; i < insertBefore; i++) NEW.push(base[i]);

    const ssSrc  = VALID.find(a => a.id === 'subsense');
    const srcSrc = VALID.find(a => a.id === 'subsource');
    const sdlSrc = VALID.find(a => a.id === 'subdl');
    const comSrc = VALID.find(a => a.id === 'community');

    const makeAddon = c => ({
        transportUrl: c.transportUrl,
        transportName: c.manifest.name,
        manifest: c.manifest,
        flags: { official: false, protected: false }
    });

    if (ssSrc)  { NEW.push(makeAddon(ssSrc));  console.log('  + SubSense'); }
    if (osIdx >= 0) { NEW.push(base[osIdx]);   console.log('  + OpenSubtitles PRO (mantenido)'); }
    if (srcSrc) { NEW.push(makeAddon(srcSrc)); console.log('  + SubSource'); }
    if (sdlSrc) { NEW.push(makeAddon(sdlSrc)); console.log('  + SubDL'); }
    if (comSrc) { NEW.push(makeAddon(comSrc)); console.log('  + Stremio Community Subtitles'); }

    const afterIdx = osIdx >= 0 ? osIdx + 1 : insertBefore;
    for (let i = afterIdx; i < base.length; i++) NEW.push(base[i]);

    console.log(`\n  Nueva coleccion (${NEW.length} addons):`);
    NEW.forEach((a, i) => console.log(`    ${i+1}. ${a.manifest?.name || a.transportName}`));

    // ===== PASO 6: ESCRIBIR COLECCION =====
    console.log('\nPASO 6: ESCRIBIR COLECCION');
    if (!(await assertNoFrozenEmptyCatalogs(NEW, []))) {
        process.exit(1);
    }
    const payload = {
        type: 'AddonCollectionSet',
        authKey,
        addons: NEW.map(a => ({
            transportUrl:  a.transportUrl,
            transportName: a.transportName || a.manifest?.name || '',
            manifest:      a.manifest,
            flags:         a.flags || { official: false, protected: false }
        }))
    };

    try {
        const r5 = await post('https://api.strem.io/api/addonCollectionSet', payload);
        if (r5.result) {
            console.log('  OK -', JSON.stringify(r5.result));
        } else {
            console.error('  ERROR en set:', JSON.stringify(r5));
        }
    } catch (e) {
        console.error('  EXCEPCION en set:', e.message);
    }

    // ===== PASO 7: VERIFICACION =====
    console.log('\nPASO 7: VERIFICACION');
    const r6 = await post('https://api.strem.io/api/addonCollectionGet', {
        type: 'AddonCollectionGet', authKey, update: true
    });
    if (r6.result?.addons) {
        console.log(`  Coleccion verificada (${r6.result.addons.length} addons):`);
        r6.result.addons.forEach((a, i) => console.log(`    ${i+1}. ${a.manifest?.name || a.transportName}`));
    } else {
        console.error('  No se pudo verificar:', JSON.stringify(r6));
    }

    // Test de subtitulos
    console.log('\n  Test de subtitulos en espanol:');
    const testAddons = NEW.filter(a => {
        const name = (a.manifest?.name || a.transportName || '').toLowerCase();
        return name.includes('sub') || name.includes('subtitle');
    });

    for (const ta of testAddons) {
        let baseUrl = ta.transportUrl;
        if (baseUrl.endsWith('manifest.json')) {
            baseUrl = baseUrl.replace(/manifest\.json$/, '');
        }
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        const name = ta.manifest?.name || ta.transportName;
        console.log(`\n  --- ${name} ---`);

        // Breaking Bad S01E01
        try {
            const bb = await get(`${baseUrl}subtitles/series/tt0959621:1:1.json`, 30000);
            const subs = bb.subtitles || [];
            const allLangs = [...new Set(subs.map(s => s.lang).filter(Boolean))].sort().join(', ');
            const esSubs = subs.filter(s => {
                const l = (s.lang || '').toLowerCase();
                return l.startsWith('es') || l.includes('spanish') || l.includes('spa');
            });
            const esLangs = [...new Set(esSubs.map(s => s.lang))].join(', ');
            console.log(`    Breaking Bad S01E01: ${subs.length} total, ${esSubs.length} en espanol (${esLangs || 'ninguno'})`);
            if (subs.length > 0 && esSubs.length === 0) console.log(`      Idiomas disponibles: ${allLangs}`);
        } catch (e) { console.log(`    Breaking Bad: FALLO - ${e.message}`); }

        // The Matrix
        try {
            const mat = await get(`${baseUrl}subtitles/movie/tt0133093.json`, 30000);
            const subs = mat.subtitles || [];
            const allLangs = [...new Set(subs.map(s => s.lang).filter(Boolean))].sort().join(', ');
            const esSubs = subs.filter(s => {
                const l = (s.lang || '').toLowerCase();
                return l.startsWith('es') || l.includes('spanish') || l.includes('spa');
            });
            const esLangs = [...new Set(esSubs.map(s => s.lang))].join(', ');
            console.log(`    The Matrix: ${subs.length} total, ${esSubs.length} en espanol (${esLangs || 'ninguno'})`);
            if (subs.length > 0 && esSubs.length === 0) console.log(`      Idiomas disponibles: ${allLangs}`);
        } catch (e) { console.log(`    The Matrix: FALLO - ${e.message}`); }
    }

    // ===== REPORTE FINAL =====
    console.log('\n========== REPORTE FINAL ==========');
    console.log(`1. BACKUP: ${backupFile}`);
    console.log('2. MANIFESTS:');
    for (const [k, v] of Object.entries(manifestStatus)) console.log(`   ${k}: ${v}`);
    console.log(`3. OPENSUBTITLES PRO: ${osDiag}`);
    console.log(`4. Coleccion total: ${NEW.length} addons`);
    console.log('\n[Sesion finalizada - authKey no guardada en disco]');
}

main().catch(e => { console.error('ERROR FATAL:', e.message); process.exit(1); });
