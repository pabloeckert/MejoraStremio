#!/usr/bin/env node
/**
 * scripts/verify-prod-interceptor.mjs
 * 
 * Certificación en Producción (Reality Check en Vivo) para el Smart Stream Interceptor
 * desplegado en Deno Deploy (https://mejorastremio-hub.pabloeckert.deno.net).
 * 
 * Valida:
 *  1. Endpoint de streams responde 200 OK.
 *  2. "Un show más" (tt32604054:1:1): El stream en la posición [0] contiene explícitamente "[🇪🇸 LATINO]" en `name`.
 *  3. "La casa realmente ruidosa" (tt22495072:1:1): El stream en la posición [0] contiene explícitamente "[⚠️ SOLO INGLÉS]" en `name`.
 *  4. Manifiesto en vivo expone com.mejorastremio.streams con recurso stream.
 * 
 * Uso: node scripts/verify-prod-interceptor.mjs
 */

const PROD_HUB_URL = process.env.HUB_URL || 'https://mejorastremio-hub.pabloeckert.deno.net';

function formatTitle(raw) {
  if (!raw) return '';
  return raw.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 2).join(' | ');
}

async function verifyProduction() {
  console.log('═'.repeat(80));
  console.log(' MEJORASTREMIO — CERTIFICACIÓN EN PRODUCCIÓN: SMART STREAM INTERCEPTOR');
  console.log(' Postura: Zero Trust | Target: ' + PROD_HUB_URL);
  console.log('═'.repeat(80));

  let passed = 0;
  let failed = 0;

  function assert(desc, condition, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${desc} ${details ? `(${details})` : ''}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  // ── CASO 0: Manifiesto en Producción ─────────────────────────────────────────
  console.log('\n─── CASO 0: Verificación de Manifiesto en Vivo ───');
  const mfUrl = `${PROD_HUB_URL}/streams/manifest.json`;
  console.log(`  Fetch: ${mfUrl}`);
  const mfRes = await fetch(mfUrl, { headers: { 'User-Agent': 'MejoraStremio-Audit/1.0' } });
  assert('HTTP 200 en manifest', mfRes.status === 200);
  const mf = await mfRes.json().catch(() => null);
  assert('ID com.mejorastremio.streams', mf?.id === 'com.mejorastremio.streams');
  assert('Recurso stream declarado', Array.isArray(mf?.resources) && mf.resources.includes('stream'));
  assert('Tipos movie y series soportados', mf?.types?.includes('movie') && mf?.types?.includes('series'));

  // ── CASO 1: Un show más (tt32604054:1:1) — RE-RANKING LATINO ────────────────
  console.log('\n─── CASO 1: "Un show más" (tt32604054:1:1) — PRIORIDAD LATINO ───');
  const showUrl = `${PROD_HUB_URL}/streams/series/tt32604054:1:1.json`;
  console.log(`  Fetch: ${showUrl}`);
  const showRes = await fetch(showUrl, { headers: { 'User-Agent': 'MejoraStremio-Audit/1.0' } });
  assert('HTTP 200 OK en streams', showRes.status === 200);
  const showData = await showRes.json().catch(() => ({}));
  const showStreams = Array.isArray(showData.streams) ? showData.streams : [];
  assert('Array de streams no vacío', showStreams.length > 0, `Total recibidos: ${showStreams.length}`);

  const stream0 = showStreams[0] || {};
  const s0Name = stream0.name || '';
  const s0HasLatinoBadge = s0Name.includes('[🇪🇸 LATINO]');
  assert('Stream en posición [0] contiene explícitamente "[🇪🇸 LATINO]" en name', s0HasLatinoBadge, `name: "${s0Name.replace(/\n/g, ' ')}"`);

  const s0Title = stream0.title || '';
  const isCinecalidad = s0Title.includes('Cinecalidad') || s0Title.toLowerCase().includes('lat');
  assert('Stream en posición [0] es release Latino / Cinecalidad', isCinecalidad);

  console.log('\n  📋 RAW TRUTH EN PRODUCCIÓN: PRIMEROS 5 STREAMS:');
  console.log('  ' + '─'.repeat(76));
  showStreams.slice(0, 5).forEach((st, i) => {
    console.log(`  [Puesto #${i + 1}] BADGE / PROVIDER: ${(st.name || '').replace(/\n/g, ' ')}`);
    console.log(`             DETALLES: ${formatTitle(st.title)}`);
    console.log('  ' + '─'.repeat(76));
  });

  // ── CASO 2: La casa realmente ruidosa (tt22495072:1:1) — FALLBACK SOLO INGLÉS ──
  console.log('\n─── CASO 2: "La casa realmente ruidosa" (tt22495072:1:1) — CASO FALLA / SOLO INGLÉS ───');
  const loudUrl = `${PROD_HUB_URL}/streams/series/tt22495072:1:1.json`;
  console.log(`  Fetch: ${loudUrl}`);
  const loudRes = await fetch(loudUrl, { headers: { 'User-Agent': 'MejoraStremio-Audit/1.0' } });
  assert('HTTP 200 OK en streams', loudRes.status === 200);
  const loudData = await loudRes.json().catch(() => ({}));
  const loudStreams = Array.isArray(loudData.streams) ? loudData.streams : [];
  assert('Array de streams no vacío', loudStreams.length > 0, `Total recibidos: ${loudStreams.length}`);

  const loud0 = loudStreams[0] || {};
  const loud0Name = loud0.name || '';
  const loud0HasEnglishBadge = loud0Name.includes('[⚠️ SOLO INGLÉS]');
  assert('Stream en posición [0] contiene explícitamente "[⚠️ SOLO INGLÉS]" en name', loud0HasEnglishBadge, `name: "${loud0Name.replace(/\n/g, ' ')}"`);

  const allLoudEnglish = loudStreams.every(s => (s.name || '').includes('[⚠️ SOLO INGLÉS]'));
  assert('El 100% de los streams sin audio latino reciben el badge [⚠️ SOLO INGLÉS]', allLoudEnglish);

  console.log('\n  📋 RAW TRUTH EN PRODUCCIÓN: PRIMEROS 5 STREAMS:');
  console.log('  ' + '─'.repeat(76));
  loudStreams.slice(0, 5).forEach((st, i) => {
    console.log(`  [Puesto #${i + 1}] BADGE / PROVIDER: ${(st.name || '').replace(/\n/g, ' ')}`);
    console.log(`             DETALLES: ${formatTitle(st.title)}`);
    console.log('  ' + '─'.repeat(76));
  });

  // ── RESUMEN FINAL FORENSE ────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log(` RESUMEN CERTIFICACIÓN PRODUCCIÓN: ${passed} APROBADOS, ${failed} FALLIDOS`);
  console.log('═'.repeat(80));

  if (failed > 0) {
    console.error('❌ CERTIFICACIÓN EN PRODUCCIÓN FALLIDA.\n');
    process.exit(1);
  } else {
    console.log('🎉 SMART STREAM INTERCEPTOR EN PRODUCCIÓN: 100% OPERATIVO Y VERIFICADO.\n');
    process.exit(0);
  }
}

verifyProduction().catch(e => {
  console.error('Error fatal durante certificación en producción:', e);
  process.exit(1);
});
