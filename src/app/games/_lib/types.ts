// src/app/games/_lib/types.ts
// Shapes shared by the API routes and the page.

export type Catalog = "igdb" | "rawg" | "wikidata";

/** A game from a catalogue (IGDB, RAWG or Wikidata), trimmed to what the collection needs. */
export interface GameResult {
  catalog: Catalog;
  gameId: number;
  name: string;
  slug: string | null;
  coverUrl: string | null; // images.igdb.com, media.rawg.io or upload.wikimedia.org
  releaseYear: number | null;
  platforms: number[]; // only PlayStation / Nintendo platform ids
  genres: string[];
  summary: string | null;
  alternativeNames?: string[];
}

export interface RankedGame extends GameResult {
  score: number; // 0..1
}

/** An answer people have already confirmed for a code. */
export interface CommunityMatch {
  game: GameResult;
  platformId: number;
  edition: string | null;
  region: string | null;
  votes: number;
  mine: boolean;
}

/** What /api/games/code returns. */
export interface CodeLookup {
  code: string;
  kind: "barcode" | "product";
  platformHint: number | null;
  edition: string | null;
  region: string | null;
  community: CommunityMatch[];
  // What a barcode database calls the product, if one knew it
  product: { title: string; source: string } | null;
  searchedFor: string | null;
  suggestions: RankedGame[];
}

export type GameStatus = "owned" | "wishlist";
export type GameFormat = "physical" | "digital";
export type PlayStatus = "unplayed" | "playing" | "completed" | "dropped";
export type Condition = "sealed" | "complete" | "game_only" | "loose";
export type Region = "PAL" | "NTSC-U" | "NTSC-J" | "Asia" | "Other";

/** A row of user_games. */
export interface UserGame {
  id: string;
  catalog: Catalog;
  game_id: number;
  name: string;
  slug: string | null;
  cover_url: string | null;
  release_year: number | null;
  genres: string[];
  platform_id: number;
  platform_name: string;
  status: GameStatus;
  format: GameFormat;
  edition: string | null;
  region: Region | null;
  condition: Condition | null;
  play_status: PlayStatus;
  priority: number | null;
  code: string | null;
  notes: string | null;
  acquired_on: string | null;
  created_at: string;
  updated_at: string;
}

const COVER_URL = /^https:\/\/(images\.igdb\.com|media\.rawg\.io|upload\.wikimedia\.org)\/[A-Za-z0-9/_.%-]+$/;

/** True for cover URLs the app is willing to show and store. */
export function safeCoverUrl(url: string | null | undefined): string | null {
  return url && url.length <= 500 && COVER_URL.test(url) ? url : null;
}

/**
 * A cover sized for where it's shown. IGDB has named sizes; RAWG serves
 * resized copies under /media/resize/<width>/-/.
 */
export function coverSrc(url: string | null | undefined, size: "small" | "big" = "big"): string | null {
  const safe = safeCoverUrl(url);
  if (!safe) return null;
  if (safe.startsWith("https://images.igdb.com/")) {
    return safe.replace(/\/t_[a-z0-9_]+\//, `/${size === "small" ? "t_cover_small" : "t_cover_big"}/`);
  }
  if (safe.startsWith("https://upload.wikimedia.org/wikipedia/commons/") && !safe.includes("/thumb/")) {
    // Commons thumbnails: /thumb/a/ab/Name.jpg/400px-Name.jpg (SVGs come back as PNG)
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(\w\/\w{2})\/([^/]+)$/.exec(safe);
    if (!m) return safe;
    const width = size === "small" ? 120 : 400;
    return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${width}px-${m[2]}${/\.svg$/i.test(m[2]) ? ".png" : ""}`;
  }
  return safe.replace("https://media.rawg.io/media/games/", `https://media.rawg.io/media/resize/${size === "small" ? 200 : 640}/-/games/`);
}

export function catalogLink(catalog: Catalog, slug: string | null) {
  if (!slug) return null;
  if (catalog === "rawg") return `https://rawg.io/games/${slug}`;
  if (catalog === "wikidata") return /^q\d+$/.test(slug) ? `https://www.wikidata.org/wiki/${slug.toUpperCase()}` : null;
  return `https://www.igdb.com/games/${slug}`;
}
