/**
 * collection-guard.mjs — Guard compartido contra manifests con catálogos congelados en 0.
 *
 * Causa raíz real encontrada el 2026-07-11: varios scripts de escritura (apply-torbox-profile.mjs,
 * apply-cgnat-profile.mjs, reorder-addons.mjs, apply-friction-zero-sort.mjs) vaciaban
 * `manifest.catalogs = []` para TODOS los addons del payload antes de addonCollectionSet — no solo
 * el que modificaban — por una premisa falsa ("evitar exceder el tamaño máximo del descriptor").
 * regenerate-aiometadata.mjs ya probaba, corrida tras corrida, que el payload completo (con los
 * ~132 catálogos de AIOMetadata embebidos) se acepta sin problema. El vaciado indiscriminado dejó
 * congelados en 0 los catálogos de AIOMetadata, MyTrakt Sync, Streaming Catalogs y Audio Latino
 * (verificado) en el storage de Stremio — rompiendo búsqueda/catálogos/sugerencias de Home hasta
 * la próxima regeneración completa. Ver CLAUDE.md → "Bug real: catalogs:[] indiscriminado".
 *
 * Importante: NO alcanza con "resources incluye catalog && catalogs.length === 0" como señal de
 * ruptura — varios addons sanos (Cinemeta, Mubi Catalog, Trakt Integration) SIEMPRE tienen
 * catalogs:[] en el storage aunque funcionen perfectamente (su fuente de catálogos no depende de
 * ese campo). Por eso este guard compara contra un fetch EN VIVO del manifest antes de decidir:
 * solo aborta si el storage dice 0 pero el addon en vivo (mismo transportUrl) responde con más de
 * 0 catálogos — eso sí es una regresión real, no el estado normal del addon.
 */

const hasResource = (manifest, res) =>
  (manifest?.resources || []).some((r) => r === res || r?.name === res);

const manifestUrlOf = (transportUrl) =>
  /manifest\.json$/.test(transportUrl)
    ? transportUrl
    : transportUrl.replace(/\/?$/, '/') + 'manifest.json';

const getJson = (url, timeout = 15000) =>
  fetch(url, { signal: AbortSignal.timeout(timeout) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

/**
 * Revisa que ningún addon NO modificado en esta corrida esté a punto de persistir catalogs=[]
 * cuando su manifest EN VIVO (mismo transportUrl) tiene catálogos reales. Si encuentra alguno,
 * imprime un warning claro y devuelve false — el script llamante debe abortar antes de escribir.
 *
 * @param {Array} addons - la lista completa que se está por escribir (post-cambios)
 * @param {Set<string>|string[]} modifiedIds - manifest.id de los addons que ESTA corrida modifica
 *   intencionalmente (a esos no se les exige nada, pueden legítimamente traer un manifest nuevo).
 * @returns {Promise<boolean>} true si está todo OK para escribir, false si hay que abortar.
 */
export async function assertNoFrozenEmptyCatalogs(addons, modifiedIds) {
  const modified = new Set(modifiedIds);
  const candidates = addons.filter((a) => {
    const id = a.manifest?.id;
    if (!id || modified.has(id)) return false;
    if (!hasResource(a.manifest, 'catalog')) return false;
    return (a.manifest?.catalogs?.length ?? 0) === 0;
  });
  if (!candidates.length) return true;

  const broken = [];
  for (const a of candidates) {
    const live = await getJson(manifestUrlOf(a.transportUrl));
    const liveCatalogs = live?.catalogs?.length ?? 0;
    if (liveCatalogs > 0) broken.push({ addon: a, liveCatalogs });
  }
  if (!broken.length) return true;

  console.error('\n✗ ABORTADO — guard anti-manifest-congelado:');
  for (const { addon: a, liveCatalogs } of broken) {
    console.error(
      `  "${a.manifest?.name}" (${a.manifest?.id}): storage tiene catalogs=[] pero el manifest ` +
        `EN VIVO responde con ${liveCatalogs} catálogos — esta corrida NO lo está modificando, así ` +
        `que escribir esto congelaría el manifest roto.`
    );
  }
  console.error(
    '  Ver CLAUDE.md → "Bug real: catalogs:[] indiscriminado". Arreglá esos addons primero ' +
      '(ej. regenerate-aiometadata.mjs --apply para AIOMetadata) antes de correr este script.'
  );
  return false;
}
