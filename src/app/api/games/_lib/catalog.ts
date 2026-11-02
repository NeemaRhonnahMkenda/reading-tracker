// src/app/api/games/_lib/catalog.ts
// Which game catalogue answers, with an automatic fallback:
//   IGDB      if TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET are set (best covers)
//   RAWG      if RAWG_API_KEY is set
//   Wikidata  always: no key, used on its own or when the others fail
// If the main catalogue errors or times out (RAWG's Cloudflare 522, say), the
// search is answered from Wikidata instead, and the main one is skipped for a
// couple of minutes so every search isn't held up waiting for it.

import type { Catalog, GameResult } from "../../../games/_lib/types";
import { igdbById, igdbConfigured, igdbSearch, igdbSearchLoose } from "./server";
import { rawgById, rawgConfigured, rawgSearch, rawgSearchLoose } from "./rawg";
import { wikidataById, wikidataSearch, wikidataSearchLoose } from "./wikidata";

type Search = (phrase: string, platforms: number[], limit?: number) => Promise<GameResult[]>;

const SOURCES: Record<Catalog, { configured: () => boolean; search: Search; loose: Search; byId: (ids: number[]) => Promise<Map<number, GameResult>> }> = {
  igdb: { configured: igdbConfigured, search: igdbSearch, loose: igdbSearchLoose, byId: igdbById },
  rawg: { configured: rawgConfigured, search: rawgSearch, loose: rawgSearchLoose, byId: rawgById },
  wikidata: { configured: () => true, search: wikidataSearch, loose: wikidataSearchLoose, byId: wikidataById },
};

const PREFERENCE: Catalog[] = ["igdb", "rawg", "wikidata"];
const downUntil = new Map<Catalog, number>();
const COOL_OFF_MS = 2 * 60 * 1000;

/** The catalogues to try, best first, skipping any that failed a moment ago. */
function order(): Catalog[] {
  const now = Date.now();
  const usable = PREFERENCE.filter((c) => SOURCES[c].configured());
  const up = usable.filter((c) => (downUntil.get(c) ?? 0) < now);
  return up.length ? up : ["wikidata"];
}

export function activeCatalog(): Catalog {
  return order()[0];
}

async function firstAnswer(kind: "search" | "loose", phrase: string, platforms: number[], limit: number): Promise<GameResult[]> {
  let lastError: unknown = null;
  for (const catalog of order()) {
    try {
      const games = await SOURCES[catalog][kind](phrase, platforms, limit);
      downUntil.delete(catalog);
      // An empty answer from the main catalogue: Wikidata may still know it
      if (games.length || catalog === "wikidata") return games;
    } catch (error) {
      lastError = error;
      if (catalog !== "wikidata") downUntil.set(catalog, Date.now() + COOL_OFF_MS);
      console.warn(`[games] ${catalog} failed, trying the next catalogue:`, (error as Error).message);
    }
  }
  if (lastError) throw lastError;
  return [];
}

export function searchGames(phrase: string, platforms: number[], limit = 20) {
  return firstAnswer("search", phrase, platforms, limit);
}

export function searchGamesLoose(phrase: string, platforms: number[], limit = 25) {
  return firstAnswer("loose", phrase, platforms, limit);
}

/** Games by id from the catalogue they were saved from. Never throws; unavailable ones are just missing. */
export async function gamesById(catalog: Catalog, ids: number[]): Promise<Map<number, GameResult>> {
  const source = SOURCES[catalog];
  if (!source?.configured()) return new Map();
  try {
    return await source.byId(ids);
  } catch (error) {
    console.warn(`[games] ${catalog} lookup failed:`, (error as Error).message);
    return new Map();
  }
}
