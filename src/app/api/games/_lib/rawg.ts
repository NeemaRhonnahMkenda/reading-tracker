// src/app/api/games/_lib/rawg.ts
// RAWG.io game catalogue: free key with just an email (rawg.io/apidocs), no
// Twitch account. Put it in .env.local (never NEXT_PUBLIC_):
//   RAWG_API_KEY=...
// RAWG asks for a credit link wherever its data is shown; the games page has one.

import { PLATFORMS, PLATFORM_IDS, detectPlatform } from "../../../games/_lib/platforms";
import { safeCoverUrl, type GameResult } from "../../../games/_lib/types";
import { CatalogNotConfigured } from "./server";

const BASE = "https://api.rawg.io/api";

export function rawgConfigured() {
  return !!process.env.RAWG_API_KEY?.trim();
}

function key() {
  const k = process.env.RAWG_API_KEY?.trim();
  if (!k) throw new CatalogNotConfigured("RAWG_API_KEY is not set");
  return k;
}

// Recent answers, so repeat searches and scans don't spend the monthly quota
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 30 * 60 * 1000;

async function rawg<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const cacheKey = url.toString(); // without the key
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;

  url.searchParams.set("key", key());
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (res.status === 401 || res.status === 403) {
    throw new CatalogNotConfigured(`RAWG rejected the key (${res.status}). Check RAWG_API_KEY.`);
  }
  if (!res.ok) throw new Error(`RAWG ${path} failed (${res.status})`);

  const data = (await res.json()) as T;
  cache.set(cacheKey, { at: Date.now(), data });
  if (cache.size > 800) cache.delete(cache.keys().next().value!);
  return data;
}

// ------------------------------------------------------------
// Platforms: RAWG has its own ids, matched to ours by name once a day
// ------------------------------------------------------------

const NAME_TO_OURS: Record<string, number> = {
  "playstation 5": 167,
  "playstation 4": 48,
  "playstation 3": 9,
  "playstation 2": 8,
  playstation: 7,
  psp: 38,
  "ps vita": 46,
  "playstation vita": 46,
  "nintendo switch 2": 508,
  "nintendo switch": 130,
  "wii u": 41,
  wii: 5,
  gamecube: 21,
  "nintendo gamecube": 21,
  "nintendo 64": 4,
  snes: 19,
  nes: 18,
  "new nintendo 3ds": 137,
  "nintendo 3ds": 37,
  "nintendo ds": 20,
  "nintendo dsi": 20,
  "game boy advance": 24,
  "game boy color": 22,
  "game boy": 33,
};

let platformMap: { at: number; toOurs: Map<number, number>; toRawg: Map<number, number[]> } | null = null;

async function platforms() {
  if (platformMap && Date.now() - platformMap.at < 24 * 60 * 60 * 1000) return platformMap;
  const toOurs = new Map<number, number>();
  for (let page = 1; page <= 4; page++) {
    const data = await rawg<{ next: string | null; results: { id: number; name: string }[] }>("/platforms", { page_size: 50, page });
    for (const p of data.results) {
      const name = p.name.toLowerCase().trim();
      const ours = NAME_TO_OURS[name] ?? detectPlatform(`${p.name} ${/nintendo|game boy|wii|nes/i.test(p.name) ? "nintendo" : "playstation"}`);
      if (ours && PLATFORM_IDS.includes(ours)) toOurs.set(p.id, ours);
    }
    if (!data.next) break;
  }
  const toRawg = new Map<number, number[]>();
  toOurs.forEach((ours, rawgId) => toRawg.set(ours, [...(toRawg.get(ours) ?? []), rawgId]));
  platformMap = { at: Date.now(), toOurs, toRawg };
  return platformMap;
}

async function rawgPlatformIds(ours: number[]): Promise<string> {
  const map = await platforms();
  const wanted = ours.length ? ours : PLATFORMS.map((p) => p.id);
  return [...new Set(wanted.flatMap((id) => map.toRawg.get(id) ?? []))].join(",");
}

// ------------------------------------------------------------
// Games
// ------------------------------------------------------------

interface RawgGame {
  id: number;
  slug?: string;
  name: string;
  released?: string | null;
  background_image?: string | null;
  platforms?: { platform: { id: number; name: string } }[] | null;
  genres?: { name: string }[];
  description_raw?: string;
  alternative_names?: string[];
}

async function toResult(g: RawgGame): Promise<GameResult> {
  const map = await platforms();
  const ours = [...new Set((g.platforms ?? []).map((p) => map.toOurs.get(p.platform.id)).filter((n): n is number => !!n))];
  return {
    catalog: "rawg",
    gameId: g.id,
    name: g.name,
    slug: g.slug && /^[a-z0-9-]{1,200}$/.test(g.slug) ? g.slug : null,
    coverUrl: safeCoverUrl(g.background_image ?? null),
    releaseYear: g.released ? Number(g.released.slice(0, 4)) || null : null,
    platforms: PLATFORMS.map((p) => p.id).filter((id) => ours.includes(id)),
    genres: (g.genres ?? []).map((x) => x.name).slice(0, 6),
    summary: g.description_raw ? g.description_raw.slice(0, 600) : null,
    alternativeNames: (g.alternative_names ?? []).slice(0, 12),
  };
}

async function search(phrase: string, ourPlatforms: number[], limit: number, precise: boolean): Promise<GameResult[]> {
  const platformsParam = await rawgPlatformIds(ourPlatforms);
  const data = await rawg<{ results: RawgGame[] }>("/games", {
    search: phrase.slice(0, 120),
    ...(precise ? { search_precise: true } : {}),
    ...(platformsParam ? { platforms: platformsParam } : {}),
    exclude_additions: true, // no DLC
    page_size: Math.min(40, limit),
  });
  const results = await Promise.all(data.results.map(toResult));
  return results.filter((g) => g.platforms.length > 0);
}

/** Games matching a phrase on the given platforms (closest wording first). */
export function rawgSearch(phrase: string, ourPlatforms: number[], limit = 20) {
  return search(phrase, ourPlatforms, limit, true);
}

/** RAWG's fuzzy search, for typos and partial names. */
export function rawgSearchLoose(phrase: string, ourPlatforms: number[], limit = 25) {
  return search(phrase, ourPlatforms, limit, false);
}

/** Specific games by RAWG id (one request each; only used for a handful). */
export async function rawgById(ids: number[]): Promise<Map<number, GameResult>> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 8);
  const out = new Map<number, GameResult>();
  await Promise.all(
    clean.map(async (id) => {
      try {
        out.set(id, await toResult(await rawg<RawgGame>(`/games/${id}`)));
      } catch (error) {
        if (error instanceof CatalogNotConfigured) throw error;
        // a removed game just drops out
      }
    })
  );
  return out;
}
