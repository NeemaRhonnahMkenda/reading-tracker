"use client";

// src/app/shelves/page.tsx
// Your real bookcases, rebuilt book by book. Scan a shelf to fill it, drag books
// to match real life, and tap any book (or search for one) to see exactly where
// it lives. /shelves?find=<bookId> opens straight into the find animation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import Navbar from "../components/Navbar";
import Button, { focusRing } from "../components/ui/Button";
import Toast, { useToast } from "../components/ui/Toast";
import { supabase } from "../../lib/supabase";

import {
  TRAY,
  addShelf,
  applyLayout,
  buildLayout,
  createBookcase,
  deleteBookcase,
  errorMessage,
  loadShelvesData,
  ordinal,
  removeShelf,
  renameBookcase,
  signSpines,
  type Bookcase,
  type Layout,
  type Orientation,
  type Placement,
  type Shelf,
  type ShelfBook,
} from "./_lib/shelves";

import BookcaseView from "./_components/BookcaseView";
import UnshelvedTray from "./_components/UnshelvedTray";
import ShelfSearch from "./_components/ShelfSearch";
import FindSpotlight, { type FindTarget } from "./_components/FindSpotlight";
import MoveBookSheet, { type MoveRequest } from "./_components/MoveBookSheet";
import BookcaseSheet, { type BookcaseSheetMode } from "./_components/BookcaseSheet";
import ScanShelfSheet from "./_components/ScanShelfSheet";
import { SpineVisual } from "./_components/Spine";

const PHOTO_KEY = "archive:shelves-photo-spines";

// ============================================================
// Helpers
// ============================================================

function useShelfHeight() {
  const [height, setHeight] = useState(150);
  useEffect(() => {
    const sm = window.matchMedia("(min-width: 640px)");
    const lg = window.matchMedia("(min-width: 1024px)");
    const update = () => setHeight(lg.matches ? 210 : sm.matches ? 185 : 150);
    update();
    sm.addEventListener("change", update);
    lg.addEventListener("change", update);
    return () => {
      sm.removeEventListener("change", update);
      lg.removeEventListener("change", update);
    };
  }, []);
  return height;
}

function cloneLayout(layout: Layout): Layout {
  return Object.fromEntries(Object.entries(layout).map(([k, v]) => [k, [...v]]));
}

function containerOf(layout: Layout, bookId: string) {
  return Object.keys(layout).find((k) => layout[k].includes(bookId)) ?? null;
}

// Where in this list a point falls, reading left to right, top to bottom
function indexFromPoint(ids: string[], x: number, y: number) {
  for (let i = 0; i < ids.length; i++) {
    const el = document.querySelector(`[data-spine-id="${CSS.escape(ids[i])}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (y < r.top - 4) return i;
    if (y <= r.bottom + 4 && x < r.left + r.width / 2) return i;
  }
  return ids.length;
}

// Collisions only against containers (shelves and the tray)
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

function shelfName(shelf: Shelf, count: number) {
  if (shelf.label) return shelf.label;
  if (count > 1 && shelf.position === 0) return "Top shelf";
  if (count > 1 && shelf.position === count - 1) return "Bottom shelf";
  return `${ordinal(shelf.position + 1)} shelf from the top`;
}

// ============================================================
// Page
// ============================================================

export default function ShelvesPage() {
  const shelfHeight = useShelfHeight();
  const { toast, showToast, dismissToast } = useToast(4000);

  // ---------- Data ----------
  const [userId, setUserId] = useState<string | null>(null);
  const [bookcases, setBookcases] = useState<Bookcase[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [layout, setLayout] = useState<Layout>({ [TRAY]: [] });
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ---------- UI ----------
  const [arranging, setArranging] = useState(false);
  const [usePhoto, setUsePhoto] = useState(true);
  const [find, setFind] = useState<FindTarget | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [savingMove, setSavingMove] = useState(false);
  const [caseSheet, setCaseSheet] = useState<BookcaseSheetMode>(null);
  const [caseSaving, setCaseSaving] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanShelf, setScanShelf] = useState<string | null>(null);

  // ---------- Drag ----------
  const [activeId, setActiveId] = useState<string | null>(null);
  const snapshotRef = useRef<Layout | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [pendingFind, setPendingFind] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // ---------- Derived ----------
  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const placementMap = useMemo(() => new Map(Object.entries(placements)), [placements]);
  const shelvesByCase = useMemo(() => {
    const map = new Map<string, Shelf[]>();
    shelves.forEach((s) => map.set(s.bookcase_id, [...(map.get(s.bookcase_id) ?? []), s]));
    map.forEach((l) => l.sort((a, b) => a.position - b.position));
    return map;
  }, [shelves]);

  const placedCount = books.length - (layout[TRAY]?.length ?? 0);

  // ============================================================
  // Load
  // ============================================================

  const load = useCallback(async (uid: string) => {
    setLoadError("");
    try {
      const data = await loadShelvesData(uid);
      setBookcases(data.bookcases);
      setShelves(data.shelves);
      setBooks(data.books);
      setPlacements(Object.fromEntries(data.placements.map((p) => [p.book_id, p])));
      setLayout(buildLayout(data));
      setPhotos(await signSpines(data.placements.map((p) => p.spine_path)));
    } catch (err) {
      console.error("Shelves load failed:", err);
      setLoadError(errorMessage(err, "Your shelves couldn't be loaded. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PHOTO_KEY);
      if (saved === "0") setUsePhoto(false);
    } catch {
      // storage unavailable
    }

    // ?find=<bookId> from the book page
    const param = new URLSearchParams(window.location.search).get("find");
    if (param) {
      setPendingFind(param);
      window.history.replaceState(null, "", "/shelves");
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      if (!uid) {
        window.location.replace("/login?next=/shelves");
        return;
      }
      setUserId(uid);
      load(uid);
    });
  }, [load]);

  function togglePhoto() {
    setUsePhoto((v) => {
      try {
        localStorage.setItem(PHOTO_KEY, v ? "0" : "1");
      } catch {
        // storage unavailable
      }
      return !v;
    });
  }

  // ============================================================
  // Find
  // ============================================================

  const describe = useCallback(
    (bookId: string) => {
      const sid = containerOf(layout, bookId);
      if (!sid || sid === TRAY) return null;
      const shelf = shelves.find((s) => s.id === sid);
      if (!shelf) return null;
      const bookcase = bookcases.find((c) => c.id === shelf.bookcase_id);
      const count = shelvesByCase.get(shelf.bookcase_id)?.length ?? 1;
      const ids = layout[sid];
      const n = ids.indexOf(bookId) + 1;
      const flat = placements[bookId]?.orientation === "flat";
      const side = n <= Math.ceil(ids.length / 2) ? `${ordinal(n)} from the left` : `${ordinal(ids.length - n + 1)} from the right`;
      return {
        shelf,
        place: bookcase?.name ?? "Bookcase",
        detail: `${shelfName(shelf, count)} · ${flat ? "lying flat, " : ""}${side}`,
      };
    },
    [layout, shelves, bookcases, shelvesByCase, placements]
  );

  const findBook = useCallback(
    (bookId: string) => {
      const book = bookMap.get(bookId);
      if (!book) return;
      const where = describe(bookId);
      if (!where) {
        showToast("error", `${book.title} isn't on a shelf yet. Choose where it goes.`);
        setMoving(bookId);
        return;
      }
      const placement = placements[bookId];
      setFind({
        bookId,
        orientation: placement?.orientation ?? "upright",
        place: where.place,
        detail: where.detail,
        look: {
          book,
          placement,
          photo: placement?.spine_path ? photos[placement.spine_path] ?? null : null,
          usePhoto,
          shelfHeight,
        },
      });
    },
    [bookMap, describe, placements, photos, usePhoto, shelfHeight, showToast]
  );

  // Run a find that was waiting for fresh data (from ?find=, a move or a scan)
  useEffect(() => {
    if (loading || !pendingFind) return;
    const timer = window.setTimeout(() => {
      setPendingFind(null);
      findBook(pendingFind);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [loading, pendingFind, findBook]);

  function onSpineSelect(bookId: string) {
    if (arranging) setMoving(bookId);
    else findBook(bookId);
  }

  // ============================================================
  // Saving moves
  // ============================================================

  const persist = useCallback(
    async (containers: string[], next: Layout, nextPlacements: Record<string, Placement>, rollback: () => void) => {
      const payload = containers
        .filter((c) => c !== TRAY && next[c])
        .map((c) => ({
          shelf_id: c,
          items: next[c].map((id) => ({ book_id: id, orientation: nextPlacements[id]?.orientation ?? ("upright" as Orientation) })),
        }));

      try {
        await applyLayout(payload);
        // Keep local placement rows in step with the database
        setPlacements((cur) => {
          const out = { ...cur };
          for (const c of containers) {
            next[c]?.forEach((id, i) => {
              const base: Placement = out[id] ?? {
                book_id: id,
                shelf_id: null,
                position: null,
                orientation: "upright",
                spine_color: null,
                spine_path: null,
                spine_ratio: null,
              };
              out[id] = {
                ...base,
                orientation: nextPlacements[id]?.orientation ?? base.orientation,
                shelf_id: c === TRAY ? null : c,
                position: c === TRAY ? null : i,
              };
            });
          }
          return out;
        });
        return true;
      } catch (err) {
        console.error("Saving the shelf order failed:", err);
        rollback();
        showToast("error", errorMessage(err, "That move couldn't be saved. Try again."));
        return false;
      }
    },
    [showToast]
  );

  const sortTray = useCallback(
    (ids: string[]) => [...ids].sort((a, b) => (bookMap.get(a)?.title ?? "").localeCompare(bookMap.get(b)?.title ?? "")),
    [bookMap]
  );

  // ============================================================
  // Drag and drop
  // ============================================================

  function onDragStart(e: DragStartEvent) {
    snapshotRef.current = cloneLayout(layoutRef.current);
    setActiveId(String(e.active.id));
  }

  function onDragMove(e: DragMoveEvent) {
    const { active, over } = e;
    if (!over) return;
    const rect = active.rect.current.translated;
    if (!rect) return;

    const id = String(active.id);
    const to = String(over.data.current?.container ?? over.id);
    const current = layoutRef.current;
    const from = containerOf(current, id);
    if (!from || !current[to]) return;

    const without = current[to].filter((x) => x !== id);
    const index = indexFromPoint(without, rect.left + rect.width / 2, rect.top + rect.height / 2);

    if (from === to && current[to].indexOf(id) === index) return;

    const next = cloneLayout(current);
    next[from] = next[from].filter((x) => x !== id);
    next[to] = [...without.slice(0, index), id, ...without.slice(index)];
    setLayout(next);
  }

  function onDragEnd(_e: DragEndEvent) {
    const before = snapshotRef.current;
    snapshotRef.current = null;
    setActiveId(null);
    if (!before) return;

    const next = cloneLayout(layoutRef.current);
    next[TRAY] = sortTray(next[TRAY] ?? []);
    setLayout(next);

    const changed = Object.keys(next).filter((k) => k !== TRAY && (before[k] ?? []).join("|") !== next[k].join("|"));
    if (changed.length === 0) return;

    const previousPlacements = placements;
    persist(changed, next, placements, () => {
      setLayout(before);
      setPlacements(previousPlacements);
    });
  }

  function onDragCancel() {
    if (snapshotRef.current) setLayout(snapshotRef.current);
    snapshotRef.current = null;
    setActiveId(null);
  }

  // ============================================================
  // Move sheet
  // ============================================================

  async function applyMove(move: MoveRequest) {
    const before = cloneLayout(layout);
    const previousPlacements = placements;
    const from = containerOf(layout, move.bookId) ?? TRAY;
    const to = move.shelfId ?? TRAY;

    const next = cloneLayout(layout);
    Object.keys(next).forEach((k) => (next[k] = next[k].filter((x) => x !== move.bookId)));
    if (to === TRAY) next[TRAY] = sortTray([...next[TRAY], move.bookId]);
    else next[to].splice(Math.min(move.index, next[to].length), 0, move.bookId);

    const nextPlacements = {
      ...placements,
      [move.bookId]: { ...(placements[move.bookId] ?? { book_id: move.bookId, shelf_id: null, position: null, spine_color: null, spine_path: null, spine_ratio: null }), orientation: move.orientation },
    } as Record<string, Placement>;

    setSavingMove(true);
    setLayout(next);
    setPlacements(nextPlacements);

    const ok = await persist(Array.from(new Set([from, to])), next, nextPlacements, () => {
      setLayout(before);
      setPlacements(previousPlacements);
    });

    setSavingMove(false);
    if (!ok) return;

    setMoving(null);
    const title = bookMap.get(move.bookId)?.title ?? "Book";
    if (to === TRAY) {
      showToast("success", `${title} is off the shelf.`);
    } else {
      showToast("success", `${title} moved.`);
      if (!arranging) setPendingFind(move.bookId); // show where it landed
    }
  }

  // ============================================================
  // Bookcases
  // ============================================================

  async function submitCase(name: string, count: number) {
    if (!userId || !caseSheet) return;
    setCaseSaving(true);
    setCaseError("");
    try {
      if (caseSheet.kind === "create") {
        await createBookcase(name, count);
        showToast("success", `${name} is ready. Scan a shelf to fill it.`);
      } else {
        await renameBookcase(caseSheet.bookcase.id, name);
        showToast("success", "Bookcase renamed.");
      }
      setCaseSheet(null);
      await load(userId);
    } catch (err) {
      console.error("Bookcase save failed:", err);
      setCaseError(errorMessage(err, "The bookcase couldn't be saved. Try again."));
    } finally {
      setCaseSaving(false);
    }
  }

  async function runCaseAction(action: () => Promise<void>, success: string, failure: string) {
    if (!userId) return;
    try {
      await action();
      await load(userId);
      showToast("success", success);
    } catch (err) {
      console.error(failure, err);
      showToast("error", errorMessage(err, failure));
    }
  }

  function confirmRemoveShelf(shelfId: string) {
    const count = layout[shelfId]?.length ?? 0;
    if (count > 0 && !window.confirm(`Remove this shelf? Its ${count} ${count === 1 ? "book moves" : "books move"} to "Not on a shelf".`)) return;
    runCaseAction(() => removeShelf(shelfId), "Shelf removed.", "The shelf couldn't be removed.");
  }

  function confirmDeleteCase(bookcase: Bookcase) {
    if (!window.confirm(`Delete ${bookcase.name}? Its books stay in your library and move to "Not on a shelf".`)) return;
    runCaseAction(() => deleteBookcase(bookcase.id), `${bookcase.name} deleted.`, "The bookcase couldn't be deleted.");
  }

  function openScan(shelfId: string | null) {
    if (bookcases.length === 0) {
      setCaseSheet({ kind: "create" });
      return;
    }
    setScanShelf(shelfId);
    setScanOpen(true);
  }

  async function onScanSaved(shelfId: string, firstBookId: string | null, count: number) {
    setScanOpen(false);
    if (!userId) return;
    const shelf = shelves.find((s) => s.id === shelfId);
    const bookcase = bookcases.find((c) => c.id === shelf?.bookcase_id);
    showToast("success", `${count} ${count === 1 ? "book" : "books"} saved to ${bookcase?.name ?? "your shelf"}.`);
    await load(userId);
    if (firstBookId) setPendingFind(firstBookId);
  }

  // ============================================================
  // Render
  // ============================================================

  const activeBook = activeId ? bookMap.get(activeId) : null;
  const activePlacement = activeId ? placements[activeId] : undefined;
  const movingBook = moving ? bookMap.get(moving) ?? null : null;
  const movingShelf = moving ? containerOf(layout, moving) : null;

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] overflow-x-clip">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
            .shelf-scroll { scrollbar-width: thin; scrollbar-color: rgba(253,250,243,0.25) transparent; scroll-behavior: smooth; }
            @media (prefers-reduced-motion: reduce) { .shelf-scroll { scroll-behavior: auto; } }
          `,
        }}
      />

      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[520px] bg-[#d8d0e3]/25 rounded-full blur-[130px]" />
        <div className="absolute top-[45%] -right-40 w-[600px] h-[600px] bg-[#c69a3d]/10 rounded-full blur-[130px]" />
      </div>

      <Navbar isLoggedIn={!!userId || undefined} />

      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-28">
        {/* ================= Header ================= */}
        <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="tracking-[0.25em] uppercase text-xs sm:text-sm text-[#7a947c] font-medium mb-3">Your real bookcases</p>
            <h1 className="font-classical text-[2.6rem] leading-[1.05] sm:text-6xl font-semibold">My Shelves</h1>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-600 font-light max-w-xl">
              Every book where it really sits. Tap one, or search, and we&apos;ll show you exactly where to reach.
            </p>
          </div>
          {books.length > 0 && bookcases.length > 0 && (
            <ShelfSearch
              books={books}
              onPick={findBook}
              locate={(id) => {
                const w = describe(id);
                return w ? { shelved: true, text: `${w.place} · ${shelfName(w.shelf, shelvesByCase.get(w.shelf.bookcase_id)?.length ?? 1)}` } : { shelved: false, text: "Not on a shelf" };
              }}
            />
          )}
        </header>

        {loading ? (
          <div className="mt-10 space-y-10" aria-busy="true" aria-label="Loading your shelves">
            {[0, 1].map((i) => (
              <div key={i}>
                <div className="h-7 w-48 rounded-full bg-[#0f172a]/[0.07] animate-pulse mb-3" />
                <div className="h-[420px] rounded-[14px] bg-[#7d5a35]/25 animate-pulse" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="mt-10 rounded-[1.6rem] bg-[#fbefed] border border-red-200/70 px-6 py-10 text-center">
            <p className="text-[#a14e43]">{loadError}</p>
            <Button variant="dark" className="mt-5" onClick={() => userId && load(userId)}>Try again</Button>
          </div>
        ) : bookcases.length === 0 ? (
          /* ================= Empty ================= */
          <section className="mt-10 rounded-[1.8rem] bg-white/70 border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] px-6 py-12 sm:py-16">
            <div className="max-w-3xl mx-auto grid md:grid-cols-[200px_1fr] gap-10 items-center">
              <div aria-hidden="true" className="mx-auto w-40 md:w-full rounded-xl p-2 bg-[linear-gradient(135deg,#9b7448,#6a4a2b)] shadow-xl">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-end gap-[2px] h-14 px-2 pt-2 bg-[#3b2a1c] border-b-4 border-[#a8814f]">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <span
                        key={i}
                        className="block rounded-t-[2px]"
                        style={{
                          width: 8 + ((i * 7 + row * 3) % 6),
                          height: `${70 + ((i * 13 + row * 11) % 28)}%`,
                          background: ["#1e2a44", "#7a947c", "#7a3f33", "#a47a25", "#5f4f7a", "#2f5d62", "#b98f6b"][(i + row * 2) % 7],
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div>
                <h2 className="font-classical text-3xl font-semibold">Build your shelves</h2>
                <ol className="mt-5 space-y-3 text-slate-600">
                  {[
                    ["Add a bookcase", "Name it after the room and set how many shelves it has."],
                    ["Scan each shelf", "Photograph it; we split the spines and match them to your library."],
                    ["Find anything", "Tap a book or search, and see exactly where it sits."],
                  ].map(([title, text], i) => (
                    <li key={title} className="flex gap-3">
                      <span className="w-7 h-7 shrink-0 rounded-full bg-[#0f172a] text-[#fdfaf3] text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                      <span>
                        <span className="font-medium text-[#0f172a]">{title}.</span> {text}
                      </span>
                    </li>
                  ))}
                </ol>
                <Button variant="dark" size="lg" className="mt-7" onClick={() => setCaseSheet({ kind: "create" })}>
                  Build your first bookcase
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* ================= Toolbar ================= */}
            <div className="sticky top-16 sm:top-[4.5rem] z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 mt-8 sm:mt-10 bg-[#fdfaf3]/85 backdrop-blur-md border-b border-[#0f172a]/[0.05]">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="flex-1 min-w-[10rem]">
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold text-[#0f172a]">{placedCount}</span> of {books.length} books on shelves
                  </p>
                  <div className="mt-1.5 h-1.5 max-w-[14rem] rounded-full bg-[#0f172a]/[0.07] overflow-hidden" aria-hidden="true">
                    <div className="h-full rounded-full bg-[#c69a3d] transition-[width] duration-700" style={{ width: `${books.length ? (placedCount / books.length) * 100 : 0}%` }} />
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={usePhoto}
                  onClick={togglePhoto}
                  className={`hidden sm:inline-flex h-10 px-4 rounded-full border text-xs font-medium items-center gap-2 transition-colors ${focusRing} ${
                    usePhoto ? "bg-white border-[#0f172a]/10 text-slate-600" : "bg-white border-[#0f172a]/10 text-slate-400"
                  }`}
                >
                  <span aria-hidden="true" className={`relative w-8 h-[18px] rounded-full transition-colors ${usePhoto ? "bg-[#7a947c]" : "bg-[#0f172a]/15"}`}>
                    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${usePhoto ? "left-[16px]" : "left-[2px]"}`} />
                  </span>
                  Photo spines
                </button>

                <Button variant={arranging ? "primary" : "outline"} onClick={() => setArranging((v) => !v)} aria-pressed={arranging}>
                  {arranging ? "Done arranging" : "Arrange"}
                </Button>
                <Button variant="dark" onClick={() => openScan(null)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  Scan
                </Button>
              </div>

              {arranging && (
                <p className="mt-2.5 text-xs text-[#4a5c4b] bg-[#eef3ee] rounded-xl px-3 py-2">
                  Drag books between shelves (on a phone, press and hold first). Tap a book to place it exactly or lay it flat. Changes save as you go.
                </p>
              )}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
              accessibility={{
                announcements: {
                  onDragStart: ({ active }) => `Picked up ${bookMap.get(String(active.id))?.title ?? "book"}.`,
                  onDragOver: () => "",
                  onDragEnd: ({ active }) => `Dropped ${bookMap.get(String(active.id))?.title ?? "book"}.`,
                  onDragCancel: ({ active }) => `Put ${bookMap.get(String(active.id))?.title ?? "book"} back.`,
                },
              }}
            >
              {/* ================= Tray ================= */}
              <div className="mt-6">
                <UnshelvedTray
                  ids={layout[TRAY] ?? []}
                  books={bookMap}
                  placements={placementMap}
                  photos={photos}
                  usePhoto={usePhoto}
                  arranging={arranging}
                  onSelect={(id) => setMoving(id)}
                  onStartArranging={() => setArranging(true)}
                />
              </div>

              {/* ================= Bookcases ================= */}
              <div className="mt-10 space-y-14">
                {bookcases.map((bc) => (
                  <BookcaseView
                    key={bc.id}
                    bookcase={bc}
                    shelves={shelvesByCase.get(bc.id) ?? []}
                    layout={layout}
                    books={bookMap}
                    placements={placementMap}
                    photos={photos}
                    usePhoto={usePhoto}
                    shelfHeight={shelfHeight}
                    arranging={arranging}
                    focusId={null}
                    onSelect={onSpineSelect}
                    onRename={() => setCaseSheet({ kind: "rename", bookcase: bc })}
                    onAddShelf={() => runCaseAction(() => addShelf(bc.id), "Shelf added at the bottom.", "The shelf couldn't be added.")}
                    onRemoveShelf={confirmRemoveShelf}
                    onDelete={() => confirmDeleteCase(bc)}
                    onScan={(sid) => openScan(sid)}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => setCaseSheet({ kind: "create" })}
                  className={`w-full rounded-[14px] border-2 border-dashed border-[#0f172a]/15 py-8 text-sm font-medium text-slate-500 hover:border-[#7a947c] hover:text-[#0f172a] hover:bg-white/50 transition-colors ${focusRing}`}
                >
                  + Add another bookcase
                </button>
              </div>

              <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }}>
                {activeBook ? (
                  <div className="rotate-[-4deg] scale-105">
                    <SpineVisual
                      look={{
                        book: activeBook,
                        placement: activePlacement,
                        photo: activePlacement?.spine_path ? photos[activePlacement.spine_path] ?? null : null,
                        usePhoto,
                        shelfHeight,
                      }}
                      orientation={activePlacement?.orientation ?? "upright"}
                      lifted
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </>
        )}
      </div>

      {/* ================= Overlays ================= */}
      <FindSpotlight target={find} onClose={() => setFind(null)} />

      <MoveBookSheet
        book={movingBook}
        currentShelfId={movingShelf}
        orientation={moving ? placements[moving]?.orientation ?? "upright" : "upright"}
        bookcases={bookcases}
        shelves={shelves}
        layout={layout}
        books={bookMap}
        saving={savingMove}
        onClose={() => setMoving(null)}
        onSave={applyMove}
      />

      <BookcaseSheet
        mode={caseSheet}
        saving={caseSaving}
        error={caseError}
        onClose={() => {
          setCaseSheet(null);
          setCaseError("");
        }}
        onSubmit={submitCase}
      />

      {userId && (
        <ScanShelfSheet
          open={scanOpen}
          userId={userId}
          bookcases={bookcases}
          shelves={shelves}
          layout={layout}
          books={books}
          initialShelfId={scanShelf}
          onClose={() => setScanOpen(false)}
          onSaved={onScanSaved}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </main>
  );
}
