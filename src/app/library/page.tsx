"use client";

// src/app/library/page.tsx
// Your whole collection: memorable stats, search, status tabs, sort and
// filters, in a grid or list. Data, caching and scroll restoration live in
// _lib/library.ts; the UI is split into _components.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import Navbar from "../components/Navbar";
import Button, { focusRing } from "../components/ui/Button";
import { supabase } from "../../lib/supabase";
import type { ShelfView } from "../reading/_components/ViewToggle";

import {
  bookMatches,
  clearReturnState,
  computeLibraryStats,
  DEFAULT_FILTERS,
  ensureSignOutCleanup,
  fetchBooksPage,
  fetchFacets,
  filtersKey,
  getLibraryCache,
  PAGE_SIZE,
  readReturnState,
  saveReturnState,
  setLibraryCache,
  signCovers,
  validSignedUrls,
  VIEW_KEY,
  type Book,
  type BookStatus,
  type Facet,
  type LibraryFilters,
  type ReturnState,
} from "./_lib/library";

import LibraryStats from "./_components/LibraryStats";
import LibraryToolbar from "./_components/LibraryToolbar";
import LibraryBookItem from "./_components/LibraryBookItem";
import LibrarySkeleton from "./_components/LibrarySkeleton";
import EmptyLibrary from "./_components/EmptyLibrary";
import AddBookModal from "./_components/AddBookModal";
import Alert from "./_components/Alert";
import { LIBRARY_GRID, LIBRARY_LIST } from "./_components/layout";

const REFRESH_AFTER = 60 * 1000; // quietly refresh cached data older than a minute
const MAX_SILENT_REFRESH = 150; // cap on rows re-fetched in a background refresh
const EAGER_COVERS = 12;
const HIGHLIGHT_MS = 1800;

export default function LibraryPage() {
  // Start from the in-memory cache so returning to the page is instant
  const cached = getLibraryCache();

  // ---------- Data ----------
  const [books, setBooks] = useState<Book[]>(() => cached?.books ?? []);
  const [totalMatching, setTotalMatching] = useState(() => cached?.totalMatching ?? 0);
  const [facets, setFacets] = useState<Facet[] | null>(() => cached?.facets ?? null);
  const [signedCovers, setSignedCovers] = useState<Record<string, string>>(() => (cached ? validSignedUrls() : {}));
  const [loading, setLoading] = useState(() => !cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  // ---------- Auth ----------
  const [userId, setUserId] = useState<string | null>(() => cached?.userId ?? null);
  const userIdRef = useRef<string | null>(cached?.userId ?? null);

  // ---------- Filters (search is debounced before it hits the database) ----------
  const [filters, setFilters] = useState<LibraryFilters>(() => cached?.filters ?? DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState(() => cached?.filters.search ?? "");
  const queryFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [filters, debouncedSearch]);

  // ---------- UI ----------
  const [view, setView] = useState<ShelfView>("grid");
  const [showAddBook, setShowAddBook] = useState(false);
  const [pendingReturn, setPendingReturn] = useState<ReturnState | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // ---------- Request bookkeeping ----------
  const requestIdRef = useRef(0);
  const lastQueryKeyRef = useRef<string | null>(cached ? filtersKey(cached.filters) : null);
  const fetchedAtRef = useRef(cached?.fetchedAt ?? 0);
  const booksRef = useRef<Book[]>(books);
  booksRef.current = books;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const stats = useMemo(() => (facets ? computeLibraryStats(facets) : null), [facets]);

  // ============================================================
  // Layout preference
  // ============================================================

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      // storage unavailable
    }
  }, []);

  function changeView(next: ShelfView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // storage unavailable
    }
  }

  // ============================================================
  // Loading
  // ============================================================

  const refreshCovers = useCallback(async (rows: Book[]) => {
    setSignedCovers(await signCovers(rows));
  }, []);

  // First page for the given filters. `silent` refreshes in the background
  // without a skeleton and without moving the scroll position.
  const loadFirstPage = useCallback(
    async (uid: string, f: LibraryFilters, silent = false) => {
      const requestId = ++requestIdRef.current;
      lastQueryKeyRef.current = filtersKey(f);

      if (!silent) {
        setLoading(true);
        setLoadError("");
      }

      const limit = silent ? Math.min(Math.max(PAGE_SIZE, booksRef.current.length), MAX_SILENT_REFRESH) : PAGE_SIZE;
      const { data, count, error } = await fetchBooksPage({ userId: uid, filters: f, from: 0, to: limit - 1, withCount: true });

      if (requestId !== requestIdRef.current) return; // a newer request started

      if (error) {
        console.error("Error fetching books:", error.message);
        if (!silent) {
          setLoadError("Your books couldn't be loaded. Check your connection and try again.");
          setLoading(false);
        }
        return;
      }

      const rows = (data || []) as unknown as Book[];
      setBooks(rows);
      setTotalMatching(count ?? rows.length);
      fetchedAtRef.current = Date.now();
      setLoading(false);
      refreshCovers(rows); // covers appear as they're signed
    },
    [refreshCovers]
  );

  const loadFacets = useCallback(async (uid: string) => {
    const next = await fetchFacets(uid);
    if (next && userIdRef.current === uid) setFacets(next);
  }, []);

  const hasMore = books.length < totalMatching;

  const loadMore = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid || loadingMore || loading || !hasMore) return;

    setLoadingMore(true);
    const requestId = requestIdRef.current;
    const from = booksRef.current.length;

    const { data, error } = await fetchBooksPage({ userId: uid, filters: queryFilters, from, to: from + PAGE_SIZE - 1, withCount: false });
    setLoadingMore(false);

    if (requestId !== requestIdRef.current) return; // filters changed meanwhile

    if (error) {
      console.error("Error loading more books:", error.message);
      setLoadError("More books couldn't be loaded. Try again.");
      return;
    }

    const rows = (data || []) as unknown as Book[];
    setBooks((current) => {
      const seen = new Set(current.map((b) => b.id));
      return [...current, ...rows.filter((b) => !seen.has(b.id))];
    });
    refreshCovers(rows);
  }, [loadingMore, loading, hasMore, queryFilters, refreshCovers]);

  // ============================================================
  // Auth: load once; only reload when the user actually changes
  // ============================================================

  useEffect(() => {
    ensureSignOutCleanup();
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

      // Back on the page with cached data: show it, refresh quietly if old
      const cache = getLibraryCache();
      if (cache && cache.userId === uid) {
        setSignedCovers(validSignedUrls());
        if (Date.now() - cache.fetchedAt > REFRESH_AFTER) {
          loadFirstPage(uid, cache.filters, true);
          loadFacets(uid);
        }
        setPendingReturn(readReturnState());
        return;
      }

      // First visit this session (or after a full reload)
      const saved = readReturnState();
      const start = saved?.filters ?? DEFAULT_FILTERS;
      if (saved) {
        setPendingReturn(saved);
        setFilters(start);
        setDebouncedSearch(start.search);
      }
      loadFirstPage(uid, start);
      loadFacets(uid);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null;
      if (next === userIdRef.current) return; // same user: nothing to reload

      userIdRef.current = next;
      setUserId(next);
      setLibraryCache(null);

      if (!next) {
        setBooks([]);
        setFacets(null);
        setTotalMatching(0);
        setLoading(false);
        return;
      }

      setFilters(DEFAULT_FILTERS);
      setDebouncedSearch("");
      loadFirstPage(next, DEFAULT_FILTERS);
      loadFacets(next);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce typing before querying
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  // Re-query when any filter (or the debounced search) changes
  useEffect(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    if (filtersKey(queryFilters) === lastQueryKeyRef.current) return;
    loadFirstPage(uid, queryFilters);
  }, [queryFilters, loadFirstPage]);

  // Keep the in-memory cache current
  useEffect(() => {
    if (!userId || loading) return;
    setLibraryCache({
      userId,
      filters: queryFilters,
      books,
      totalMatching,
      facets,
      fetchedAt: fetchedAtRef.current || Date.now(),
    });
  }, [userId, loading, queryFilters, books, totalMatching, facets]);

  // Infinite scroll: load the next page as the end of the list nears
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  // ============================================================
  // Scroll restoration: back to the book you opened
  // ============================================================

  function rememberPosition(bookId: string) {
    saveReturnState({ bookId, scrollY: window.scrollY, filters: queryFilters, savedAt: Date.now() });
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

  // ============================================================
  // Actions
  // ============================================================

  function updateFilters(patch: Partial<LibraryFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function resetFilters() {
    setFilters((current) => ({ ...DEFAULT_FILTERS, sort: current.sort, search: current.search }));
  }

  // Tapping a status in the stats card filters the list (tap again to undo)
  function pickStatus(status: BookStatus) {
    updateFilters({ status: filters.status === status ? "all" : status });
    requestAnimationFrame(() => document.getElementById("books")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function handleAdded(book: Book) {
    if (bookMatches(book, queryFilters)) {
      setBooks((current) => [book, ...current]);
      setTotalMatching((n) => n + 1);
    }
    setFacets((current) =>
      current
        ? [
            ...current,
            { status: book.status, author: book.author, bought_from: book.bought_from, binding: book.binding, pages: book.pages, created_at: book.created_at },
          ]
        : current
    );
    if (book.custom_cover_path) refreshCovers([book]);
  }

  function coverFor(book: Book) {
    return (book.custom_cover_path && signedCovers[book.custom_cover_path]) || book.cover_url;
  }

  const isFiltered = !!debouncedSearch || filters.status !== "all" || !!filters.format || !!filters.source || !!filters.year || filters.ownCover;

  // ============================================================
  // Render
  // ============================================================

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] overflow-x-clip">
      {/* Open the connection to the cover servers early */}
      <link rel="preconnect" href="https://covers.openlibrary.org" />
      <link rel="dns-prefetch" href="https://archive.org" />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
            @keyframes scan-line { 0%, 100% { transform: translateY(-40px); } 50% { transform: translateY(40px); } }
            @keyframes return-glow { 0% { box-shadow: 0 0 0 0 rgba(122,148,124,0.55); } 100% { box-shadow: 0 0 0 14px rgba(122,148,124,0); } }
            .animate-scan-line { animation: scan-line 2.2s ease-in-out infinite; }
            .animate-return-glow { animation: return-glow 1.2s ease-out 2; }
            @media (prefers-reduced-motion: reduce) { .animate-scan-line, .animate-return-glow { animation: none; } }
          `,
        }}
      />

      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[520px] bg-[#d8d0e3]/25 rounded-full blur-[130px]" />
        <div className="absolute top-[45%] -right-40 w-[600px] h-[600px] bg-[#89a08a]/12 rounded-full blur-[130px]" />
      </div>

      <Navbar isLoggedIn={!!userId || undefined} />

      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-24">
        {/* ================= Header ================= */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 md:gap-10">
          <div className="min-w-0">
            <p className="tracking-[0.25em] uppercase text-xs sm:text-sm text-[#7a947c] font-medium mb-3">Your collection</p>
            <h1 className="font-classical text-[2.6rem] leading-[1.05] sm:text-6xl font-semibold">My Library</h1>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-600 font-light max-w-xl">
              A home for the books you&apos;ve read, are reading, and hope to read.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex gap-2.5 sm:gap-3 shrink-0">
            <Link
              href="/reading"
              className={`inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full bg-white/70 text-slate-700 border border-[#0f172a]/10 text-sm font-medium hover:bg-white hover:text-[#0f172a] hover:border-[#0f172a]/25 transition-all ${focusRing}`}
            >
              Reading stats
            </Link>
            <Button variant="dark" size="lg" onClick={() => setShowAddBook(true)} disabled={!userId}>
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Add book
            </Button>
          </div>
        </header>

        {/* ================= Stats ================= */}
        <div className="mt-8 sm:mt-10">
          <LibraryStats stats={stats} activeStatus={filters.status} onPickStatus={pickStatus} />
        </div>

        {/* ================= Toolbar ================= */}
        <div id="books" className="mt-8 sm:mt-10 scroll-mt-20">
          <LibraryToolbar
            filters={filters}
            onChange={updateFilters}
            onReset={resetFilters}
            view={view}
            onViewChange={changeView}
            stats={stats}
            shown={books.length}
            total={totalMatching}
            loading={loading}
          />
        </div>

        {loadError && (
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <Alert>{loadError}</Alert>
            </div>
            <Button variant="dark" onClick={() => userIdRef.current && loadFirstPage(userIdRef.current, queryFilters)}>
              Try again
            </Button>
          </div>
        )}

        {/* ================= Books ================= */}
        <div className="mt-6 sm:mt-8">
          {loading ? (
            <div aria-busy="true" aria-label="Loading your library">
              <LibrarySkeleton view={view} />
            </div>
          ) : books.length === 0 ? (
            <EmptyLibrary filtered={isFiltered} canAdd={!!userId} onAdd={() => setShowAddBook(true)} onClear={() => setFilters(DEFAULT_FILTERS)} />
          ) : (
            <>
              <ul className={view === "list" ? LIBRARY_LIST : LIBRARY_GRID}>
                {books.map((book, index) => (
                  <li key={book.id} className="min-w-0">
                    <LibraryBookItem
                      book={book}
                      cover={coverFor(book)}
                      view={view}
                      eager={index < EAGER_COVERS}
                      highlighted={highlightId === book.id}
                      onOpen={rememberPosition}
                    />
                  </li>
                ))}
              </ul>

              {/* Auto-loads near the bottom; the button is a fallback */}
              <div ref={sentinelRef} className="mt-12 flex flex-col items-center gap-3" aria-live="polite">
                <p className="text-xs text-slate-400">
                  Showing {books.length} of {totalMatching} {totalMatching === 1 ? "book" : "books"}
                </p>
                {hasMore && (
                  <Button variant="outline" onClick={loadMore} loading={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more books"}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <AddBookModal open={showAddBook} userId={userId} onClose={() => setShowAddBook(false)} onAdded={handleAdded} />
    </main>
  );
}
