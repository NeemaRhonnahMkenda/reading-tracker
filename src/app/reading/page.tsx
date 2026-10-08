"use client";

// src/app/reading/page.tsx
// Your books by shelf (reading → want to read → finished), in grid or list,
// plus finished-vs-reviewed and reading stats.

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import Button, { focusRing } from "../components/ui/Button";
import { supabase } from "../../lib/supabase";
import { computeStats, loadShelf, type ShelfBook } from "../../lib/shelf";

import ViewToggle, { type ShelfView } from "./_components/ViewToggle";
import ShelfSection from "./_components/ShelfSection";
import ShelfBookItem from "./_components/ShelfBookItem";
import StatStrip from "./_components/StatStrip";
import ReviewProgress from "./_components/ReviewProgress";
import FinishedByYear, { type YearFilter } from "./_components/FinishedByYear";
import RatingBreakdown from "./_components/RatingBreakdown";
import TopAuthors from "./_components/TopAuthors";
import ProgressBar from "./_components/ProgressBar";
import ReadingSkeleton from "./_components/ReadingSkeleton";

// ============================================================
// Config
// ============================================================

const VIEW_KEY = "archive:reading-view";
const SHELF_LIMIT = { grid: 12, list: 10 } as const;

const GRID = {
  featured: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-7 gap-y-8",
  shelf: "grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 sm:gap-x-6 gap-y-7 sm:gap-y-8",
  list: "grid gap-2.5 lg:grid-cols-2 lg:gap-x-4",
};

type ShelfKey = "reading" | "want_to_read" | "finished" | "did_not_finish";

// ============================================================
// Sorting
// ============================================================

const byTitle = (a: ShelfBook, b: ShelfBook) => a.title.localeCompare(b.title);

function sortShelf(key: ShelfKey, books: ShelfBook[]) {
  const list = [...books];
  switch (key) {
    case "reading":
      // Closest to done first
      return list.sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1) || byTitle(a, b));
    case "finished":
      // Most recently finished first; undated last
      return list.sort((a, b) => {
        const ay = a.review?.finishedYear ?? 0;
        const by = b.review?.finishedYear ?? 0;
        if (ay !== by) return by - ay;
        const am = a.review?.finishedMonth ?? 0;
        const bm = b.review?.finishedMonth ?? 0;
        return bm - am || byTitle(a, b);
      });
    default:
      // Newest added first
      return list.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
  }
}

// ============================================================
// Small pieces
// ============================================================

function EmptyShelf({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[1.4rem] border border-dashed border-[#0f172a]/12 bg-white/50 px-6 py-10 text-center">
      <p className="text-sm text-slate-500 font-light max-w-md mx-auto leading-6">{children}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function ShowMore({ shown, total, onClick }: { shown: number; total: number; onClick: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="mt-8 flex justify-center">
      <Button variant="outline" onClick={onClick}>
        Show all {total}
        <span aria-hidden="true">↓</span>
      </Button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// ============================================================
// Page
// ============================================================

export default function ReadingPage() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const [userId, setUserId] = useState<string | null>(null);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [view, setView] = useState<ShelfView>("grid");
  const [query, setQuery] = useState("");
  const [yearFilter, setYearFilter] = useState<YearFilter>(null);
  const [expanded, setExpanded] = useState<Partial<Record<ShelfKey, boolean>>>({});

  // ---------- Remembered layout ----------
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

  // ---------- Load ----------
  const load = useCallback(
    async (uid: string) => {
      setLoading(true);
      setLoadError("");
      try {
        setBooks(await loadShelf(uid));
      } catch (err) {
        console.error("Reading page load failed:", err);
        setLoadError("Your shelves couldn't be loaded. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      const uid = session?.user?.id ?? null;
      if (!uid) {
        router.replace("/login?next=/reading");
        return;
      }
      setUserId(uid);
      load(uid);
    });
    return () => {
      active = false;
    };
  }, [load, router]);

  // ---------- Derived ----------
  const stats = useMemo(() => computeStats(books, currentYear), [books, currentYear]);

  const term = query.trim().toLowerCase();
  const matches = useCallback(
    (b: ShelfBook) => !term || b.title.toLowerCase().includes(term) || (b.author ?? "").toLowerCase().includes(term),
    [term]
  );

  const shelves = useMemo(() => {
    const pick = (key: ShelfKey) => sortShelf(key, books.filter((b) => b.status === key && matches(b)));
    const finishedAll = pick("finished");
    const finished =
      yearFilter === null
        ? finishedAll
        : finishedAll.filter((b) => (yearFilter === "unknown" ? !b.review?.finishedYear : b.review?.finishedYear === yearFilter));

    return {
      reading: pick("reading"),
      want_to_read: pick("want_to_read"),
      finished,
      finishedAll,
      did_not_finish: pick("did_not_finish"),
    };
  }, [books, matches, yearFilter]);

  const searchHasNoResults =
    !!term &&
    shelves.reading.length + shelves.want_to_read.length + shelves.finishedAll.length + shelves.did_not_finish.length === 0;

  const limit = SHELF_LIMIT[view];
  const visible = (key: ShelfKey, list: ShelfBook[]) => (expanded[key] ? list : list.slice(0, limit));
  const showAll = (key: ShelfKey) => setExpanded((e) => ({ ...e, [key]: true }));

  function pickYear(year: YearFilter) {
    setYearFilter(year);
    if (year !== null) {
      requestAnimationFrame(() => document.getElementById("finished")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  const yearChips = stats.byYear.map((y) => y.year ?? ("unknown" as const));
  const reviewPct = stats.counts.finished ? Math.round((stats.reviewed / stats.counts.finished) * 100) : 0;

  function renderBooks(list: ShelfBook[], featured = false) {
    return (
      <ul className={view === "list" ? GRID.list : featured ? GRID.featured : GRID.shelf}>
        {list.map((book, i) => (
          <li key={book.id} className="min-w-0">
            <ShelfBookItem book={book} view={view} featured={featured} eager={i < 6} />
          </li>
        ))}
      </ul>
    );
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] overflow-x-clip">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
          `,
        }}
      />

      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[520px] bg-[#d8d0e3]/25 rounded-full blur-[130px]" />
        <div className="absolute top-[40%] -right-40 w-[600px] h-[600px] bg-[#89a08a]/12 rounded-full blur-[130px]" />
      </div>

      <Navbar isLoggedIn={!!userId || undefined} />

      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-24">
        {/* ================= Header ================= */}
        <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 lg:gap-10">
          <div>
            <p className="tracking-[0.25em] uppercase text-xs sm:text-sm text-[#7a947c] font-medium mb-3">Your reading life</p>
            <h1 className="font-classical text-[2.6rem] leading-[1.05] sm:text-6xl font-semibold">Reading</h1>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-600 font-light max-w-xl">
              What&apos;s open on the nightstand, what&apos;s waiting its turn, and everything you&apos;ve closed the last page on.
            </p>
          </div>

          {/* Jump links */}
          <nav aria-label="Jump to" className="flex gap-2 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none]">
            {[
              { href: "#reading", label: "Reading", n: stats.counts.reading },
              { href: "#want", label: "Want to read", n: stats.counts.want_to_read },
              { href: "#finished", label: "Finished", n: stats.counts.finished },
              { href: "#stats", label: "Stats", n: null },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className={`shrink-0 h-10 px-4 rounded-full bg-white/80 border border-[#0f172a]/8 text-sm text-slate-600 hover:text-[#0f172a] hover:border-[#7a947c] inline-flex items-center gap-2 transition-colors ${focusRing}`}
              >
                {link.label}
                {link.n !== null && <span className="text-xs text-slate-400">{link.n}</span>}
              </a>
            ))}
          </nav>
        </header>

        <div className="mt-8 sm:mt-10">
          {loading ? (
            <div aria-busy="true" aria-label="Loading your shelves">
              <ReadingSkeleton view={view} />
            </div>
          ) : loadError ? (
            <div className="rounded-[1.6rem] bg-[#fbefed] border border-red-200/70 px-6 py-10 text-center">
              <p className="text-[#a14e43]">{loadError}</p>
              <Button variant="dark" className="mt-5" onClick={() => userId && load(userId)}>
                Try again
              </Button>
            </div>
          ) : books.length === 0 ? (
            <div className="rounded-[1.8rem] bg-white/70 border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] px-6 py-16 sm:py-20 text-center">
              <div className="w-20 h-20 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-6">
                <span className="font-classical text-3xl text-[#9a86b9]">A</span>
              </div>
              <h2 className="font-classical text-3xl font-semibold">Your shelves are empty</h2>
              <p className="mt-3 text-slate-500 font-light max-w-md mx-auto">
                Add books to your library and they&apos;ll be sorted here by what you&apos;re reading, what&apos;s next and what you&apos;ve finished.
              </p>
              <Link
                href="/library"
                className={`mt-7 inline-flex items-center justify-center h-12 px-7 rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors ${focusRing}`}
              >
                Go to My Library
              </Link>
            </div>
          ) : (
            <>
              {/* ================= Headline stats ================= */}
              <StatStrip stats={stats} year={currentYear} />

              {/* ================= Toolbar ================= */}
              <div className="sticky top-16 sm:top-[4.5rem] z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 mt-8 sm:mt-10 bg-[#fdfaf3]/85 backdrop-blur-md border-b border-[#0f172a]/[0.05]">
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-md">
                    <label htmlFor="shelf-search" className="sr-only">Search your shelves</label>
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <SearchIcon />
                    </span>
                    <input
                      id="shelf-search"
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search title or author"
                      className="w-full h-11 pl-11 pr-4 rounded-full bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                    />
                  </div>
                  <div className="ml-auto">
                    <ViewToggle view={view} onChange={changeView} />
                  </div>
                </div>
              </div>

              {searchHasNoResults ? (
                <div className="mt-10">
                  <EmptyShelf action={<Button variant="outline" onClick={() => setQuery("")}>Clear search</Button>}>
                    Nothing on your shelves matches &ldquo;{query.trim()}&rdquo;.
                  </EmptyShelf>
                </div>
              ) : (
                <div className="mt-10 sm:mt-12 space-y-14 sm:space-y-16">
                  {/* ================= 1. Currently reading ================= */}
                  <ShelfSection
                    id="reading"
                    title="Currently reading"
                    subtitle="Closest to the end first"
                    count={shelves.reading.length}
                    dot="bg-[#7a947c]"
                  >
                    {shelves.reading.length === 0 ? (
                      <EmptyShelf
                        action={
                          shelves.want_to_read[0] ? (
                            <Link
                              href={`/library/${shelves.want_to_read[0].id}`}
                              className={`inline-flex items-center gap-2 h-11 px-6 rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors ${focusRing}`}
                            >
                              Start {shelves.want_to_read[0].title.length > 28 ? "your next book" : shelves.want_to_read[0].title}
                            </Link>
                          ) : undefined
                        }
                      >
                        {term ? "No current reads match your search." : "Nothing on the nightstand right now."}
                      </EmptyShelf>
                    ) : (
                      renderBooks(shelves.reading, true)
                    )}
                  </ShelfSection>

                  {/* ================= 2. Want to read ================= */}
                  <ShelfSection
                    id="want"
                    title="Want to read"
                    subtitle="Most recently added first"
                    count={shelves.want_to_read.length}
                    dot="bg-[#9a86b9]"
                  >
                    {shelves.want_to_read.length === 0 ? (
                      <EmptyShelf>{term ? "Nothing on this shelf matches your search." : "Your to-read pile is empty. Lucky you, or time to go shopping."}</EmptyShelf>
                    ) : (
                      <>
                        {renderBooks(visible("want_to_read", shelves.want_to_read))}
                        {!expanded.want_to_read && (
                          <ShowMore shown={limit} total={shelves.want_to_read.length} onClick={() => showAll("want_to_read")} />
                        )}
                      </>
                    )}
                  </ShelfSection>

                  {/* ================= 3. Finished ================= */}
                  <ShelfSection
                    id="finished"
                    title="Finished"
                    count={shelves.finishedAll.length}
                    dot="bg-[#0f172a]"
                    subtitle={
                      stats.counts.finished > 0 ? (
                        <span className="flex items-center gap-3 mt-1">
                          <span className="w-24 sm:w-32">
                            <ProgressBar value={reviewPct} className="h-1.5" label="Finished books reviewed" />
                          </span>
                          <span>
                            {stats.reviewed} of {stats.counts.finished} reviewed
                          </span>
                        </span>
                      ) : undefined
                    }
                    toolbar={
                      yearChips.length > 1 ? (
                        <div
                          role="group"
                          aria-label="Filter finished books by year"
                          className="w-full sm:w-auto flex gap-1.5 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none]"
                        >
                          {[null, ...yearChips].map((year) => {
                            const active = yearFilter === year;
                            return (
                              <button
                                key={String(year)}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setYearFilter(year)}
                                className={`shrink-0 h-9 px-3.5 rounded-full text-xs font-medium border transition-all ${focusRing} ${
                                  active
                                    ? "bg-[#0f172a] border-[#0f172a] text-[#fdfaf3]"
                                    : "bg-white/80 border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c]"
                                }`}
                              >
                                {year === null ? "All years" : year === "unknown" ? "No date" : year}
                              </button>
                            );
                          })}
                        </div>
                      ) : undefined
                    }
                  >
                    {shelves.finished.length === 0 ? (
                      <EmptyShelf
                        action={yearFilter !== null ? <Button variant="outline" onClick={() => setYearFilter(null)}>Show all years</Button> : undefined}
                      >
                        {yearFilter !== null
                          ? `No finished books ${yearFilter === "unknown" ? "without a date" : `in ${yearFilter}`}${term ? " match your search" : ""}.`
                          : term
                            ? "No finished books match your search."
                            : "Books you finish will land here. Mark one as finished from its page."}
                      </EmptyShelf>
                    ) : (
                      <>
                        {renderBooks(visible("finished", shelves.finished))}
                        {!expanded.finished && <ShowMore shown={limit} total={shelves.finished.length} onClick={() => showAll("finished")} />}
                      </>
                    )}
                  </ShelfSection>

                  {/* ================= 4. Did not finish (tucked away) ================= */}
                  {shelves.did_not_finish.length > 0 && (
                    <ShelfSection
                      id="dnf"
                      title="Did not finish"
                      subtitle="Not every book is for everyone"
                      count={shelves.did_not_finish.length}
                      dot="bg-[#b07a6a]"
                      defaultOpen={false}
                    >
                      {renderBooks(visible("did_not_finish", shelves.did_not_finish))}
                      {!expanded.did_not_finish && (
                        <ShowMore shown={limit} total={shelves.did_not_finish.length} onClick={() => showAll("did_not_finish")} />
                      )}
                    </ShelfSection>
                  )}
                </div>
              )}

              {/* ================= Stats ================= */}
              <section id="stats" aria-labelledby="stats-title" className="mt-20 sm:mt-24 scroll-mt-28">
                <div className="mb-6 sm:mb-8">
                  <p className="tracking-[0.25em] uppercase text-xs text-[#7a947c] font-medium mb-2">In numbers</p>
                  <h2 id="stats-title" className="font-classical text-3xl sm:text-4xl font-semibold">
                    Your reading, at a glance
                  </h2>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-5">
                  <div className="min-w-0 lg:col-span-3">
                    <FinishedByYear data={stats.byYear} selected={yearFilter} onSelect={pickYear} currentYear={currentYear} />
                  </div>
                  <div className="min-w-0 lg:col-span-2">
                    <ReviewProgress
                      finished={stats.counts.finished}
                      reviewed={stats.reviewed}
                      written={stats.writtenReviews}
                      unreviewed={stats.unreviewed}
                    />
                  </div>
                  <div className="min-w-0 lg:col-span-3">
                    <RatingBreakdown dist={stats.ratingDist} avg={stats.avgRating} />
                  </div>
                  <div className="min-w-0 lg:col-span-2">
                    <TopAuthors authors={stats.topAuthors} />
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}