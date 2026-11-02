// src/app/api/games/_lib/server.ts
// Server-only helpers for the games API: who is asking, a small per-person
// rate limit, and IGDB (Twitch) access with a cached app token.
// RAWG lives in rawg.ts; catalog.ts picks whichever one is set up.
//
// IGDB needs, in .env.local (never NEXT_PUBLIC_):
//   TWITCH_CLIENT_ID=...
//   TWITCH_CLIENT_SECRET=...

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { PLATFORM_IDS } from "../../../games/_lib/platforms";
import type { GameResult } from "../../../games/_lib/types";

const NO_STORE = { "Cache-Control": "private, no-store" };

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export function jsonOk<T>(data: T) {
  return NextResponse.json(data, { headers: NO_STORE });
}

// ------------------------------------------------------------
// Auth: checked here as well as in the middleware
// ------------------------------------------------------------

export async function requireUser(): Promise<{ user: User; supabase: SupabaseClient } | NextResponse> {
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: () => {
        // Route handlers here only read the session; the middleware refreshes it
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to use this.", 401);
  return { user, supabase };
}

// ------------------------------------------------------------
// Rate limit: a few lookups per second per person, per server instance.
// Protects the shared IGDB and barcode quotas from one runaway tab.
// ------------------------------------------------------------

const buckets = new Map<string, { tokens: number; at: number }>();
const CAPACITY = 20;
const REFILL_PER_SEC = 2;

export function rateLimited(userId: string): NextResponse | null {
  const now = Date.now();
  const b = buckets.get(userId) ?? { tokens: CAPACITY, at: now };
  b.tokens = Math.min(CAPACITY, b.tokens + ((now - b.at) / 1000) * REFILL_PER_SEC);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(userId, b);
    return jsonError("Slow down a little and try again in a moment.", 429);
  }
  b.tokens -= 1;
  buckets.set(userId, b);
  if (buckets.size > 5000) buckets.clear();
  return null;
}

// ------------------------------------------------------------
// IGDB
// ------------------------------------------------------------

export class CatalogNotConfigured extends Error {}

/** 503 with a message the page can show, and the detail in the server log. */
export function notConfigured(error: Error) {
  console.error(`[games] ${error.message}`);
  return jsonError(
    "Game search isn't connected yet. Add RAWG_API_KEY (free from rawg.io/apidocs) to .env.local and restart the dev server.",
    503
  );
}

let token: { value: string; expires: number } | null = null;
let tokenPending: Promise<string> | null = null;

async function appToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  if (tokenPending) return tokenPending;

  const id = process.env.TWITCH_CLIENT_ID?.trim();
  const secret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new CatalogNotConfigured("TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not set");

  tokenPending = (async () => {
    const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" });
    const res = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) {
      // 400/403 here nearly always means a wrong client id or secret
      throw new CatalogNotConfigured(`Twitch rejected the IGDB keys (${res.status}). Check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return token.value;
  })();
  try {
    return await tokenPending;
  } finally {
    tokenPending = null;
  }
}

// IGDB allows 4 requests a second per app: queue calls 260ms apart
let lastCall = 0;
async function igdbSlot() {
  const wait = Math.max(0, lastCall + 260 - Date.now());
  lastCall = Math.max(Date.now(), lastCall + 260);
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// Recent answers, so repeat searches and scans don't spend quota
const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 30 * 60 * 1000;

async function igdb<T>(endpoint: string, query: string, retried = false): Promise<T> {
  const key = `${endpoint}\n${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data as T;

  await igdbSlot();
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID?.trim() ?? "",
      Authorization: `Bearer ${await appToken()}`,
      Accept: "application/json",
      "Content-Type": "text/plain",
    },
    body: query,
    signal: AbortSignal.timeout(9000),
    cache: "no-store",
  });

  if (res.status === 401 && !retried) {
    token = null; // expired or revoked: get a new one once
    return igdb<T>(endpoint, query, true);
  }
  if (res.status === 429 && !retried) {
    await new Promise((r) => setTimeout(r, 600));
    return igdb<T>(endpoint, query, true);
  }
  if (!res.ok) throw new Error(`IGDB ${endpoint} failed (${res.status})`);

  const data = (await res.json()) as T;
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 800) cache.delete(cache.keys().next().value!);
  return data;
}

interface IgdbGame {
  id: number;
  name: string;
  slug?: string;
  cover?: { image_id?: string };
  first_release_date?: number;
  platforms?: number[];
  genres?: { name: string }[];
  summary?: string;
  alternative_names?: { name: string }[];
  version_parent?: number;
}

const FIELDS =
  "fields name,slug,cover.image_id,first_release_date,platforms,genres.name,summary,alternative_names.name,version_parent;";

function toResult(g: IgdbGame): GameResult {
  return {
    catalog: "igdb",
    gameId: g.id,
    name: g.name,
    slug: g.slug && /^[a-z0-9-]{1,200}$/.test(g.slug) ? g.slug : null,
    coverUrl:
      g.cover?.image_id && /^[a-z0-9]{1,40}$/.test(g.cover.image_id)
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
        : null,
    releaseYear: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    platforms: (g.platforms ?? []).filter((p) => PLATFORM_IDS.includes(p)),
    genres: (g.genres ?? []).map((x) => x.name).slice(0, 6),
    summary: g.summary ? g.summary.slice(0, 600) : null,
    alternativeNames: (g.alternative_names ?? []).map((a) => a.name).slice(0, 12),
  };
}

/** IGDB's quoted-string escaping: backslashes and double quotes. */
function quote(text: string) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Games matching a phrase, only those released on the given platforms. */
export async function igdbSearch(phrase: string, platforms: number[], limit = 20): Promise<GameResult[]> {
  const ids = platforms.filter((p) => Number.isInteger(p) && PLATFORM_IDS.includes(p));
  const where = `where platforms = (${(ids.length ? ids : PLATFORM_IDS).join(",")});`;
  const rows = await igdb<IgdbGame[]>("games", `search ${quote(phrase.slice(0, 120))}; ${FIELDS} ${where} limit ${limit};`);
  // Editions ("Deluxe Edition") point at their main game; keep the main game first
  return rows.map(toResult).filter((g) => g.platforms.length > 0);
}

/**
 * A looser search for when the normal one finds nothing: any game whose name
 * contains each of the longer words, e.g. "cyberpunk" finds "Cyberpunk 2077".
 */
export async function igdbSearchLoose(phrase: string, platforms: number[], limit = 25): Promise<GameResult[]> {
  const ids = platforms.filter((p) => Number.isInteger(p) && PLATFORM_IDS.includes(p));
  const terms = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  if (!terms.length) return [];
  const nameFilter = terms.map((t) => `name ~ *${quote(t)}*`).join(" & ");
  const rows = await igdb<IgdbGame[]>(
    "games",
    `${FIELDS} where ${nameFilter} & platforms = (${(ids.length ? ids : PLATFORM_IDS).join(",")}); sort total_rating_count desc; limit ${limit};`
  );
  return rows.map(toResult).filter((g) => g.platforms.length > 0);
}

/** Whether the Twitch keys are present (the page explains how to add them if not). */
export function igdbConfigured() {
  return !!(process.env.TWITCH_CLIENT_ID?.trim() && process.env.TWITCH_CLIENT_SECRET?.trim());
}

/** Specific games by IGDB id. */
export async function igdbById(ids: number[]): Promise<Map<number, GameResult>> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50);
  if (!clean.length) return new Map();
  const rows = await igdb<IgdbGame[]>("games", `${FIELDS} where id = (${clean.join(",")}); limit ${clean.length};`);
  return new Map(rows.map((g) => [g.id, toResult(g)]));
}
