/**
 * ufc.ts — Catálogo curado de MMA / UFC para el perfil fanático de deportes de combate.
 */

import { cors, jsonResponse } from "../utils/common.ts";
import { posterFor } from "./latino.ts";

export const UFC_MANIFEST = {
  id: "com.mejorastremio.ufc-catalog",
  version: "1.0.0",
  name: "MMA / UFC (curado)",
  description:
    "Catálogo curado para perfil fan de UFC: realities de captación de talento MMA " +
    "(Dana White's Contender Series, The Ultimate Fighter), drama de gimnasio de MMA " +
    "(Kingdom, Cobra Kai), reality de aptitud física (Physical: 100) y wrestling (WWE Raw/SmackDown).",
  resources: ["catalog"],
  types: ["series"],
  idPrefixes: ["tt"],
  catalogs: [{ type: "series", id: "ufc-series", name: "MMA / UFC (curado)" }],
};

export const UFC_TITLES: { id: string; name: string }[] = [
  { id: "tt10845410", name: "Dana White's Contender Series" },
  { id: "tt0445912", name: "The Ultimate Fighter" },
  { id: "tt3673794", name: "Kingdom" },
  { id: "tt7221388", name: "Cobra Kai" },
  { id: "tt25274446", name: "Physical: 100" },
  { id: "tt0185103", name: "WWE Raw" },
  { id: "tt0227972", name: "WWE SmackDown" },
];

export async function handleUfc(subPath: string): Promise<Response> {
  if (subPath === "/manifest.json") {
    return jsonResponse(UFC_MANIFEST);
  }

  if (subPath === "/catalog/series/ufc-series.json") {
    const metas = await Promise.all(
      UFC_TITLES.map(async (t) => ({
        id: t.id,
        type: "series",
        name: t.name,
        poster: await posterFor(t.id, "series"),
      })),
    );
    return jsonResponse({ metas });
  }

  return new Response("Not found", { status: 404, headers: cors });
}
