// src/app/api/games/_lib/products.ts
// What a barcode is called in the shops. Tried in this order:
//   1. PriceCharting (PRICECHARTING_TOKEN, paid): built for games, exact console.
//   2. A web search for the barcode, the way Google finds it: shop listings
//      (Amazon, eBay, GAME, Jumia...) put the barcode on the product page, so
//      the result titles name the game. Needs one of:
//        SERPER_API_KEY        Google results (serper.dev)
//        BRAVE_SEARCH_API_KEY  Brave results (api-dashboard.search.brave.com)
//   3. UPCitemdb free trial: no key, 100 lookups a day, mostly US barcodes.
// Answers are cached for 30 days so each barcode costs one lookup.

import { upcForm } from "../../../games/_lib/platforms";
import { titlesFromWeb, type WebHit } from "../../../games/_lib/match";

export interface ProductName {
  titles: string[]; // best first; several when web results disagree a little
  console: string | null; // the platform as the source names it
  platformId: number | null; // when the source made the platform clear
  region: string | null;
  edition?: string | null;
  source: "PriceCharting" | "Google" | "Brave" | "UPCitemdb";
}

const MONTH = 60 * 60 * 24 * 30;

// ------------------------------------------------------------
// 1. PriceCharting
// ------------------------------------------------------------

async function priceCharting(code: string): Promise<ProductName | null> {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) return null;
  const url = `https://www.pricecharting.com/api/product?t=${encodeURIComponent(token)}&upc=${encodeURIComponent(upcForm(code))}`;
  const res = await fetch(url, { next: { revalidate: MONTH }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { status?: string; "product-name"?: string; "console-name"?: string };
  if (data.status !== "success" || !data["product-name"]) return null;
  return { titles: [data["product-name"]], console: data["console-name"] ?? null, platformId: null, region: null, source: "PriceCharting" };
}

// ------------------------------------------------------------
// 2. Web search
// ------------------------------------------------------------

async function serper(query: string): Promise<WebHit[] | null> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn(`Serper search failed (${res.status})`);
    return null;
  }
  const data = (await res.json()) as {
    organic?: { title?: string; snippet?: string }[];
    shopping?: { title?: string }[];
  };
  const shopping: WebHit[] = (data.shopping ?? []).filter((r) => r.title).map((r) => ({ title: r.title! }));
  const organic: WebHit[] = (data.organic ?? []).filter((r) => r.title).map((r) => ({ title: r.title!, snippet: r.snippet }));
  return [...shopping, ...organic];
}

async function brave(query: string): Promise<WebHit[] | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn(`Brave search failed (${res.status})`);
    return null;
  }
  const data = (await res.json()) as { web?: { results?: { title?: string; description?: string }[] } };
  return (data.web?.results ?? [])
    .filter((r) => r.title)
    .map((r) => ({ title: r.title!.replace(/<\/?strong>/g, ""), snippet: r.description?.replace(/<\/?strong>/g, "") }));
}

// Web answers are kept in memory too (POST requests aren't cached by Next)
const webCache = new Map<string, { at: number; value: ProductName | null }>();

async function webSearch(code: string): Promise<ProductName | null> {
  const hit = webCache.get(code);
  if (hit && Date.now() - hit.at < MONTH * 1000) return hit.value;

  const engines: [ProductName["source"], (q: string) => Promise<WebHit[] | null>][] = [
    ["Google", serper],
    ["Brave", brave],
  ];
  for (const [source, search] of engines) {
    // Shops list a barcode either way: as 13 digits (EAN) or 12 (UPC)
    let hits = await search(`"${code}"`);
    if (hits && hits.length < 3 && code.startsWith("0")) hits = [...hits, ...((await search(`"${upcForm(code)}"`)) ?? [])];
    if (!hits) continue; // engine not set up: try the next one
    const read = titlesFromWeb(hits, code);
    const value: ProductName | null = read.titles.length
      ? { titles: read.titles, console: null, platformId: read.platform, region: read.region, edition: read.edition, source }
      : null;
    webCache.set(code, { at: Date.now(), value });
    if (webCache.size > 2000) webCache.delete(webCache.keys().next().value!);
    return value;
  }
  return null;
}

export function webSearchConfigured() {
  return !!(process.env.SERPER_API_KEY || process.env.BRAVE_SEARCH_API_KEY);
}

// ------------------------------------------------------------
// 3. UPCitemdb
// ------------------------------------------------------------

async function upcItemDb(code: string): Promise<ProductName | null> {
  const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: MONTH },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null; // 429 = daily trial quota used up
  const data = (await res.json()) as { items?: { title?: string; category?: string; brand?: string }[] };
  const items = (data.items ?? []).filter((i) => i.title);
  if (!items.length) return null;
  return {
    titles: items.slice(0, 3).map((i) => i.title!),
    console: [items[0].category, items[0].brand].filter(Boolean).join(" ") || null,
    platformId: null,
    region: null,
    source: "UPCitemdb",
  };
}

/** The shop name for a barcode, trying the most accurate source first. Never throws. */
export async function productForBarcode(code: string): Promise<ProductName | null> {
  for (const source of [priceCharting, webSearch, upcItemDb]) {
    try {
      const found = await source(code);
      if (found) return found;
    } catch (error) {
      console.warn("barcode source failed", (error as Error).message);
    }
  }
  return null;
}
