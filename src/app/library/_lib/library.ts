// src/app/library/_lib/library.ts
// Data for the library page: types, filters, paged queries, the light
// "facets" query that powers filter options and stats, plus caches that
// make coming back to the page instant.

import { supabase } from "../../../lib/supabase";

// ============================================================
// Types
// ============================================================

export type BookStatus = "want_to_read" | "reading" | "finished" | "did_not_finish";

export interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  custom_cover_path: string | null;
  status: string | null;
  created_at: string;
  added_at: string | null;
  bought_from: string | null;
  binding: string | null;
  pages: number | null;
}

export type SortKey = "newest" | "oldest" | "title" | "author";
export type StatusFilter = "all" | BookStatus;

export interface LibraryFilters {
  search: string;
  status: StatusFilter;
  sort: SortKey;
  format: string; // binding, "" = any
  source: string; // bought_from, "" = any
  year: string; // year added, "" = any
  ownCover: boolean; // only books with your own cover photo
}

export const DEFAULT_FILTERS: LibraryFilters = {
  search: "",
  status: "all",
  sort: "newest",
  format: "",
  source: "",
  year: "",
  ownCover: false,
};

// One light row per book, used for filter options and stats
export interface Facet {
  status: string | null;
  author: string | null;
  bought_from: string | null;
  binding: string | null;
  pages: number | null;
  created_at: string;
}

// ============================================================
// Config
// ============================================================

export const PAGE_SIZE = 30;
export const COVER_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";

export const BOOK_COLUMNS =
  "id, user_id, title, author, cover_url, custom_cover_path, status, created_at, added_at, bought_from, binding, pages";

export const STATUS_META: Record<BookStatus, { label: string; short: string; dot: string; pill: string }> = {
  reading: { label: "Currently reading", short: "Reading", dot: "bg-[#7a947c]", pill: "bg-[#eef3ee] text-[#4a5c4b]" },
  want_to_read: { label: "Want to read", short: "Want to read", dot: "bg-[#9a86b9]", pill: "bg-[#f1edf6] text-[#5f4f7a]" },
  finished: { label: "Finished", short: "Finished", dot: "bg-[#0f172a]", pill: "bg-[#0f172a]/[0.07] text-[#0f172a]" },
  did_not_finish: { label: "Did not finish", short: "DNF", dot: "bg-[#b07a6a]", pill: "bg-[#f6ebe7] text-[#7a3f33]" },
};

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Recently added" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "Author A–Z" },
];

export function normaliseStatus(status: string | null): BookStatus {
  return status === "reading" || status === "finished" || status === "did_not_finish" ? status : "want_to_read";
}

export function filtersKey(f: LibraryFilters) {
  return JSON.stringify([f.search.trim().toLowerCase(), f.status, f.sort, f.format, f.source, f.year, f.ownCover]);
}

// Filters other than search and sort (shown as removable chips)
export function activeFilterCount(f: LibraryFilters) {
  return [f.status !== "all", !!f.format, !!f.source, !!f.year, f.ownCover].filter(Boolean).length;
}

// Does a newly added book belong in the current view?
export function bookMatches(book: Book, f: LibraryFilters) {
  const term = f.search.trim().toLowerCase();
  if (term && !book.title.toLowerCase().includes(term) && !(book.author ?? "").toLowerCase().includes(term)) return false;
  if (f.status !== "all" && normaliseStatus(book.status) !== f.status) return false;
  if (f.format && book.binding !== f.format) return false;
  if (f.source && book.bought_from !== f.source) return false;
  if (f.year && new Date(book.created_at).getFullYear() !== Number(f.year)) return false;
  if (f.ownCover && !book.custom_cover_path) return false;
  return true;
}

// ============================================================
// Queries
// ============================================================

// Make user input safe inside a PostgREST or() filter
function toSearchPattern(term: string) {
  const cleaned = term
    .replace(/[\\%_]/g, (m) => `\\${m}`) // escape LIKE wildcards
    .replace(/[,()*:"]/g, " ") // characters that break or() syntax
    .trim();
  return cleaned ? `%${cleaned}%` : null;
}

export async function fetchBooksPage(opts: { userId: string; filters: LibraryFilters; from: number; to: number; withCount: boolean }) {
  const f = opts.filters;

  let query = supabase
    .from("books")
    .select(BOOK_COLUMNS, opts.withCount ? { count: "exact" } : undefined)
    .eq("user_id", opts.userId);

  if (f.status !== "all") query = query.eq("status", f.status);

  if (f.format) query = query.eq("binding", f.format);
  if (f.source) query = query.eq("bought_from", f.source);
  if (f.ownCover) query = query.not("custom_cover_path", "is", null);

  if (f.year) {
    const y = Number(f.year);
    query = query.gte("created_at", `${y}-01-01T00:00:00Z`).lt("created_at", `${y + 1}-01-01T00:00:00Z`);
  }

  const pattern = toSearchPattern(f.search);
  if (pattern) query = query.or(`title.ilike.${pattern},author.ilike.${pattern}`);

  switch (f.sort) {
    case "oldest":
      query = query.order("created_at", { ascending: true });
      break;
    case "title":
      query = query.order("title", { ascending: true });
      break;
    case "author":
      query = query.order("author", { ascending: true, nullsFirst: false }).order("title", { ascending: true });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  return query.order("id").range(opts.from, opts.to);
}

export async function fetchFacets(userId: string) {
  const { data, error } = await supabase
    .from("books")
    .select("status, author, bought_from, binding, pages, created_at")
    .eq("user_id", userId);

  if (error) {
    console.error("Library facets failed:", error.message);
    return null;
  }
  return (data ?? []) as Facet[];
}

// ============================================================
// Signed cover URLs (cached in memory + sessionStorage)
// ============================================================

const SIGNED_URL_TTL = 60 * 60;
const SIGNED_URL_MIN_REMAINING = 5 * 60 * 1000;
const SIGNED_STORAGE_KEY = "archive:signed-covers";

let signedUrlCache: Record<string, { url: string; expiresAt: number }> = {};
let signedCacheLoaded = false;

function loadSignedCache() {
  if (signedCacheLoaded || typeof window === "undefined") return;
  signedCacheLoaded = true;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SIGNED_STORAGE_KEY) || "{}") as typeof signedUrlCache;
    const now = Date.now();
    for (const [path, entry] of Object.entries(parsed)) {
      if (entry.expiresAt - now > SIGNED_URL_MIN_REMAINING) signedUrlCache[path] = entry;
    }
  } catch {
    // ignore
  }
}

export function validSignedUrls(): Record<string, string> {
  loadSignedCache();
  const now = Date.now();
  const map: Record<string, string> = {};
  for (const [path, entry] of Object.entries(signedUrlCache)) {
    if (entry.expiresAt - now > SIGNED_URL_MIN_REMAINING) map[path] = entry.url;
  }
  return map;
}

// Signs only the paths that aren't cached yet; returns every valid URL
export async function signCovers(rows: Pick<Book, "custom_cover_path">[]) {
  loadSignedCache();
  const now = Date.now();
  const missing = Array.from(
    new Set(
      rows
        .map((b) => b.custom_cover_path)
        .filter((p): p is string => !!p)
        .filter((p) => !signedUrlCache[p] || signedUrlCache[p].expiresAt - now < SIGNED_URL_MIN_REMAINING)
    )
  );

  if (missing.length > 0) {
    const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrls(missing, SIGNED_URL_TTL);
    if (error || !data) {
      console.error("Error signing cover URLs:", error?.message);
    } else {
      const expiresAt = Date.now() + SIGNED_URL_TTL * 1000;
      data.forEach((item) => {
        if (item.path && item.signedUrl) signedUrlCache[item.path] = { url: item.signedUrl, expiresAt };
      });
      try {
        sessionStorage.setItem(SIGNED_STORAGE_KEY, JSON.stringify(signedUrlCache));
      } catch {
        // ignore
      }
    }
  }
  return validSignedUrls();
}

// ============================================================
// Page cache (survives navigating away and back) and sign-out cleanup
// ============================================================

export interface LibraryCache {
  userId: string;
  filters: LibraryFilters;
  books: Book[];
  totalMatching: number;
  facets: Facet[] | null;
  fetchedAt: number;
}

let libraryCache: LibraryCache | null = null;
export const getLibraryCache = () => libraryCache;
export const setLibraryCache = (next: LibraryCache | null) => {
  libraryCache = next;
};

export const RETURN_KEY = "archive:library-return";
export const VIEW_KEY = "archive:library-view";

let listenerStarted = false;
export function ensureSignOutCleanup() {
  if (listenerStarted || typeof window === "undefined") return;
  listenerStarted = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event !== "SIGNED_OUT") return;
    libraryCache = null;
    signedUrlCache = {};
    try {
      sessionStorage.removeItem(SIGNED_STORAGE_KEY);
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      // ignore
    }
  });
}

// ============================================================
// Scroll restoration
// ============================================================

export interface ReturnState {
  bookId: string;
  scrollY: number;
  filters: LibraryFilters;
  savedAt: number;
}

const RETURN_MAX_AGE = 30 * 60 * 1000;

export function readReturnState(): ReturnState | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReturnState;
    if (!parsed?.bookId || !parsed.filters || Date.now() - parsed.savedAt > RETURN_MAX_AGE) {
      sessionStorage.removeItem(RETURN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveReturnState(state: ReturnState) {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: navigation still works
  }
}

export function clearReturnState() {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }
}

// ============================================================
// Stats from facets
// ============================================================

export interface LibraryStatsData {
  total: number;
  counts: Record<BookStatus, number>;
  addedThisYear: number;
  addedThisMonth: number;
  pages: number;
  shelfMetres: number; // stacked height
  topAuthor: { name: string; count: number } | null;
  topSource: { name: string; count: number } | null;
  collectingSince: string | null; // "Mar 2021"
  formats: string[];
  sources: string[];
  years: number[];
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function topOf(values: (string | null)[]) {
  const map = new Map<string, number>();
  values.forEach((v) => {
    const key = v?.trim();
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  });
  let best: { name: string; count: number } | null = null;
  map.forEach((count, name) => {
    if (!best || count > best.count) best = { name, count };
  });
  return best as { name: string; count: number } | null;
}

function distinct(values: (string | null)[]) {
  return Array.from(new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

export function computeLibraryStats(facets: Facet[]): LibraryStatsData {
  const now = new Date();
  const counts: Record<BookStatus, number> = { reading: 0, want_to_read: 0, finished: 0, did_not_finish: 0 };
  let addedThisYear = 0;
  let addedThisMonth = 0;
  let pages = 0;
  let earliest: Date | null = null;
  const years = new Set<number>();

  for (const f of facets) {
    counts[normaliseStatus(f.status)]++;
    pages += f.pages ?? 0;

    const added = new Date(f.created_at);
    if (!Number.isNaN(added.getTime())) {
      years.add(added.getFullYear());
      if (added.getFullYear() === now.getFullYear()) {
        addedThisYear++;
        if (added.getMonth() === now.getMonth()) addedThisMonth++;
      }
      if (!earliest || added < earliest) earliest = added;
    }
  }

  // A page is roughly 0.06 mm; add ~4 mm per book for covers
  const shelfMetres = (pages * 0.06 + facets.length * 4) / 1000;
  const since = earliest as Date | null;

  return {
    total: facets.length,
    counts,
    addedThisYear,
    addedThisMonth,
    pages,
    shelfMetres,
    topAuthor: topOf(facets.map((f) => f.author)),
    topSource: topOf(facets.map((f) => f.bought_from)),
    collectingSince: since ? `${MONTHS_SHORT[since.getMonth()]} ${since.getFullYear()}` : null,
    formats: distinct(facets.map((f) => f.binding)),
    sources: distinct(facets.map((f) => f.bought_from)),
    years: Array.from(years).sort((a, b) => b - a),
  };
}

export function formatAdded(book: Pick<Book, "added_at" | "created_at">) {
  const d = new Date(book.added_at ?? book.created_at);
  return Number.isNaN(d.getTime()) ? "" : `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
