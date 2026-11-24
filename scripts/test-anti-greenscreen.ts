/**
 * test-anti-greenscreen.ts — Regresión Anti-Pantalla-Verde TorBox y Prioridad Latino
 *
 * Verifica:
 * 1. [TB⬇️] Comet 720p (con "TorBox" en descripción) NO es clasificado como instantáneo y es purgado por rankAndBadgeStreams.
 * 2. [TB download] Torrentio y MediaFusion TRB ⏳ son purgados por rankAndBadgeStreams (cero pantalla verde).
 * 3. "Lat+Ing ... 🇪🇸" en Comet [TB⚡] clasifica como "latino" (#1 [⚡ INSTANTÁNEO] [🌎 LATINO]),
 *    mientras que "HPI S01E01 1080p 🇪🇸" sin token latino clasifica como "castellano".
 * 4. verifyTorboxInstantStreams preserva [⚡ INSTANTÁNEO] si la API devuelve null, y extrae hashes de Comet bingeGroup.
 */

import {
  classifyStreamAudio,
  isCachedOrInstantStream,
  type StremioStreamItem,
} from "./deno-hub/utils/common.ts";
import {
  isDebridDownloadPlaceholder,
  rankAndBadgeStreams,
} from "./deno-hub/streams/streams.ts";
import {
  extractStreamInfoHash,
  verifyTorboxInstantStreams,
} from "./deno-hub/utils/swr_cache.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

Deno.test("1. [TB⬇️] Comet, [TB download] Torrentio y TRB ⏳ nunca pasan como instantáneos y se purgan", () => {
  const cometUncached: StremioStreamItem = {
    name: "[TB⬇️] Comet\n720p",
    description: "📄 Psych The Movie [720p][Latino][TorBox]",
    url: "https://comet.feels.legal/eyJtYXhSZXN1bHRzIjoxMH0=/playback/74f7f5da2c693bf4/0",
  };
  const torrentioUncached: StremioStreamItem = {
    name: "[TB download] Torrentio\n1080p",
    title: "Nada Entre Los Dos (2026) 1080p WEBRip\n👤 4 💾 1.54 GB ⚙️ ThePirateBay",
    url: "https://torrentio.strem.fun/resolve/torbox/key/abcdef0123456789abcdef0123456789abcdef01/file.mkv",
  };
  const mfUncached: StremioStreamItem = {
    name: "MediaFusion | ElfHosted 🧲 TRB ⏳ 1080p",
    title: "Percy.Jackson.S02E05.1080p.WEB-DL.mkv",
    url: "https://mediafusion.elfhosted.com/streaming_provider/token/stream/movie/tt1234567",
  };
  const cachedValid: StremioStreamItem = {
    name: "[TB⚡] Comet\n1080p",
    description: "📄 Psych.The.Movie.2017.1080p.WEB-DL.mkv",
    url: "https://comet.feels.legal/eyJtYXhSZXN1bHRzIjoxMH0=/playback/1111111111111111111111111111111111111111/0",
  };

  assert(!isCachedOrInstantStream(cometUncached), "Comet [TB⬇️] debe ser isCachedOrInstantStream=false");
  assert(!isCachedOrInstantStream(torrentioUncached), "Torrentio [TB download] debe ser isCachedOrInstantStream=false");
  assert(!isCachedOrInstantStream(mfUncached), "MediaFusion TRB ⏳ debe ser isCachedOrInstantStream=false");
  assert(isCachedOrInstantStream(cachedValid), "Comet [TB⚡] debe ser isCachedOrInstantStream=true");

  assert(isDebridDownloadPlaceholder(cometUncached), "Comet [TB⬇️] es placeholder no cacheado");
  assert(isDebridDownloadPlaceholder(torrentioUncached), "Torrentio [TB download] es placeholder no cacheado");
  assert(isDebridDownloadPlaceholder(mfUncached), "MediaFusion TRB ⏳ es placeholder no cacheado");
  assert(!isDebridDownloadPlaceholder(cachedValid), "Comet [TB⚡] NO es placeholder");

  const ranked = rankAndBadgeStreams([cometUncached, torrentioUncached, mfUncached, cachedValid]);
  assert(ranked.length === 1, `Solo debe sobrevivir el stream cacheado real (got ${ranked.length})`);
  assert(ranked[0].name?.includes("[⚡ INSTANTÁNEO]"), `Stream sobreviviente debe ser instantáneo: ${ranked[0].name}`);
});

Deno.test("2. Lat+Ing con emoji 🇪🇸 de Comet clasifica como [🌎 LATINO] #1 sin romper HPI Castellano", () => {
  const nadaCometLatino: StremioStreamItem = {
    name: "[TB⚡] Comet 1080p",
    description: "Nada entre los dos Lat+Ing EAC3 5.1Sub Esp+Ing BD HD 1080p.mkv\n🇪🇸",
    url: "https://comet.feels.legal/token/playback/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/0",
  };
  const nadaOriginal: StremioStreamItem = {
    name: "[TB+] Torrentio 1080p",
    title: "Nada entre los dos 2026 1080p WEBRip\n👤 8 💾 1.54 GB ⚙️ YTS",
    url: "https://torrentio.strem.fun/resolve/torbox/key/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/0",
  };
  const hpiCastellano: StremioStreamItem = {
    name: "[TB+] Torrentio 1080p",
    title: "HPI S01E01 1080p WEB-DL\n🇪🇸",
    url: "https://torrentio.strem.fun/resolve/torbox/key/cccccccccccccccccccccccccccccccccccccccc/0",
  };

  assert(classifyStreamAudio(nadaCometLatino) === "latino", `Lat+Ing + 🇪🇸 debe ser latino (got ${classifyStreamAudio(nadaCometLatino)})`);
  assert(classifyStreamAudio(hpiCastellano) === "castellano", `HPI + 🇪🇸 sin token latino debe seguir siendo castellano (got ${classifyStreamAudio(hpiCastellano)})`);

  const ranked = rankAndBadgeStreams([nadaOriginal, nadaCometLatino]);
  assert(ranked.length === 2, "Ambos streams cacheados presentes");
  assert(
    ranked[0].name?.includes("[⚡ INSTANTÁNEO]") && ranked[0].name?.includes("[🌎 LATINO]"),
    `#1 debe ser [⚡ INSTANTÁNEO] [🌎 LATINO], recibido: ${ranked[0].name}`,
  );
});

Deno.test("3. verifyTorboxInstantStreams preserva streams si checker devuelve null y lee hash de Comet bingeGroup", async () => {
  const cometHash = "abcdef0123456789abcdef0123456789abcdef01";
  const deadHash = "1234567890abcdef1234567890abcdef12345678";

  const cometStream: StremioStreamItem = {
    name: "[⚡ INSTANTÁNEO] [🌎 LATINO] [TB⚡] Comet 1080p",
    title: "Pelicula.Lat.1080p.mkv",
    behaviorHints: { bingeGroup: `comet|torbox|${cometHash}` },
    url: "https://comet.feels.legal/eyJ/playback/xyz",
  };
  const deadStream: StremioStreamItem = {
    name: "[⚡ INSTANTÁNEO] [🎧 ORIGINAL] [TB+] Torrentio 1080p",
    title: "Dead.Evicted.1080p.mkv",
    infoHash: deadHash,
    url: `https://torrentio.strem.fun/resolve/torbox/key/${deadHash}/file.mkv`,
  };

  assert(extractStreamInfoHash(cometStream) === cometHash, "Debe extraer hash de Comet bingeGroup");

  // Si TorBox API devuelve null (sin key o timeout), NO degrada los streams cacheados
  const preserved = await verifyTorboxInstantStreams([cometStream, deadStream], () => Promise.resolve(null));
  assert(preserved[0].name?.includes("[⚡ INSTANTÁNEO]"), "No debe degradar cuando checker devuelve null");
  assert(preserved[1].name?.includes("[⚡ INSTANTÁNEO]"), "No debe degradar cuando checker devuelve null");

  // Si TorBox API responde con Set de hashes vivos, conserva cometHash y degrada deadHash
  const checked = await verifyTorboxInstantStreams([cometStream, deadStream], () => Promise.resolve(new Set([cometHash])));
  assert(checked[0].name?.includes("[⚡ INSTANTÁNEO]"), "Comet hash vivo debe seguir INSTANTÁNEO");
  assert(checked[1].name?.includes("[⏳ REQUIERE BUFFER]"), "Hash expulsado debe degradarse a REQUIERE BUFFER");
});
