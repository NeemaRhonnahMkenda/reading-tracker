"use client";

// src/app/library/page.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BrowserMultiFormatReader } from "@zxing/browser";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

// --------------------------------------------------
// Types
// --------------------------------------------------

interface Book {
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
}

interface BookResult {
  title: string | null;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  pages: number | null;
  binding: string | null;
  coverUrl: string | null;
  openLibraryId: string | null;
}

interface Counts {
  total: number;
  reading: number;
  finished: number;
}

type EntryMode = "type" | "scan";

// Saved when a book is opened, used to put the user back where they were
interface ReturnState {
  bookId: string;
  scrollY: number;
  search: string;
  filter: string;
  savedAt: number;
}

// --------------------------------------------------
// Config
// --------------------------------------------------

const COVER_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB
const SIGNED_URL_TTL = 60 * 60; // 1 hour
const SIGNED_URL_MIN_REMAINING = 5 * 60 * 1000; // re-sign when under 5 minutes left

const PAGE_SIZE = 30;
const REFRESH_AFTER = 60 * 1000; // quietly refresh cached data older than a minute
const MAX_SILENT_REFRESH = 150; // cap on rows re-fetched in a background refresh

// Only the columns the grid needs (not select *)
const BOOK_COLUMNS =
  "id, user_id, title, author, cover_url, custom_cover_path, status, created_at, added_at, bought_from";

const ALLOWED_COVER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Hosts configured in next.config images.remotePatterns (see notes)
const OPTIMIZED_COVER_HOSTS = [
  "covers.openlibrary.org",
  "archive.org",
  "books.google.com",
  "books.googleusercontent.com",
];

const EAGER_COVERS = 10; // first row or two load immediately

const STATUS_OPTIONS = [
  { value: "want_to_read", label: "Want to read", hint: "In the library" },
  { value: "reading", label: "Reading", hint: "On the nightstand" },
  { value: "finished", label: "Finished", hint: "Back on the shelf" },
] as const;

const FILTERS = [
  { value: "all", label: "All books" },
  { value: "reading", label: "Reading" },
  { value: "want_to_read", label: "Want to read" },
  { value: "finished", label: "Finished" },
  { value: "did_not_finish", label: "Did not finish" },
] as const;

const ISBN_PATTERN = /^(?:\d{10}|\d{9}X|\d{13})$/i;

// Scroll restoration
const RETURN_KEY = "archive:library-return";
const RETURN_MAX_AGE = 30 * 60 * 1000;
const HIGHLIGHT_MS = 1800;

const SIGNED_STORAGE_KEY = "archive:signed-covers";

// --------------------------------------------------
// In-memory cache (survives navigating away and back)
// --------------------------------------------------

interface LibraryCache {
  userId: string;
  filter: string;
  search: string;
  books: Book[];
  totalMatching: number;
  counts: Counts | null;
  fetchedAt: number;
}

let libraryCache: LibraryCache | null = null;

// path -> { url, expiresAt }
let signedUrlCache: Record<string, { url: string; expiresAt: number }> = {};
let signedCacheLoaded = false;

let cacheListenerStarted = false;

// Clear cached private data the moment the user signs out
function ensureCacheListener() {
  if (cacheListenerStarted || typeof window === "undefined") return;
  cacheListenerStarted = true;

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      libraryCache = null;
      signedUrlCache = {};
      try {
        sessionStorage.removeItem(SIGNED_STORAGE_KEY);
        sessionStorage.removeItem(RETURN_KEY);
      } catch {
        // ignore
      }
    }
  });
}

function loadSignedCacheFromStorage() {
  if (signedCacheLoaded) return;
  signedCacheLoaded = true;
  try {
    const raw = sessionStorage.getItem(SIGNED_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as typeof signedUrlCache;
    const now = Date.now();
    for (const [path, entry] of Object.entries(parsed)) {
      if (entry.expiresAt - now > SIGNED_URL_MIN_REMAINING) signedUrlCache[path] = entry;
    }
  } catch {
    // ignore
  }
}

function persistSignedCache() {
  try {
    sessionStorage.setItem(SIGNED_STORAGE_KEY, JSON.stringify(signedUrlCache));
  } catch {
    // ignore
  }
}

function validSignedUrls(): Record<string, string> {
  const now = Date.now();
  const map: Record<string, string> = {};
  for (const [path, entry] of Object.entries(signedUrlCache)) {
    if (entry.expiresAt - now > SIGNED_URL_MIN_REMAINING) map[path] = entry.url;
  }
  return map;
}

// --------------------------------------------------
// Data helpers
// --------------------------------------------------

// Make user input safe inside a PostgREST or() filter
function toSearchPattern(term: string) {
  const cleaned = term
    .replace(/[\\%_]/g, (m) => `\\${m}`) // escape LIKE wildcards
    .replace(/[,()*:"]/g, " ") // characters that break or() syntax
    .trim();
  return cleaned ? `%${cleaned}%` : null;
}

async function fetchBooksPage(opts: {
  userId: string;
  filter: string;
  search: string;
  from: number;
  to: number;
  withCount: boolean;
}) {
  let query = supabase
    .from("books")
    .select(BOOK_COLUMNS, opts.withCount ? { count: "exact" } : undefined)
    .eq("user_id", opts.userId)
    .order("created_at", { ascending: false })
    .range(opts.from, opts.to);

  if (opts.filter !== "all") query = query.eq("status", opts.filter);

  const pattern = toSearchPattern(opts.search);
  if (pattern) query = query.or(`title.ilike.${pattern},author.ilike.${pattern}`);

  return query;
}

async function fetchCounts(userId: string): Promise<Counts | null> {
  const base = () => supabase.from("books").select("id", { count: "exact", head: true }).eq("user_id", userId);

  const [total, reading, finished] = await Promise.all([
    base(),
    base().eq("status", "reading"),
    base().eq("status", "finished"),
  ]);

  if (total.error || reading.error || finished.error) {
    console.error("Count query failed:", total.error?.message || reading.error?.message || finished.error?.message);
    return null;
  }

  return { total: total.count ?? 0, reading: reading.count ?? 0, finished: finished.count ?? 0 };
}

// --------------------------------------------------
// General helpers
// --------------------------------------------------

function cleanIsbn(value: string) {
  return value.replace(/[-\s]/g, "").toUpperCase();
}

function statusLabel(bookStatus: string | null) {
  switch (bookStatus) {
    case "reading":
      return "Currently reading";
    case "finished":
      return "Finished";
    case "did_not_finish":
      return "Did not finish";
    default:
      return "Want to read";
  }
}

function formatPublishedDate(date: string | null): string | null {
  if (!date) return null;
  if (/^\d{4}$/.test(date)) return `${date}-01-01`;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

async function sniffImageType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = String.fromCharCode(...bytes);
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

function canOptimize(src: string) {
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return false;
    return OPTIMIZED_COVER_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function readReturnState(): ReturnState | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReturnState;
    if (!parsed?.bookId || Date.now() - parsed.savedAt > RETURN_MAX_AGE) {
      sessionStorage.removeItem(RETURN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearReturnState() {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }
}

// --------------------------------------------------
// Book cover: optimised, lazy, fades in over a placeholder
// --------------------------------------------------

function BookCover({
  src,
  title,
  author,
  size = "md",
  eager = false,
  sizes = "(min-width: 1280px) 210px, (min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw",
}: {
  src: string | null;
  title: string;
  author?: string | null;
  size?: "md" | "lg";
  eager?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  // Images already in the browser cache may finish before React attaches onLoad
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) setLoaded(true);
  }, [src]);

  const placeholder = (
    <div className="w-full h-full p-5 flex flex-col justify-between bg-[#0f172a] text-[#Fdfaf3]">
      <span className="text-[10px] tracking-[0.2em] opacity-50">The Archive</span>
      <div>
        <p className={`font-classical leading-tight line-clamp-4 ${size === "lg" ? "text-xl" : "text-lg"}`}>{title}</p>
        {author && <p className="text-xs opacity-70 mt-2 line-clamp-2">{author}</p>}
      </div>
      <span className="self-end font-classical text-xl opacity-40">A</span>
    </div>
  );

  if (!src || failed) return placeholder;

  const imageClass = `object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`;

  return (
    <div className="relative w-full h-full">
      {/* Shimmer while the image loads */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-[#e9e4d9] transition-opacity duration-300 ${loaded ? "opacity-0" : "opacity-100 animate-pulse"}`}
      />

      {canOptimize(src) ? (
        <Image
          src={src}
          alt={`Cover of ${title}`}
          fill
          sizes={sizes}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={imageClass}
        />
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={`Cover of ${title}`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : "auto"}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full ${imageClass}`}
        />
      )}
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm">
      <span aria-hidden="true" className="mt-0.5">!</span>
      <span>{children}</span>
    </div>
  );
}

function GridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-7" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] rounded-lg bg-[#0f172a]/[0.06] animate-pulse" />
          <div className="mt-4 h-4 w-3/4 rounded-full bg-[#0f172a]/[0.06] animate-pulse" />
          <div className="mt-2 h-3 w-1/2 rounded-full bg-[#0f172a]/[0.05] animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ==================================================
// Page
// ==================================================

export default function Library() {
  // Start from the in-memory cache so returning to the page is instant
  const cached = libraryCache;

  // Library
  const [books, setBooks] = useState<Book[]>(() => cached?.books ?? []);
  const [totalMatching, setTotalMatching] = useState(() => cached?.totalMatching ?? 0);
  const [counts, setCounts] = useState<Counts | null>(() => cached?.counts ?? null);
  const [signedCovers, setSignedCovers] = useState<Record<string, string>>(() => (cached ? validSignedUrls() : {}));
  const [loading, setLoading] = useState(() => !cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  // Auth
  const [userId, setUserId] = useState<string | null>(() => cached?.userId ?? null);
  const userIdRef = useRef<string | null>(cached?.userId ?? null);

  // Library search/filter (search is debounced before it hits the database)
  const [search, setSearch] = useState(() => cached?.search ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => cached?.search ?? "");
  const [filter, setFilter] = useState(() => cached?.filter ?? "all");

  // Request bookkeeping
  const requestIdRef = useRef(0);
  const lastQueryKeyRef = useRef<string | null>(cached ? `${cached.filter}|${cached.search}` : null);
  const fetchedAtRef = useRef(cached?.fetchedAt ?? 0);
  const booksRef = useRef<Book[]>(books);
  booksRef.current = books;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Modal
  const [showAddBook, setShowAddBook] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("type");

  // ISBN search
  const [isbn, setIsbn] = useState("");
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [searchingBook, setSearchingBook] = useState(false);
  const [bookError, setBookError] = useState("");

  // Barcode scanner
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const hasScannedRef = useRef(false);

  // Custom cover
  const [customCoverFile, setCustomCoverFile] = useState<File | null>(null);
  const [customCoverType, setCustomCoverType] = useState<string | null>(null);
  const [customCoverPreview, setCustomCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Book details
  const [status, setStatus] = useState("want_to_read");
  const [boughtFrom, setBoughtFrom] = useState("");
  const [addingBook, setAddingBook] = useState(false);

  // Scroll restoration
  const [pendingReturn, setPendingReturn] = useState<ReturnState | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // --------------------------------------------------
  // Signed URLs: reuse cached ones, sign only what's missing, never block the grid
  // --------------------------------------------------

  const signCovers = useCallback(async (rows: Book[]) => {
    const now = Date.now();
    const missing = Array.from(
      new Set(
        rows
          .map((b) => b.custom_cover_path)
          .filter((p): p is string => !!p)
          .filter((p) => !signedUrlCache[p] || signedUrlCache[p].expiresAt - now < SIGNED_URL_MIN_REMAINING)
      )
    );

    if (missing.length === 0) {
      setSignedCovers(validSignedUrls());
      return;
    }

    const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrls(missing, SIGNED_URL_TTL);

    if (error || !data) {
      console.error("Error signing cover URLs:", error?.message);
      return;
    }

    const expiresAt = Date.now() + SIGNED_URL_TTL * 1000;
    data.forEach((item) => {
      if (item.path && item.signedUrl) signedUrlCache[item.path] = { url: item.signedUrl, expiresAt };
    });
    persistSignedCache();
    setSignedCovers(validSignedUrls());
  }, []);

  function coverFor(book: Book) {
    if (book.custom_cover_path && signedCovers[book.custom_cover_path]) {
      return signedCovers[book.custom_cover_path];
    }
    return book.cover_url;
  }

  // --------------------------------------------------
  // Loading data
  // --------------------------------------------------

  // First page for the current filter + search. `silent` refreshes in the
  // background without a spinner and without moving the scroll position.
  const loadFirstPage = useCallback(
    async (uid: string, nextFilter: string, nextSearch: string, silent = false) => {
      const requestId = ++requestIdRef.current;
      lastQueryKeyRef.current = `${nextFilter}|${nextSearch}`;

      if (!silent) {
        setLoading(true);
        setLoadError("");
      }

      const limit = silent
        ? Math.min(Math.max(PAGE_SIZE, booksRef.current.length), MAX_SILENT_REFRESH)
        : PAGE_SIZE;

      const { data, count, error } = await fetchBooksPage({
        userId: uid,
        filter: nextFilter,
        search: nextSearch,
        from: 0,
        to: limit - 1,
        withCount: true,
      });

      // A newer request has started; ignore this one
      if (requestId !== requestIdRef.current) return;

      if (error) {
        console.error("Error fetching books:", error.message);
        if (!silent) {
          setLoadError("Your books couldn't be loaded. Check your connection and try again.");
          setLoading(false);
        }
        return;
      }

      const rows = (data || []) as Book[];
      setBooks(rows);
      setTotalMatching(count ?? rows.length);
      fetchedAtRef.current = Date.now();
      setLoading(false);

      signCovers(rows); // not awaited: covers appear as they're signed
    },
    [signCovers]
  );

  const refreshCounts = useCallback(async (uid: string) => {
    const next = await fetchCounts(uid);
    if (next && userIdRef.current === uid) setCounts(next);
  }, []);

  const hasMore = books.length < totalMatching;

  const loadMore = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid || loadingMore || loading || !hasMore) return;

    setLoadingMore(true);
    const requestId = requestIdRef.current;
    const from = booksRef.current.length;

    const { data, error } = await fetchBooksPage({
      userId: uid,
      filter,
      search: debouncedSearch,
      from,
      to: from + PAGE_SIZE - 1,
      withCount: false,
    });

    setLoadingMore(false);

    // Filter or search changed while this was loading
    if (requestId !== requestIdRef.current) return;

    if (error) {
      console.error("Error loading more books:", error.message);
      setLoadError("More books couldn't be loaded. Try again.");
      return;
    }

    const rows = (data || []) as Book[];
    setBooks((current) => {
      const seen = new Set(current.map((b) => b.id));
      return [...current, ...rows.filter((b) => !seen.has(b.id))];
    });
    signCovers(rows);
  }, [loadingMore, loading, hasMore, filter, debouncedSearch, signCovers]);

  // --------------------------------------------------
  // Auth: load once, and only react when the user actually changes.
  // (Supabase emits SIGNED_IN again when you return to the tab; handling
  // that as a new sign-in is what made the page reload every time.)
  // --------------------------------------------------

  useEffect(() => {
    ensureCacheListener();
    loadSignedCacheFromStorage();

    let mounted = true;

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted) return;
      if (error) console.error("Session error:", error.message);

      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;
      setUserId(uid);

      if (!uid) {
        setBooks([]);
        setLoading(false);
        return;
      }

      // Coming back to the page with fresh-enough cached data: show it as-is,
      // refresh quietly in the background if it's getting old
      const cache = libraryCache;
      if (cache && cache.userId === uid) {
        setSignedCovers(validSignedUrls());
        if (Date.now() - cache.fetchedAt > REFRESH_AFTER) {
          loadFirstPage(uid, cache.filter, cache.search, true);
          refreshCounts(uid);
        }
        setPendingReturn(readReturnState());
        return;
      }

      // First visit this session (or after a full reload)
      const saved = readReturnState();
      const startFilter = saved?.filter ?? "all";
      const startSearch = saved?.search ?? "";
      if (saved) {
        setPendingReturn(saved);
        setFilter(startFilter);
        setSearch(startSearch);
        setDebouncedSearch(startSearch);
      }

      loadFirstPage(uid, startFilter, startSearch);
      refreshCounts(uid);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null;
      if (next === userIdRef.current) return; // same user: nothing to reload

      userIdRef.current = next;
      setUserId(next);
      libraryCache = null;

      if (!next) {
        setBooks([]);
        setCounts(null);
        setTotalMatching(0);
        setLoading(false);
        return;
      }

      loadFirstPage(next, "all", "");
      refreshCounts(next);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce typing before querying
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Re-query when the filter or (debounced) search changes
  useEffect(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    const key = `${filter}|${debouncedSearch}`;
    if (key === lastQueryKeyRef.current) return;
    loadFirstPage(uid, filter, debouncedSearch);
  }, [filter, debouncedSearch, loadFirstPage]);

  // Keep the in-memory cache up to date
  useEffect(() => {
    if (!userId || loading) return;
    libraryCache = {
      userId,
      filter,
      search: debouncedSearch,
      books,
      totalMatching,
      counts,
      fetchedAt: fetchedAtRef.current || Date.now(),
    };
  }, [userId, loading, filter, debouncedSearch, books, totalMatching, counts]);

  // Infinite scroll: load the next page as the end of the grid comes into view
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "800px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // --------------------------------------------------
  // Scroll restoration: back to the book you opened
  // --------------------------------------------------

  function rememberPosition(bookId: string) {
    const state: ReturnState = { bookId, scrollY: window.scrollY, search: debouncedSearch, filter, savedAt: Date.now() };
    try {
      sessionStorage.setItem(RETURN_KEY, JSON.stringify(state));
    } catch {
      // storage unavailable: navigation still works
    }
  }

  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
    return () => {
      if ("scrollRestoration" in window.history) window.history.scrollRestoration = "auto";
    };
  }, []);

  useEffect(() => {
    const saved = pendingReturn;
    if (!saved || loading) return;

    setPendingReturn(null);
    clearReturnState();

    // Not cancelled on re-render: clearing pendingReturn re-runs this effect
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(saved.bookId)}"]`);

      if (card) {
        card.scrollIntoView({ block: "center", behavior: "auto" });
        card.focus({ preventScroll: true });
        setHighlightId(saved.bookId);
      } else {
        window.scrollTo({ top: saved.scrollY, behavior: "auto" });
      }
    });
  }, [pendingReturn, loading]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  // --------------------------------------------------
  // Scanner teardown
  // --------------------------------------------------

  function teardownCamera() {
    if (scannerControlsRef.current) {
      try {
        scannerControlsRef.current.stop();
      } catch {
        // ignore
      }
      scannerControlsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // ignore
      }
      videoRef.current.srcObject = null;
    }
  }

  function stopBarcodeScanner() {
    teardownCamera();
    hasScannedRef.current = false;
    setScanning(false);
  }

  useEffect(() => {
    return () => teardownCamera();
  }, []);

  useEffect(() => {
    return () => {
      if (customCoverPreview) URL.revokeObjectURL(customCoverPreview);
    };
  }, [customCoverPreview]);

  useEffect(() => {
    if (!showAddBook) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !addingBook) closeAddBookModal();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddBook, addingBook]);

  // --------------------------------------------------
  // ISBN search
  // --------------------------------------------------

  async function searchBookByISBN(isbnValue: string) {
    const clean = cleanIsbn(isbnValue);

    if (!clean) {
      setBookError("Enter an ISBN to search.");
      return;
    }

    if (!ISBN_PATTERN.test(clean)) {
      setBookError("That doesn't look like an ISBN. Use 10 or 13 digits.");
      return;
    }

    setSearchingBook(true);
    setBookError("");
    setScannerError("");
    setBookResult(null);

    try {
      const response = await fetch(`/api/books/isbn/${encodeURIComponent(clean)}`);
      const data = await response.json();

      if (!response.ok) {
        setBookError(data.error || "No book matches that ISBN. Check the number and try again.");
        return;
      }

      setBookResult(data);
    } catch (error) {
      console.error("Book search error:", error);
      setBookError("The book search failed. Check your connection and try again.");
    } finally {
      setSearchingBook(false);
    }
  }

  // --------------------------------------------------
  // Barcode scanner
  // --------------------------------------------------

  async function startBarcodeScanner() {
    setScannerError("");
    setBookError("");
    setScanning(true);
    hasScannedRef.current = false;

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setScannerError("This browser can't use the camera. Type the ISBN instead.");
        setScanning(false);
        return;
      }

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();

      if (devices.length === 0) {
        setScannerError("No camera found. Type the ISBN instead.");
        setScanning(false);
        return;
      }

      // Labels are empty before permission; undefined lets ZXing ask for the rear camera
      const backCamera = devices.find((device) => {
        const label = device.label.toLowerCase();
        return label.includes("back") || label.includes("rear") || label.includes("environment");
      });

      if (!videoRef.current) {
        setScannerError("The camera couldn't start. Try again.");
        setScanning(false);
        return;
      }

      const codeReader = new BrowserMultiFormatReader();

      const controls = await codeReader.decodeFromVideoDevice(backCamera?.deviceId, videoRef.current, async (result) => {
        if (!result || hasScannedRef.current) return;

        const scanned = cleanIsbn(result.getText());

        if (!ISBN_PATTERN.test(scanned)) {
          setScannerError("That barcode isn't an ISBN. Try the barcode on the back cover.");
          return;
        }

        hasScannedRef.current = true;
        teardownCamera();
        setScanning(false);
        setIsbn(scanned);
        await searchBookByISBN(scanned);
      });

      scannerControlsRef.current = controls;

      if (videoRef.current?.srcObject instanceof MediaStream) {
        streamRef.current = videoRef.current.srcObject;
      }
    } catch (error) {
      console.error("Barcode scanner error:", error);
      stopBarcodeScanner();
      setScannerError("Camera access was blocked. Allow camera access or type the ISBN instead.");
    }
  }

  // --------------------------------------------------
  // Custom cover selection
  // --------------------------------------------------

  async function handleCoverFile(file: File | null | undefined) {
    setCoverError("");
    if (!file) return;

    if (file.size > MAX_COVER_BYTES) {
      setCoverError("That image is over 5 MB. Choose a smaller file.");
      return;
    }

    const realType = await sniffImageType(file);

    if (!realType || !ALLOWED_COVER_TYPES[realType]) {
      setCoverError("Use a JPG, PNG or WebP image.");
      return;
    }

    setCustomCoverFile(file);
    setCustomCoverType(realType);
    setCustomCoverPreview(URL.createObjectURL(file));
  }

  function clearCustomCover() {
    setCustomCoverFile(null);
    setCustomCoverType(null);
    setCustomCoverPreview(null);
    setCoverError("");
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  async function uploadCustomCover(currentUserId: string): Promise<string | null> {
    if (!customCoverFile || !customCoverType) return null;

    const extension = ALLOWED_COVER_TYPES[customCoverType];
    const path = `${currentUserId}/${crypto.randomUUID()}.${extension}`;

    const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, customCoverFile, {
      contentType: customCoverType,
      cacheControl: "31536000", // file names are unique, so browsers can cache them for a year
      upsert: false,
    });

    if (error) {
      const message = error.message.toLowerCase();

      if (message.includes("bucket not found")) {
        console.error(`Storage bucket "${COVER_BUCKET}" does not exist in this Supabase project.`);
      } else if (message.includes("row-level security")) {
        console.error("Storage RLS blocked the upload. Check the storage.objects policies.");
      } else {
        console.error("Cover upload failed:", error.message);
      }

      throw new Error("COVER_UPLOAD_FAILED");
    }

    return path;
  }

  // --------------------------------------------------
  // Add book
  // --------------------------------------------------

  async function addBookToLibrary() {
    if (!bookResult?.title) {
      setBookError("Find a book with a title before adding it.");
      return;
    }

    if (!userId) {
      setBookError("Sign in to add books to your library.");
      return;
    }

    setAddingBook(true);
    setBookError("");

    let uploadedPath: string | null = null;

    try {
      try {
        uploadedPath = await uploadCustomCover(userId);
      } catch (error) {
        console.error("Cover upload error:", error);
        setCoverError("The cover didn't upload. Try again or remove it to continue.");
        return;
      }

      const { data, error } = await supabase
        .from("books")
        .insert([
          {
            user_id: userId,
            title: bookResult.title,
            author: bookResult.author,
            isbn_10: bookResult.isbn10,
            isbn_13: bookResult.isbn13,
            binding: bookResult.binding,
            published_date: formatPublishedDate(bookResult.publishedDate),
            publisher: bookResult.publisher,
            pages: bookResult.pages,
            cover_url: bookResult.coverUrl,
            custom_cover_path: uploadedPath,
            open_library_id: bookResult.openLibraryId,
            status,
            bought_from: boughtFrom.trim() || null,
            added_at: new Date().toISOString(),
          },
        ])
        .select(BOOK_COLUMNS)
        .single();

      if (error) {
        console.error("Error adding book:", error.message);
        if (uploadedPath) await supabase.storage.from(COVER_BUCKET).remove([uploadedPath]);
        setBookError("The book couldn't be saved. Try again.");
        return;
      }

      if (data) {
        const newBook = data as unknown as Book;

        // Show it straight away if it fits the current view
        const matchesFilter = filter === "all" || newBook.status === filter;
        const term = debouncedSearch.toLowerCase();
        const matchesSearch =
          !term ||
          newBook.title.toLowerCase().includes(term) ||
          (newBook.author || "").toLowerCase().includes(term);

        if (matchesFilter && matchesSearch) {
          setBooks((current) => [newBook, ...current]);
          setTotalMatching((n) => n + 1);
        }

        setCounts((current) =>
          current
            ? {
                total: current.total + 1,
                reading: current.reading + (newBook.status === "reading" ? 1 : 0),
                finished: current.finished + (newBook.status === "finished" ? 1 : 0),
              }
            : current
        );

        if (newBook.custom_cover_path) signCovers([newBook]);
      }

      closeAddBookModal(true);
    } catch (error) {
      console.error("Unexpected error adding book:", error);
      if (uploadedPath) await supabase.storage.from(COVER_BUCKET).remove([uploadedPath]);
      setBookError("The book couldn't be saved. Try again.");
    } finally {
      setAddingBook(false);
    }
  }

  // --------------------------------------------------
  // Modal controls
  // --------------------------------------------------

  function openAddBookModal() {
    setShowAddBook(true);
    setEntryMode("type");
  }

  function closeAddBookModal(force = false) {
    if (addingBook && !force) return;

    stopBarcodeScanner();
    clearCustomCover();

    setShowAddBook(false);
    setEntryMode("type");
    setBookResult(null);
    setBookError("");
    setScannerError("");
    setIsbn("");
    setStatus("want_to_read");
    setBoughtFrom("");
  }

  function searchAgain() {
    clearCustomCover();
    setBookResult(null);
    setBookError("");
    setIsbn("");
  }

  function switchMode(mode: EntryMode) {
    if (mode === entryMode) return;
    setEntryMode(mode);
    setScannerError("");
    setBookError("");
    if (mode === "type") stopBarcodeScanner();
  }

  // --------------------------------------------------
  // Derived data
  // --------------------------------------------------

  const detailRows: [string, string | number | null][] = bookResult
    ? [
        ["ISBN-13", bookResult.isbn13],
        ["ISBN-10", bookResult.isbn10],
        ["Publisher", bookResult.publisher],
        ["Published", bookResult.publishedDate],
        ["Binding", bookResult.binding],
        ["Pages", bookResult.pages],
      ]
    : [];

  const previewCover = customCoverPreview || bookResult?.coverUrl || null;
  const isFiltered = filter !== "all" || !!debouncedSearch;

  const focusRing =
    "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#Fdfaf3]";

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-slate-800 font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] relative overflow-x-clip">
      {/* Open the connection to the cover servers early */}
      <link rel="preconnect" href="https://covers.openlibrary.org" />
      <link rel="dns-prefetch" href="https://archive.org" />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', serif; }
            @keyframes sheet-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes scan-line { 0%, 100% { transform: translateY(-40px); } 50% { transform: translateY(40px); } }
            @keyframes return-glow {
              0% { box-shadow: 0 0 0 0 rgba(122,148,124,0.55); }
              100% { box-shadow: 0 0 0 14px rgba(122,148,124,0); }
            }
            .animate-sheet-in { animation: sheet-in 320ms cubic-bezier(.2,.8,.2,1) both; }
            .animate-fade-in { animation: fade-in 200ms ease-out both; }
            .animate-scan-line { animation: scan-line 2.2s ease-in-out infinite; }
            .animate-return-glow { animation: return-glow 1.2s ease-out 2; }
            @media (prefers-reduced-motion: reduce) {
              .animate-sheet-in, .animate-fade-in, .animate-scan-line, .animate-return-glow { animation: none; }
            }
          `,
        }}
      />

      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />
      <div className="absolute top-[500px] -right-40 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <Navbar isLoggedIn={!!userId || undefined} />

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 pb-24 relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
          <div>
            <p className="tracking-[0.25em] text-sm text-[#7a947c] font-medium mb-3">Your collection</p>
            <h1 className="text-5xl md:text-6xl font-classical font-semibold text-[#0f172a]">My Library</h1>
            <p className="mt-4 text-slate-600 font-light max-w-xl text-lg">
              A home for the books you&apos;ve read, are reading, and hope to read.
            </p>
          </div>

          <button
            type="button"
            onClick={openAddBookModal}
            disabled={!userId}
            className={`w-fit bg-[#0f172a] text-[#Fdfaf3] px-7 py-3.5 rounded-full flex items-center gap-3 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`}
          >
            <span aria-hidden="true" className="text-xl leading-none">+</span>
            <span>Add book</span>
          </button>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {(
            [
              ["Total books", counts?.total],
              ["Reading", counts?.reading],
              ["Finished", counts?.finished],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-white border border-[#0f172a]/5 rounded-xl p-6 shadow-sm">
              <p className="text-sm text-slate-400 mb-2">{label}</p>
              {value === undefined ? (
                <div className="h-9 w-12 rounded-lg bg-[#0f172a]/[0.06] animate-pulse" aria-label="Loading" />
              ) : (
                <p className="text-3xl font-classical text-[#0f172a]">{value}</p>
              )}
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col md:flex-row gap-4 justify-between mb-10">
          <div className="relative w-full md:max-w-md">
            <label htmlFor="library-search" className="sr-only">Search your library</label>
            <input
              id="library-search"
              type="search"
              placeholder="Search by title or author"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-12 px-5 bg-white border border-slate-200 rounded-full text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7a947c]/30 focus:border-[#7a947c] transition-all"
            />
          </div>

          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by status">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className={`px-5 py-2.5 rounded-full text-sm transition-all ${focusRing} ${
                  filter === item.value
                    ? "bg-[#0f172a] text-[#Fdfaf3]"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-[#7a947c] hover:text-[#7a947c]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {loadError && (
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <Alert>{loadError}</Alert>
            </div>
            <button
              type="button"
              onClick={() => userIdRef.current && loadFirstPage(userIdRef.current, filter, debouncedSearch)}
              className={`shrink-0 h-10 px-5 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-sm hover:bg-[#7a947c] transition-colors ${focusRing}`}
            >
              Try again
            </button>
          </div>
        )}

        {/* Grid / empty state */}
        {loading ? (
          <div aria-busy="true" aria-label="Loading your library">
            <GridSkeleton />
          </div>
        ) : books.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#0f172a]/5 shadow-sm py-24 px-8 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-[#d8d0e3]/30 flex items-center justify-center mb-6">
              <span className="font-classical text-3xl text-[#0f172a]">A</span>
            </div>
            <h2 className="text-3xl font-classical text-[#0f172a]">
              {isFiltered ? "No books match." : "Your shelves are waiting."}
            </h2>
            <p className="text-slate-500 font-light mt-3 max-w-md mx-auto">
              {isFiltered ? "Change the search or pick another filter." : "Add your first book to start your archive."}
            </p>
            {!isFiltered && (
              <button
                type="button"
                onClick={openAddBookModal}
                disabled={!userId}
                className={`mt-7 bg-[#7a947c] text-[#Fdfaf3] px-7 py-3 rounded-full hover:bg-[#6b826c] disabled:opacity-50 disabled:cursor-not-allowed transition-all ${focusRing}`}
              >
                Add your first book
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-7">
              {books.map((book, index) => {
                const highlighted = highlightId === book.id;

                return (
                  <Link
                    key={book.id}
                    href={`/library/${book.id}`}
                    prefetch={false}
                    data-book-id={book.id}
                    onClick={() => rememberPosition(book.id)}
                    className={`group block rounded-lg scroll-mt-28 ${focusRing}`}
                    style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}
                  >
                    <div
                      className={`aspect-[2/3] bg-[#e9e4d9] rounded-lg overflow-hidden shadow-md group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-300 ${
                        highlighted ? "ring-2 ring-[#7a947c] ring-offset-4 ring-offset-[#Fdfaf3] animate-return-glow" : ""
                      }`}
                    >
                      <BookCover src={coverFor(book)} title={book.title} author={book.author} eager={index < EAGER_COVERS} />
                    </div>
                    <div className="mt-4">
                      <h3 className="font-classical font-semibold text-lg text-[#0f172a] leading-tight line-clamp-2">
                        {book.title}
                      </h3>
                      {book.author && <p className="text-sm text-slate-500 mt-1 line-clamp-1">{book.author}</p>}
                      <span className="inline-block mt-3 text-xs px-3 py-1 rounded-full bg-[#d8d0e3]/50 text-[#0f172a]">
                        {statusLabel(book.status)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Pagination: auto-loads near the bottom; the button is a fallback */}
            <div ref={sentinelRef} className="mt-12 flex flex-col items-center gap-3" aria-live="polite">
              <p className="text-xs text-slate-400">
                Showing {books.length} of {totalMatching} {totalMatching === 1 ? "book" : "books"}
              </p>

              {hasMore && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className={`h-11 px-6 rounded-full border border-[#0f172a]/12 bg-white text-sm font-medium text-[#0f172a] hover:border-[#7a947c] transition-colors disabled:opacity-60 inline-flex items-center gap-2 ${focusRing}`}
                >
                  {loadingMore && (
                    <span className="w-4 h-4 border-2 border-[#0f172a]/20 border-t-[#0f172a] rounded-full animate-spin" aria-hidden="true" />
                  )}
                  {loadingMore ? "Loading…" : "Load more books"}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* ==================================================
          ADD BOOK MODAL
          ================================================== */}

      {showAddBook && (
        <div
          className="fixed inset-0 z-50 bg-[#0f172a]/45 backdrop-blur-sm flex items-end sm:items-center justify-center sm:px-5 sm:py-8 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddBookModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-book-title"
            className="w-full sm:max-w-2xl max-h-[94vh] sm:max-h-[90vh] flex flex-col bg-[#Fdfaf3] rounded-t-3xl sm:rounded-3xl shadow-2xl ring-1 ring-[#0f172a]/5 animate-sheet-in"
          >
            {/* Header */}
            <div className="px-6 sm:px-9 pt-6 sm:pt-8 pb-5 border-b border-[#0f172a]/5">
              <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="add-book-title" className="text-3xl font-classical font-semibold text-[#0f172a]">
                    {bookResult ? "Shelve this book" : "Add a book"}
                  </h2>
                  <p className="text-slate-500 font-light mt-1.5">
                    {bookResult ? "Add your own cover photo and a few details." : "Find it by ISBN, typed or scanned from the barcode."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => closeAddBookModal()}
                  disabled={addingBook}
                  aria-label="Close"
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">×</span>
                </button>
              </div>

              <div className="mt-5 flex items-center gap-2" aria-hidden="true">
                <span className="h-1 flex-1 rounded-full bg-[#7a947c]" />
                <span className={`h-1 flex-1 rounded-full transition-colors duration-500 ${bookResult ? "bg-[#7a947c]" : "bg-[#0f172a]/10"}`} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-400">
                <span className={!bookResult ? "text-[#0f172a] font-medium" : ""}>Find</span>
                <span className={bookResult ? "text-[#0f172a] font-medium" : ""}>Details</span>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 sm:px-9 py-7">
              {!bookResult ? (
                <div className="space-y-5">
                  <div role="tablist" aria-label="How to find the book" className="grid grid-cols-2 p-1 rounded-full bg-[#0f172a]/5">
                    {(["type", "scan"] as EntryMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="tab"
                        aria-selected={entryMode === mode}
                        onClick={() => switchMode(mode)}
                        className={`h-10 rounded-full text-sm font-medium transition-all ${focusRing} ${
                          entryMode === mode ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
                        }`}
                      >
                        {mode === "type" ? "Type ISBN" : "Scan barcode"}
                      </button>
                    ))}
                  </div>

                  {entryMode === "type" ? (
                    <div className="space-y-2">
                      <label htmlFor="isbn" className="block text-sm font-medium text-slate-700">ISBN</label>
                      <div className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded-2xl focus-within:border-[#7a947c] focus-within:ring-2 focus-within:ring-[#7a947c]/20 transition-all">
                        <input
                          id="isbn"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          autoFocus
                          value={isbn}
                          onChange={(e) => {
                            setIsbn(e.target.value);
                            setBookError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              searchBookByISBN(isbn);
                            }
                          }}
                          placeholder="9781399713795"
                          className="flex-1 min-w-0 h-11 px-3 bg-transparent text-lg tracking-wider text-[#0f172a] placeholder:text-slate-300 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => searchBookByISBN(isbn)}
                          disabled={searchingBook}
                          className={`h-11 px-5 bg-[#0f172a] text-[#Fdfaf3] rounded-xl text-sm font-medium hover:bg-[#1b2940] disabled:opacity-50 transition-all flex items-center gap-2 ${focusRing}`}
                        >
                          {searchingBook && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                          {searchingBook ? "Searching" : "Find book"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">It&apos;s printed above the barcode or on the copyright page. Dashes are fine.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative overflow-hidden rounded-2xl bg-[#0f172a] aspect-[4/3] sm:aspect-video">
                        <video ref={videoRef} className={`w-full h-full object-cover ${scanning ? "" : "opacity-0"}`} muted playsInline />

                        {scanning ? (
                          <>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="relative w-[78%] h-28 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] overflow-hidden">
                                <span className="absolute left-3 right-3 top-1/2 h-0.5 bg-[#7a947c] shadow-[0_0_12px_#7a947c] animate-scan-line" />
                              </div>
                            </div>
                            <div className="absolute bottom-3 inset-x-0 text-center">
                              <span className="inline-block bg-[#0f172a]/80 text-white text-xs px-4 py-2 rounded-full">Hold the barcode inside the frame</span>
                            </div>
                          </>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[#Fdfaf3] px-6 text-center">
                            <div className="flex gap-[3px] h-10 opacity-70" aria-hidden="true">
                              {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 2].map((w, i) => (
                                <span key={i} className="bg-[#Fdfaf3] h-full" style={{ width: w * 2 }} />
                              ))}
                            </div>
                            <p className="text-sm opacity-80 max-w-xs">Your browser will ask for camera access. Nothing is recorded.</p>
                            <button
                              type="button"
                              onClick={startBarcodeScanner}
                              disabled={searchingBook}
                              className={`h-11 px-6 rounded-full bg-[#7a947c] text-[#Fdfaf3] text-sm font-medium hover:bg-[#6b826c] disabled:opacity-50 transition-all ${focusRing}`}
                            >
                              {searchingBook ? "Looking up book…" : "Start camera"}
                            </button>
                          </div>
                        )}
                      </div>

                      {scanning && (
                        <button
                          type="button"
                          onClick={stopBarcodeScanner}
                          className={`w-full h-11 border border-slate-200 text-slate-600 rounded-xl hover:border-[#0f172a] hover:text-[#0f172a] transition-all ${focusRing}`}
                        >
                          Stop camera
                        </button>
                      )}
                    </div>
                  )}

                  {scannerError && <Alert>{scannerError}</Alert>}
                  {bookError && <Alert>{bookError}</Alert>}
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="flex flex-col sm:flex-row gap-6 sm:gap-7">
                    <div className="w-40 shrink-0 mx-auto sm:mx-0">
                      <div className="relative aspect-[2/3] rounded-lg overflow-hidden shadow-lg bg-[#e9e4d9] ring-1 ring-[#0f172a]/5">
                        <BookCover src={previewCover} title={bookResult.title || "Untitled"} author={bookResult.author} size="lg" eager sizes="160px" />
                        {customCoverPreview && (
                          <span className="absolute top-2 left-2 text-[11px] px-2 py-1 rounded-full bg-[#7a947c] text-[#Fdfaf3] shadow">Your photo</span>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-2xl sm:text-3xl font-classical font-semibold text-[#0f172a] leading-tight">{bookResult.title}</h3>
                      {bookResult.author && <p className="text-lg text-slate-600 mt-1.5">{bookResult.author}</p>}

                      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        {detailRows
                          .filter(([, value]) => value !== null && value !== "")
                          .map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="text-slate-400 text-xs">{label}</dt>
                              <dd className="text-slate-700 truncate">{value}</dd>
                            </div>
                          ))}
                      </dl>

                      <button
                        type="button"
                        onClick={searchAgain}
                        disabled={addingBook}
                        className={`mt-5 text-sm text-[#7a947c] hover:text-[#0f172a] underline underline-offset-4 decoration-[#7a947c]/40 transition-colors disabled:opacity-50 rounded ${focusRing}`}
                      >
                        Not this book? Search again
                      </button>
                    </div>
                  </div>

                  {/* Custom cover upload */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="block text-sm font-medium text-slate-700">Cover photo</span>
                      <span className="text-xs text-slate-400">Optional</span>
                    </div>

                    <input
                      ref={coverInputRef}
                      id="custom-cover"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => handleCoverFile(e.target.files?.[0])}
                    />

                    {customCoverFile ? (
                      <div className="flex items-center gap-4 p-3 pr-4 bg-white border border-[#7a947c]/40 rounded-2xl">
                        <div className="w-12 h-16 rounded-md overflow-hidden bg-[#e9e4d9] shrink-0">
                          {customCoverPreview && <img src={customCoverPreview} alt="" className="w-full h-full object-cover" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#0f172a] truncate">{customCoverFile.name}</p>
                          <p className="text-xs text-slate-400">{(customCoverFile.size / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                        <label htmlFor="custom-cover" className="text-sm text-[#0f172a] hover:text-[#7a947c] cursor-pointer transition-colors">
                          Replace
                        </label>
                        <button
                          type="button"
                          onClick={clearCustomCover}
                          disabled={addingBook}
                          className={`text-sm text-slate-400 hover:text-red-600 transition-colors rounded ${focusRing}`}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label
                        htmlFor="custom-cover"
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOver(false);
                          handleCoverFile(e.dataTransfer.files?.[0]);
                        }}
                        className={`flex items-center gap-4 p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                          dragOver ? "border-[#7a947c] bg-[#7a947c]/10" : "border-[#0f172a]/15 bg-white hover:border-[#7a947c] hover:bg-[#7a947c]/5"
                        }`}
                      >
                        <span className="w-11 h-11 rounded-full bg-[#7a947c]/15 text-[#7a947c] flex items-center justify-center shrink-0" aria-hidden="true">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                            <circle cx="12" cy="13" r="3.5" />
                          </svg>
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[#0f172a]">Upload a photo of your copy</span>
                          <span className="block text-xs text-slate-400 mt-0.5">JPG, PNG or WebP, up to 5 MB. Replaces the catalogue cover on your shelf.</span>
                        </span>
                      </label>
                    )}

                    {coverError && <div className="mt-3"><Alert>{coverError}</Alert></div>}
                  </div>

                  {/* Reading status */}
                  <fieldset>
                    <legend className="block text-sm font-medium text-slate-700 mb-2">Reading status</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {STATUS_OPTIONS.map((option) => {
                        const checked = status === option.value;
                        return (
                          <label
                            key={option.value}
                            className={`relative cursor-pointer rounded-2xl border px-3 py-3 text-center transition-all focus-within:ring-2 focus-within:ring-[#7a947c] ${
                              checked ? "border-[#0f172a] bg-[#0f172a] text-[#Fdfaf3]" : "border-slate-200 bg-white text-slate-600 hover:border-[#7a947c]"
                            }`}
                          >
                            <input
                              type="radio"
                              name="status"
                              value={option.value}
                              checked={checked}
                              onChange={() => setStatus(option.value)}
                              className="sr-only"
                            />
                            <span className="block text-sm font-medium">{option.label}</span>
                            <span className={`hidden sm:block text-xs mt-0.5 ${checked ? "text-[#Fdfaf3]/60" : "text-slate-400"}`}>{option.hint}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  {/* Where bought */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <label htmlFor="boughtFrom" className="block text-sm font-medium text-slate-700">Where did you buy it?</label>
                      <span className="text-xs text-slate-400">Optional</span>
                    </div>
                    <input
                      id="boughtFrom"
                      type="text"
                      maxLength={120}
                      value={boughtFrom}
                      onChange={(e) => setBoughtFrom(e.target.value)}
                      placeholder="Text Book Centre, Amazon, a friend…"
                      className="w-full h-12 px-4 bg-white border border-slate-200 rounded-xl text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-2 focus:ring-[#7a947c]/20 transition-all"
                    />
                  </div>

                  {bookError && <Alert>{bookError}</Alert>}
                </div>
              )}
            </div>

            {/* Footer */}
            {bookResult && (
              <div className="px-6 sm:px-9 py-5 border-t border-[#0f172a]/5 bg-[#Fdfaf3] rounded-b-none sm:rounded-b-3xl flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
                <button
                  type="button"
                  onClick={() => closeAddBookModal()}
                  disabled={addingBook}
                  className={`h-12 px-6 rounded-full text-slate-600 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-all disabled:opacity-50 ${focusRing}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addBookToLibrary}
                  disabled={addingBook || !userId}
                  className={`h-12 px-8 rounded-full bg-[#7a947c] text-[#Fdfaf3] font-medium shadow-sm hover:bg-[#6b826c] hover:shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2 ${focusRing}`}
                >
                  {addingBook && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {addingBook ? (customCoverFile ? "Uploading cover…" : "Adding…") : "Add to my library"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}