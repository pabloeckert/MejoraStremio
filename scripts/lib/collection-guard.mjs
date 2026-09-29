/**
 * collection-guard.mjs â€” Guard compartido contra manifests con catÃ¡logos congelados en 0.
 *
 * Causa raÃ­z real encontrada el 2026-07-11: varios scripts de escritura (apply-torbox-profile.mjs,
 * apply-cgnat-profile.mjs, reorder-addons.mjs, apply-friction-zero-sort.mjs) vaciaban
 * `manifest.catalogs = []` para TODOS los addons del payload antes de addonCollectionSet â€” no solo
 * el que modificaban â€” por una premisa falsa ("evitar exceder el tamaÃ±o mÃ¡ximo del descriptor").
 * regenerate-aiometadata.mjs ya probaba, corrida tras corrida, que el payload completo (con los
 * ~132 catÃ¡logos de AIOMetadata embebidos) se acepta sin problema. El vaciado indiscriminado dejÃ³
 * congelados en 0 los catÃ¡logos de AIOMetadata, MyTrakt Sync, Streaming Catalogs y Audio Latino
 * (verificado) en el storage de Stremio â€” rompiendo bÃºsqueda/catÃ¡logos/sugerencias de Home hasta
 * la prÃ³xima regeneraciÃ³n completa. Ver GEMINI.md â†’ "Bug real: catalogs:[] indiscriminado".
 *
 * Importante: NO alcanza con "resources incluye catalog && catalogs.length === 0" como seÃ±al de
 * ruptura â€” varios addons sanos (Cinemeta, Mubi Catalog, Trakt Integration) SIEMPRE tienen
 * catalogs:[] en el storage aunque funcionen perfectamente (su fuente de catÃ¡logos no depende de
 * ese campo). Por eso este guard compara contra un fetch EN VIVO del manifest antes de decidir:
 * solo aborta si el storage dice 0 pero el addon en vivo (mismo transportUrl) responde con mÃ¡s de
 * 0 catÃ¡logos â€” eso sÃ­ es una regresiÃ³n real, no el estado normal del addon.
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
 * Revisa que ningÃºn addon NO modificado en esta corrida estÃ© a punto de persistir catalogs=[]
 * cuando su manifest EN VIVO (mismo transportUrl) tiene catÃ¡logos reales. Si encuentra alguno,
 * imprime un warning claro y devuelve false â€” el script llamante debe abortar antes de escribir.
 *
 * @param {Array} addons - la lista completa que se estÃ¡ por escribir (post-cambios)
 * @param {Set<string>|string[]} modifiedIds - manifest.id de los addons que ESTA corrida modifica
 *   intencionalmente (a esos no se les exige nada, pueden legÃ­timamente traer un manifest nuevo).
 * @returns {Promise<boolean>} true si estÃ¡ todo OK para escribir, false si hay que abortar.
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

  console.error('\nâœ— ABORTADO â€” guard anti-manifest-congelado:');
  for (const { addon: a, liveCatalogs } of broken) {
    console.error(
      `  "${a.manifest?.name}" (${a.manifest?.id}): storage tiene catalogs=[] pero el manifest ` +
        `EN VIVO responde con ${liveCatalogs} catÃ¡logos â€” esta corrida NO lo estÃ¡ modificando, asÃ­ ` +
        `que escribir esto congelarÃ­a el manifest roto.`
    );
  }
  console.error(
    '  Ver GEMINI.md â†’ "Bug real: catalogs:[] indiscriminado". ArreglÃ¡ esos addons primero ' +
      '(ej. regenerate-aiometadata.mjs --apply para AIOMetadata) antes de correr este script.'
  );
  return false;
}
