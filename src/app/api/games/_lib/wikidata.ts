// src/app/api/games/_lib/wikidata.ts
// Wikidata: the free database behind Wikipedia. No account or key needed, so
// it's always available, and it's used automatically when RAWG or IGDB is down.
// Data is CC0. Covers are rarer than on RAWG or IGDB (Wikimedia Commons only
// hosts freely licensed images), so many games show the painted cover instead.
//
// Wikimedia asks every app to identify itself. Optional, in .env.local:
//   WIKIMEDIA_CONTACT=you@example.com     shown in the User-Agent
//   WIKIMEDIA_API_TOKEN=...               personal API token, higher limits

import { createHash } from "node:crypto";
import { PLATFORMS, PLATFORM_IDS, detectPlatform } from "../../../games/_lib/platforms";
import { safeCoverUrl, type GameResult } from "../../../games/_lib/types";

const API = "https://www.wikidata.org/w/api.php";
const VIDEO_GAME = "Q7889";

function headers(): HeadersInit {
  const contact = process.env.WIKIMEDIA_CONTACT?.trim() || "personal library app";
  const h: Record<string, string> = {
    "User-Agent": `TheArchive/1.0 (games collection; ${contact})`,
    "Api-User-Agent": `TheArchive/1.0 (${contact})`,
    Accept: "application/json",
  };
  const token = process.env.WIKIMEDIA_API_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// ------------------------------------------------------------
// Requests: cached, one at a time, backing off when asked to
// ------------------------------------------------------------

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 6 * 60 * 60 * 1000; // Wikidata changes slowly
let queue: Promise<unknown> = Promise.resolve();
let pausedUntil = 0;

async function api<T>(params: Record<string, string | number>): Promise<T> {
  const url = new URL(API);
  Object.entries({ format: "json", formatversion: 2, maxlag: 5, ...params }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;

  const run = async (): Promise<T> => {
    if (Date.now() < pausedUntil) throw new Error("Wikidata asked us to slow down; try again shortly");
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (res.status === 429 || res.status === 503) {
      const wait = Number(res.headers.get("retry-after")) || 30;
      pausedUntil = Date.now() + Math.min(wait, 300) * 1000;
      throw new Error(`Wikidata is busy (${res.status})`);
    }
    if (!res.ok) throw new Error(`Wikidata failed (${res.status})`);
    const data = (await res.json()) as T & { error?: { code?: string } };
    if (data.error?.code === "maxlag") throw new Error("Wikidata is busy (maxlag)");
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 1500) cache.delete(cache.keys().next().value!);
    return data;
  };

  // One request at a time from this server, a little apart
  const next = queue.then(() => new Promise((r) => setTimeout(r, 120))).then(run);
  queue = next.catch(() => undefined);
  return next;
}

// ------------------------------------------------------------
// Entities
// ------------------------------------------------------------

interface Snak {
  mainsnak?: { datavalue?: { value?: unknown } };
  rank?: "preferred" | "normal" | "deprecated";
}
interface Entity {
  id: string;
  missing?: string;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, { value: string }[]>;
  claims?: Record<string, Snak[]>;
}

function values(e: Entity, prop: string): unknown[] {
  return (e.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated").map((c) => c.mainsnak?.datavalue?.value).filter((v) => v != null);
}
function ids(e: Entity, prop: string): string[] {
  return values(e, prop)
    .map((v) => (v as { id?: string }).id)
    .filter((id): id is string => !!id && /^Q\d+$/.test(id));
}

async function entities(qids: string[], props: string): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  const clean = [...new Set(qids.filter((q) => /^Q\d+$/.test(q)))];
  for (let i = 0; i < clean.length; i += 50) {
    const data = await api<{ entities?: Record<string, Entity> }>({
      action: "wbgetentities",
      ids: clean.slice(i, i + 50).join("|"),
      props,
      languages: "en",
      languagefallback: 1,
    });
    Object.values(data.entities ?? {}).forEach((e) => !e.missing && out.set(e.id, e));
  }
  return out;
}

// Labels of platforms and genres never change: kept for the life of the server
const labelCache = new Map<string, string>();

async function labels(qids: string[]): Promise<Map<string, string>> {
  const missing = qids.filter((q) => !labelCache.has(q));
  if (missing.length) {
    const found = await entities(missing, "labels");
    missing.forEach((q) => labelCache.set(q, found.get(q)?.labels?.en?.value ?? ""));
  }
  return labelCache;
}

// Wikidata's platform names, matched exactly before guessing
const PLATFORM_LABELS: Record<string, number> = {
  "playstation 5": 167,
  "playstation 4": 48,
  "playstation 3": 9,
  "playstation 2": 8,
  playstation: 7,
  "playstation portable": 38,
  "playstation vita": 46,
  "nintendo switch 2": 508,
  "nintendo switch": 130,
  "wii u": 41,
  wii: 5,
  "nintendo gamecube": 21,
  gamecube: 21,
  "nintendo 64": 4,
  "super nintendo entertainment system": 19,
  "nintendo entertainment system": 18,
  "new nintendo 3ds": 137,
  "nintendo 3ds": 37,
  "nintendo ds": 20,
  "nintendo dsi": 20,
  "game boy advance": 24,
  "game boy color": 22,
  "game boy": 33,
};

function ourPlatform(label: string): number | null {
  const l = label.toLowerCase().trim();
  if (!l) return null;
  if (PLATFORM_LABELS[l]) return PLATFORM_LABELS[l];
  const guess = detectPlatform(l);
  return guess && PLATFORM_IDS.includes(guess) ? guess : null;
}

/** A Commons file name as a direct image URL (the same layout Commons uses). */
function commonsUrl(fileName: string): string | null {
  const name = fileName.replace(/ /g, "_");
  if (!/\.(jpe?g|png|webp|svg)$/i.test(name)) return null;
  const md5 = createHash("md5").update(name).digest("hex");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return safeCoverUrl(`https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0, 2)}/${encoded}`);
}

async function toResults(found: Map<string, Entity>, order: string[]): Promise<GameResult[]> {
  const games = order.map((q) => found.get(q)).filter((e): e is Entity => !!e && ids(e, "P31").length > 0);
  const known = await labels([...new Set(games.flatMap((e) => [...ids(e, "P400"), ...ids(e, "P136")]))]);

  return games.map((e): GameResult => {
    const platforms = [...new Set(ids(e, "P400").map((q) => ourPlatform(known.get(q) ?? "")).filter((n): n is number => !!n))];
    const years = values(e, "P577")
      .map((v) => Number(String((v as { time?: string }).time ?? "").slice(1, 5)))
      .filter((y) => y > 1970 && y < 2100);
    const image = values(e, "P18").find((v) => typeof v === "string") as string | undefined;
    return {
      catalog: "wikidata",
      gameId: Number(e.id.slice(1)),
      name: e.labels?.en?.value ?? e.id,
      slug: e.id.toLowerCase(),
      coverUrl: image ? commonsUrl(image) : null,
      releaseYear: years.length ? Math.min(...years) : null,
      platforms: PLATFORMS.map((p) => p.id).filter((id) => platforms.includes(id)),
      genres: ids(e, "P136")
        .map((q) => known.get(q) ?? "")
        .filter(Boolean)
        .map((g) => g.replace(/ (video )?game$/i, "").replace(/^\w/, (c) => c.toUpperCase()))
        .slice(0, 6),
      summary: null,
      alternativeNames: (e.aliases?.en ?? []).map((a) => a.value).slice(0, 12),
    };
  });
}

// ------------------------------------------------------------
// Search
// ------------------------------------------------------------

async function search(phrase: string, ourPlatforms: number[], limit: number, fuzzy: boolean): Promise<GameResult[]> {
  const text = phrase
    .replace(/["\\]/g, " ")
    .replace(/\b(haswbstatement|insource|intitle|incategory|prefer-recent|boost-templates):\S*/gi, " ") // no search operators from users
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  if (text.length < 2) return [];
  const terms = fuzzy ? text.split(" ").map((w) => (w.length >= 4 ? `${w}~` : w)).join(" ") : text;

  const data = await api<{ query?: { search?: { title: string }[] } }>({
    action: "query",
    list: "search",
    srsearch: `${terms} haswbstatement:P31=${VIDEO_GAME}`,
    srnamespace: 0,
    srlimit: Math.min(40, limit + 15), // some won't be on PlayStation / Nintendo
    srprop: "",
  });
  const qids = (data.query?.search ?? []).map((r) => r.title).filter((t) => /^Q\d+$/.test(t));
  if (!qids.length) return [];

  const found = await entities(qids, "labels|aliases|claims");
  const wanted = ourPlatforms.length ? ourPlatforms : PLATFORM_IDS;
  return (await toResults(found, qids)).filter((g) => g.platforms.some((p) => wanted.includes(p))).slice(0, limit);
}

export function wikidataSearch(phrase: string, ourPlatforms: number[], limit = 20) {
  return search(phrase, ourPlatforms, limit, false);
}

/** Forgiving search for typos ("cyberpnk" finds Cyberpunk 2077). */
export function wikidataSearchLoose(phrase: string, ourPlatforms: number[], limit = 25) {
  return search(phrase, ourPlatforms, limit, true);
}

export async function wikidataById(gameIds: number[]): Promise<Map<number, GameResult>> {
  const qids = [...new Set(gameIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20).map((n) => `Q${n}`);
  if (!qids.length) return new Map();
  const found = await entities(qids, "labels|aliases|claims");
  return new Map((await toResults(found, qids)).map((g) => [g.gameId, g]));
}
