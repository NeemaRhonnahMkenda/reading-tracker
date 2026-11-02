// src/app/games/_lib/match.ts
// Turns a store product title ("Elden Ring - Launch Edition (PS5) PAL") into a
// clean search phrase, and scores how well a game from IGDB fits it.
// Shared by the browser and the API routes.

import { detectPlatform, stripPlatformWords } from "./platforms";

// Words that describe the box, not the game. Kept away from words that start
// real titles ("New Super Mario Bros", "Among Us", "Game Builder Garage").
const NOISE = [
  "standard edition",
  "launch edition",
  "day one edition",
  "day 1 edition",
  "limited edition",
  "special edition",
  "deluxe edition",
  "collector's edition",
  "collectors edition",
  "game of the year edition",
  "goty edition",
  "greatest hits",
  "platinum",
  "essentials",
  "playstation hits",
  "nintendo selects",
  "players choice",
  "player's choice",
  "video game",
  "videogame",
  "physical",
  "disc",
  "cartridge",
  "brand new",
  "sealed",
  "region free",
  "pal",
  "ntsc",
  "ntsc-u",
  "ntsc-j",
  "uk",
  "eu",
  "usa",
  "import",
  "version",
  "edition",
];

const NOISE_RE = new RegExp(
  `(^|[^a-z0-9])(${NOISE.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")})(?![a-z0-9])`,
  "gi"
);

/** A store/barcode product title made into a phrase worth searching for. */
export function cleanProductTitle(title: string): string {
  let t = title
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ") // (PS5), [PAL]
    .replace(/[™®©]/g, "");
  t = stripPlatformWords(t);
  t = ` ${t} `.replace(NOISE_RE, "$1 ");
  t = t
    .replace(/\s[-–|:]\s*$/g, " ")
    .replace(/^\s*[-–|:]\s/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s[-–|]\s/g, " ")
    .trim();
  return t;
}

/** Edition words worth keeping on the copy, e.g. "Collector's Edition". */
export function detectEdition(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = /(standard|launch|day one|day 1|limited|special|deluxe|collector'?s|game of the year|goty|gold|ultimate|complete|definitive|premium|steelbook)\s+edition/i.exec(
    title
  );
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (word === "standard") return null;
  const pretty = word === "goty" ? "Game of the Year" : word
          .replace("collectors", "collector's")
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
  return `${pretty} Edition`;
}

/** Region from a product title or a PriceCharting console name. */
export function detectRegion(text: string | null | undefined): "PAL" | "NTSC-U" | "NTSC-J" | null {
  if (!text) return null;
  if (/\bpal\b|\b(uk|eu|europe|european)\b/i.test(text)) return "PAL";
  if (/\bjp\b|\bjapan(ese)?\b|ntsc-j/i.test(text)) return "NTSC-J";
  if (/\bntsc(-u)?\b|\busa?\b/i.test(text)) return "NTSC-U";
  return null;
}

// ------------------------------------------------------------
// Similarity
// ------------------------------------------------------------

const ROMAN: Record<string, string> = { ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13", xv: "15", xvi: "16" };
const STOP = new Set(["the", "a", "an", "of", "and", "&"]);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
    .filter((w) => !STOP.has(w));
}

function trigrams(text: string): Set<string> {
  const s = `  ${text} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** 0..1: how alike two titles are, by shared words and shared letter runs. */
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const ja = wa.join(" ");
  const jb = wb.join(" ");
  if (ja === jb) return 1;

  const setB = new Set(wb);
  const shared = wa.filter((w) => setB.has(w)).length;
  const wordScore = (2 * shared) / (wa.length + wb.length);

  const ta = trigrams(ja);
  const tb = trigrams(jb);
  let common = 0;
  ta.forEach((t) => tb.has(t) && common++);
  const triScore = (2 * common) / (ta.size + tb.size);

  // Numbers must agree: "FIFA 23" is not "FIFA 24", "Mario Kart 8" is not "Mario Kart 7"
  const na = wa.filter((w) => /^\d+$/.test(w));
  const nb = wb.filter((w) => /^\d+$/.test(w));
  const numberClash = na.length > 0 && nb.length > 0 && !na.some((n) => nb.includes(n));

  const score = Math.max(wordScore, triScore) * 0.6 + Math.min(wordScore, triScore) * 0.4;
  return numberClash ? score * 0.45 : score;
}

export interface Scorable {
  name: string;
  platforms: number[];
  releaseYear: number | null;
  alternativeNames?: string[];
}

/**
 * 0..1: how much of a game's name appears in a longer shop title.
 * "Cyberpunk 2077" is fully inside "Cyberpunk 2077 Ultimate Edition PS5 Game".
 */
export function containment(name: string, text: string): number {
  const wn = words(name);
  const wt = new Set(words(text));
  if (!wn.length || !wt.size) return 0;
  const found = wn.filter((w) => wt.has(w)).length;
  // Numbers in the name must be there: "FIFA 23" is not inside "FIFA 24 PS5"
  const missingNumber = wn.some((w) => /^\d+$/.test(w) && !wt.has(w));
  const ratio = found / wn.length;
  return missingNumber ? ratio * 0.4 : ratio;
}

function nameScore(name: string, phrase: string) {
  const sim = titleSimilarity(name, phrase);
  const inside = containment(name, phrase);
  // Fully contained names win, longer contained names more so ("Doom Eternal" over "Doom")
  return Math.max(sim, inside * 0.6 + sim * 0.4);
}

/** 0..1 confidence that a game is the product described. */
export function scoreGame(game: Scorable, phrase: string | string[], platformHint: number | null): number {
  const names = [game.name, ...(game.alternativeNames ?? [])];
  const phrases = (Array.isArray(phrase) ? phrase : [phrase]).filter(Boolean);
  if (!phrases.length) return 0;
  // Best fit against each phrase, then reward agreement across several sources
  const perPhrase = phrases.map((p) => Math.max(...names.map((n) => nameScore(n, p))));
  const best = Math.max(...perPhrase);
  const support = phrases.length > 1 ? perPhrase.filter((v) => v >= 0.7).length / phrases.length : 1;
  let score = phrases.length > 1 ? best * 0.8 + support * 0.2 : best;
  if (platformHint) score += game.platforms.includes(platformHint) ? 0.08 : -0.25;
  return Math.max(0, Math.min(1, score));
}

export function confidenceLabel(score: number): "strong" | "likely" | "check" {
  if (score >= 0.85) return "strong";
  if (score >= 0.6) return "likely";
  return "check";
}

// ------------------------------------------------------------
// Web results -> game titles (how a Google search for a barcode is read)
// ------------------------------------------------------------

const SHOP_WORDS =
  /\b(buy|buy now|shop|price|prices|cheapest|best price|compare|in stock|out of stock|pre-?order|free delivery|delivery|shipping|for sale|sale|deal|deals|offer|online|reviews|ean|upc|gtin|barcode|brand new|sealed)\b/gi;

// Sites that list barcodes: their names often sit at the end of a title
const SITE_SUFFIX = /\s[|–—-]\s[^|–—-]*(amazon|ebay|walmart|target|argos|game\.|game uk|currys|smyths|jumia|takealot|bol\.com|fnac|mediamarkt|cex|gamestop|best buy|bestbuy|pricecharting|upcitemdb|ean-search|barcode|\.com|\.co\.|\.net|\.org|\.de|\.fr|\.pl|\.it|\.es|\.nl|\.ke)[^|–—-]*$/i;

export interface WebHit {
  title: string;
  snippet?: string;
}

function cleanWebTitle(title: string, code: string): string {
  let t = title;
  // Drop "| Site" / "- Site" endings, repeatedly
  for (let i = 0; i < 3; i++) t = t.replace(SITE_SUFFIX, "");
  t = t.replace(/\s\|\s.*$/, ""); // anything after a pipe is the site
  t = t.replace(new RegExp(code.replace(/^0/, "0?"), "g"), " ").replace(/\b\d{12,14}\b/g, " ");
  t = t.replace(SHOP_WORDS, " ").replace(/\.{3}|…/g, " ");
  return cleanProductTitle(t);
}

/**
 * Likely game titles from web search results for a barcode, most agreed first,
 * plus the platform most results mention.
 */
export function titlesFromWeb(
  hits: WebHit[],
  code: string
): { titles: string[]; platform: number | null; region: ReturnType<typeof detectRegion>; edition: string | null } {
  const platformVotes = new Map<number, number>();
  const regionVotes = new Map<string, number>();
  const editionVotes = new Map<string, number>();
  const titles: { text: string; votes: number; order: number }[] = [];

  hits.slice(0, 10).forEach((hit, order) => {
    const raw = `${hit.title} ${hit.snippet ?? ""}`;
    const p = detectPlatform(raw);
    if (p) platformVotes.set(p, (platformVotes.get(p) ?? 0) + 1);
    const r = detectRegion(hit.title);
    if (r) regionVotes.set(r, (regionVotes.get(r) ?? 0) + 1);
    const e = detectEdition(hit.title);
    if (e) editionVotes.set(e, (editionVotes.get(e) ?? 0) + 1);

    const t = cleanWebTitle(hit.title, code);
    if (words(t).length === 0 || t.length > 90) return;
    // Merge titles that say the same thing
    const same = titles.find((x) => titleSimilarity(x.text, t) >= 0.8);
    if (same) {
      same.votes += 1;
      if (t.length < same.text.length) same.text = t; // shorter usually has less shop noise
    } else {
      titles.push({ text: t, votes: 1, order });
    }
  });

  const top = <K,>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    titles: titles.sort((a, b) => b.votes - a.votes || a.order - b.order).slice(0, 4).map((t) => t.text),
    platform: top(platformVotes),
    region: top(regionVotes) as ReturnType<typeof detectRegion>,
    // Only when most results agree, so a bundle listing doesn't set it
    edition: (() => {
      const e = top(editionVotes);
      return e && (editionVotes.get(e) ?? 0) * 2 >= Math.min(hits.length, 10) ? e : null;
    })(),
  };
}

export { detectPlatform };
