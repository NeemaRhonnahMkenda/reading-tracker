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
  emptyPlacement,
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
import SpineEditorSheet from "./_components/SpineEditorSheet";
import { SpineVisual } from "./_components/Spine";
import {
  ROW_NAMES,
  buildRows,
  describeSpot,
  moveBook,
  removeBook,
  type Target,
} from "./_lib/arrange";

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

// Collisions only against containers; row tabs win over the shelf behind them
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) {
    const tab = hits.find((h) => args.droppableContainers.find((c) => c.id === h.id)?.data.current?.tab);
    return tab ? [tab] : hits;
  }
  return rectIntersection(args);
};

// ------------------------------------------------------------
// Working out where a dragged book will land
// ------------------------------------------------------------

type Box = { left: number; top: number; width: number; height: number };

interface DropHint {
  key: string;
  shelfId: string | null; // null = off the shelf
  target: Target;
  line?: Box; // gold insertion bar
  box?: Box; // outline of what it joins
  label: string;
}

const CAP = 46; // px above a group that counts as "on top of it"

function rectOfSpine(id: string) {
  return document.querySelector(`[data-spine-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null;
}

function union(rects: (DOMRect | null)[]): Box | null {
  const rs = rects.filter((r): r is DOMRect => !!r);
  if (!rs.length) return null;
  const left = Math.min(...rs.map((r) => r.left));
  const top = Math.min(...rs.map((r) => r.top));
  return { left, top, width: Math.max(...rs.map((r) => r.right)) - left, height: Math.max(...rs.map((r) => r.bottom)) - top };
}

function toBox(r: { left: number; top: number; width: number; height: number }): Box {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const vline = (x: number, top: number, height: number): Box => ({ left: x - 1.5, top, width: 3, height: Math.max(height, 18) });
const hline = (left: number, y: number, width: number): Box => ({ left, top: y - 1.5, width: Math.max(width, 24), height: 3 });

// Pointer position during a drag (falls back to the dragged item's centre for keyboard drags)
function pointerOf(e: DragMoveEvent | DragEndEvent) {
  const ev = e.activatorEvent;
  let x: number | null = null;
  let y: number | null = null;
  if (typeof TouchEvent !== "undefined" && ev instanceof TouchEvent) {
    const t = ev.touches[0] ?? ev.changedTouches[0];
    if (t) {
      x = t.clientX;
      y = t.clientY;
    }
  } else if (ev instanceof MouseEvent) {
    x = ev.clientX;
    y = ev.clientY;
  }
  if (x === null || y === null) {
    const r = e.active.rect.current.translated;
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }
  return { x: x + e.delta.x, y: y + e.delta.y };
}

function computeDrop(opts: {
  shelfId: string;
  depth: number;
  rowRect: Box;
  x: number;
  y: number;
  dragId: string;
  ids: string[];
  get: (id: string) => Placement | undefined;
  title: (id: string) => string;
}): DropHint {
  const { shelfId, depth, rowRect, x, y, dragId, ids, get, title } = opts;
  const rows = removeBook(buildRows(ids, get), dragId);
  const groups = rows[depth] ?? [];
  const base = `${shelfId}|${depth}`;

  const alone = (index: number, at: number): DropHint => ({
    key: `alone|${base}|${index}`,
    shelfId,
    target: { kind: "alone", depth, index },
    line: vline(at, rowRect.top + 6, rowRect.height - 10),
    label: depth > 0 ? `${ROW_NAMES[depth]}, on its own` : "Here, on its own",
  });

  const rects = groups.map(
    (g) => document.querySelector(`[data-group="${CSS.escape(`${base}|${g.key}`)}"]`)?.getBoundingClientRect() ?? null
  );

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const r = rects[gi];
    if (!r || x < r.left - 3 || x > r.right + 3) continue;

    // Just above a group, or its top edge (tall books leave no room above them): a new layer on top
    if (y >= r.top - CAP && y < r.top + Math.min(24, r.height * 0.2)) {
      const top = g.layers[g.layers.length - 1];
      return {
        key: `top|${base}|${g.key}`,
        shelfId,
        target: { kind: "onTop", depth, groupKey: g.key },
        line: hline(r.left, r.top - 3, r.width),
        box: toBox(r),
        label: `On top of ${title(top[0])}`,
      };
    }
    if (y < r.top || y > r.bottom + 2) continue;

    // Inside the group: which layer, and where in it
    const layerRects = g.layers.map((l) => union(l.map(rectOfSpine)));
    let li = layerRects.findIndex((lr) => !!lr && y >= lr.top && y <= lr.top + lr.height);
    if (li < 0) {
      let best = Infinity;
      layerRects.forEach((lr, i) => {
        if (!lr) return;
        const d = Math.min(Math.abs(y - lr.top), Math.abs(y - (lr.top + lr.height)));
        if (d < best) {
          best = d;
          li = i;
        }
      });
    }
    if (li < 0) continue;
    const layer = g.layers[li];
    const lr = layerRects[li]!;
    const bookRects = layer.map(rectOfSpine);
    let bi = layer.findIndex((_, i) => !!bookRects[i] && x < bookRects[i]!.left + bookRects[i]!.width / 2);
    if (bi < 0) bi = layer.length;
    const besideX = bi < layer.length && bookRects[bi] ? bookRects[bi]!.left - 1 : lr.left + lr.width + 1;
    const count = g.layers.reduce((n, l) => n + l.length, 0);

    if (count === 1) {
      // A book on its own: the outer thirds put the dragged book beside it as a
      // separate book; the middle joins it, so things can later go across both
      const rel = (x - r.left) / Math.max(1, r.width);
      if (rel < 0.3) return alone(gi, r.left - 2);
      if (rel > 0.7) return alone(gi + 1, r.right + 2);
      const index = rel < 0.5 ? 0 : 1;
      return {
        key: `join|${base}|${g.key}|${index}`,
        shelfId,
        target: { kind: "beside", depth, groupKey: g.key, layer: 0, index },
        line: vline(index === 0 ? r.left - 1 : r.right + 1, r.top, r.height),
        box: toBox(r),
        label: `Beside ${title(layer[0])}, as one stack`,
      };
    }

    // The outer edge of a stack's bottom layer: leave the stack
    if (li === 0) {
      const edge = Math.min(10, lr.width * 0.15);
      if (x < lr.left + edge) return alone(gi, r.left - 2);
      if (x > lr.left + lr.width - edge) return alone(gi + 1, r.right + 2);
    }

    // A layer of flat books: top or bottom third slots in a new layer
    if (layer.every((id) => get(id)?.orientation === "flat")) {
      const rel = (y - lr.top) / Math.max(1, lr.height);
      if (rel < 0.33)
        return {
          key: `above|${base}|${g.key}|${li}`,
          shelfId,
          target: { kind: "layer", depth, groupKey: g.key, layer: li, where: "above" },
          line: hline(lr.left, lr.top - 1, lr.width),
          box: toBox(r),
          label: `On top of ${title(layer[0])}`,
        };
      if (rel > 0.67)
        return {
          key: `below|${base}|${g.key}|${li}`,
          shelfId,
          target: { kind: "layer", depth, groupKey: g.key, layer: li, where: "below" },
          line: hline(lr.left, lr.top + lr.height + 1, lr.width),
          box: toBox(r),
          label: `Under ${title(layer[0])}`,
        };
    }

    return {
      key: `beside|${base}|${g.key}|${li}|${bi}`,
      shelfId,
      target: { kind: "beside", depth, groupKey: g.key, layer: li, index: bi },
      line: vline(besideX, lr.top, lr.height),
      box: toBox(r),
      label: `Beside ${title(layer[Math.min(bi, layer.length - 1)])}${g.layers.length > 1 ? ` (layer ${li + 1})` : ""}`,
    };
  }

  // Not over a group: its own spot in the row
  let index = groups.length;
  for (let gi = 0; gi < groups.length; gi++) {
    const r = rects[gi];
    if (r && x < r.left + r.width / 2) {
      index = gi;
      break;
    }
  }
  const at = index < groups.length && rects[index] ? rects[index]!.left - 2 : index > 0 && rects[index - 1] ? rects[index - 1]!.right + 2 : rowRect.left + 16;
  return alone(index, at);
}

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
  const [editing, setEditing] = useState<string | null>(null);

  // ---------- Drag ----------
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragOrientation, setDragOrientation] = useState<Orientation>("upright");
  const dragOrientationRef = useRef<Orientation>("upright");
  dragOrientationRef.current = dragOrientation;
  const [hint, setHint] = useState<DropHint | null>(null);
  const hintRef = useRef<DropHint | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null); // the real pointer, kept current while dragging
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const placementsRef = useRef(placements);
  placementsRef.current = placements;
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
      const rows = buildRows(layout[sid] ?? [], (id) => placements[id]);
      const flat = placements[bookId]?.orientation === "flat";
      return {
        shelf,
        place: bookcase?.name ?? "Bookcase",
        detail: `${shelfName(shelf, count)} · ${flat ? "lying flat · " : ""}${describeSpot(rows, bookId)}`,
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
          items: next[c].map((id) => {
            const p = nextPlacements[id];
            return {
              book_id: id,
              orientation: (p?.orientation === "flat" ? "flat" : "upright") as Orientation,
              depth: p?.depth ?? 0,
              layer: p?.layer ?? 0,
              stack_key: p?.stack_key ?? null,
            };
          }),
        }));

      try {
        await applyLayout(payload);
        // Keep local placement rows in step with the database
        setPlacements((cur) => {
          const out = { ...cur };
          for (const c of containers) {
            next[c]?.forEach((id, i) => {
              const base = out[id] ?? emptyPlacement(id);
              const draft = nextPlacements[id] ?? base;
              out[id] = {
                ...base,
                orientation: draft.orientation,
                stack_key: draft.stack_key,
                depth: draft.depth,
                layer: draft.layer,
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

  // Apply a move locally straight away, then save it (rolls back on failure)
  async function commitMove(bookId: string, toShelf: string | null, target: Target, orientation: Orientation) {
    const current = layoutRef.current;
    const currentPlacements = placementsRef.current;
    const from = containerOf(current, bookId);
    const fromShelf = from && from !== TRAY ? from : null;
    const dest = target.kind === "tray" ? null : toShelf;

    const shelfIds: Record<string, string[]> = {};
    if (fromShelf) shelfIds[fromShelf] = current[fromShelf] ?? [];
    if (dest) shelfIds[dest] = current[dest] ?? [];

    const result = moveBook(shelfIds, (id) => currentPlacements[id], bookId, fromShelf, dest, target, orientation);

    const next = cloneLayout(current);
    Object.entries(result.ids).forEach(([sid, ids]) => (next[sid] = ids));
    next[TRAY] = (next[TRAY] ?? []).filter((x) => x !== bookId);
    if (!dest) next[TRAY] = sortTray([...next[TRAY], bookId]);

    const nextPlacements: Record<string, Placement> = { ...currentPlacements };
    for (const [id, f] of Object.entries(result.fields)) {
      const prev = nextPlacements[id] ?? emptyPlacement(id);
      nextPlacements[id] = { ...prev, depth: f.depth, layer: f.layer, stack_key: f.stack_key, orientation: f.orientation ?? prev.orientation };
    }

    // Nothing actually changed (dropped back where it was)
    const changed = Object.keys(result.ids).filter((sid) => {
      if ((current[sid] ?? []).join("|") !== result.ids[sid].join("|")) return true;
      return result.ids[sid].some((id) => {
        const a = currentPlacements[id];
        const b = nextPlacements[id];
        return a?.depth !== b.depth || a?.layer !== b.layer || (a?.stack_key ?? null) !== (b.stack_key ?? null) || a?.orientation !== b.orientation;
      });
    });
    if (changed.length === 0 && (from === TRAY) === !dest) return true;

    setLayout(next);
    setPlacements(nextPlacements);
    return persist(Object.keys(result.ids), next, nextPlacements, () => {
      setLayout(current);
      setPlacements(currentPlacements);
    });
  }

  function setDropHint(next: DropHint | null) {
    if (hintRef.current?.key === next?.key && hintRef.current?.line?.left === next?.line?.left && hintRef.current?.box?.top === next?.box?.top) return;
    hintRef.current = next;
    setHint(next);
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    pointerRef.current = null;
    setActiveId(id);
    setDragOrientation(placementsRef.current[id]?.orientation === "flat" ? "flat" : "upright");
    setDropHint(null);
  }

  function onDragMove(e: DragMoveEvent) {
    const over = e.over;
    // The drag offset ignores page scrolling, so prefer the tracked pointer
    const point = pointerRef.current ?? pointerOf(e);
    if (!over || !point) return setDropHint(null);

    const id = String(e.active.id);
    const data = over.data.current as { container?: string; depth?: number; tab?: boolean } | undefined;
    const container = String(data?.container ?? over.id);

    if (container === TRAY) {
      return setDropHint({ key: "tray", shelfId: null, target: { kind: "tray" }, box: toBox(over.rect), label: "Take it off the shelf" });
    }
    const depth = data?.depth ?? 0;
    if (data?.tab) {
      const count = buildRows(layoutRef.current[container] ?? [], (b) => placementsRef.current[b])[depth]?.length ?? 0;
      return setDropHint({
        key: `tab|${container}|${depth}`,
        shelfId: container,
        target: { kind: "alone", depth, index: count },
        box: toBox(over.rect),
        label: `Move to the ${ROW_NAMES[depth].toLowerCase()}`,
      });
    }

    setDropHint(
      computeDrop({
        shelfId: container,
        depth,
        rowRect: toBox(over.rect),
        x: point.x,
        y: point.y,
        dragId: id,
        ids: layoutRef.current[container] ?? [],
        get: (b) => placementsRef.current[b],
        title: (b) => bookMap.get(b)?.title ?? "a book",
      })
    );
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const drop = hintRef.current;
    setActiveId(null);
    setDropHint(null);
    if (!drop) return; // the last guide shown is what the reader saw, even if the pointer just left
    commitMove(id, drop.shelfId, drop.target, drop.target.kind === "tray" ? "upright" : dragOrientationRef.current);
  }

  function onDragCancel() {
    setActiveId(null);
    setDropHint(null);
  }

  // Track the real pointer while dragging (mouse, pen or touch)
  useEffect(() => {
    if (!activeId) return;
    const onPointer = (e: MouseEvent) => (pointerRef.current = { x: e.clientX, y: e.clientY });
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) pointerRef.current = { x: t.clientX, y: t.clientY };
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("mousemove", onPointer, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("mousemove", onPointer);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [activeId]);

  // Press R while dragging to lay the book flat or stand it up
  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") setDragOrientation((o) => (o === "flat" ? "upright" : "flat"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId]);

  // ============================================================
  // Move sheet
  // ============================================================

  async function applyMove(move: MoveRequest) {
    const to = move.target.kind === "tray" ? TRAY : move.shelfId ?? TRAY;
    setSavingMove(true);
    const ok = await commitMove(move.bookId, move.shelfId, move.target, move.orientation);
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
    <main className={`${activeId ? "is-dragging " : ""}min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] overflow-x-clip`}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
            .is-dragging .spine-btn { translate: none !important; transform: none !important; } /* no hover lift while dragging */
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
                  Drag a book (on a phone, press and hold first): just above another book stacks it on top, onto a stack&apos;s side puts it beside, and the row tabs on each shelf move books behind. Press R while dragging to lay a book flat or stand it up. Tap a book to place it exactly. Changes save as you go.
                </p>
              )}
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragOver={onDragMove} /* the target from a move event can lag a step behind; recheck when it changes */
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
                      orientation={dragOrientation}
                      lifted
                    />
                  </div>
                ) : null}
              </DragOverlay>

              {/* Where it will land */}
              {activeId && hint && (
                <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]">
                  {hint.box && (
                    <div
                      className="absolute rounded-lg ring-2 ring-[#e8c873]/80 bg-[#e8c873]/10 transition-all duration-100"
                      style={{ left: hint.box.left - 4, top: hint.box.top - 4, width: hint.box.width + 8, height: hint.box.height + 8 }}
                    />
                  )}
                  {hint.line && (
                    <div className="absolute rounded-full bg-[#e8c873] shadow-[0_0_14px_#e8c873] transition-all duration-100" style={hint.line} />
                  )}
                  <div
                    className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[#0f172a] text-[#fdfaf3] text-[11px] font-semibold px-2.5 py-1 shadow-lg"
                    style={{
                      left: Math.min(Math.max((hint.line ?? hint.box)!.left + (hint.line ?? hint.box)!.width / 2, 90), (typeof window !== "undefined" ? window.innerWidth : 1200) - 90),
                      top: Math.max(30, Math.min(hint.line?.top ?? Infinity, hint.box?.top ?? Infinity) - 10),
                    }}
                  >
                    {hint.label}
                    {hint.target.kind !== "tray" && <span className="ml-1.5 text-[#e8c873]">· {dragOrientation === "flat" ? "flat" : "standing"}</span>}
                  </div>
                </div>
              )}
            </DndContext>
          </>
        )}
      </div>

      {/* ================= Overlays ================= */}
      <FindSpotlight
        target={find}
        onClose={() => setFind(null)}
        onEdit={(id) => {
          setFind(null);
          setEditing(id);
        }}
      />

      {userId && (
        <SpineEditorSheet
          book={editing ? bookMap.get(editing) ?? null : null}
          placement={editing ? placements[editing] : undefined}
          photoUrl={editing && placements[editing]?.spine_path ? photos[placements[editing]!.spine_path!] ?? null : null}
          pagePrefersPhoto={usePhoto}
          userId={userId}
          onClose={() => setEditing(null)}
          onSaved={(saved, url) => {
            setPlacements((cur) => ({ ...cur, [saved.book_id]: { ...(cur[saved.book_id] ?? emptyPlacement(saved.book_id)), ...saved } }));
            if (saved.spine_path && url) setPhotos((cur) => ({ ...cur, [saved.spine_path!]: url }));
            setEditing(null);
            showToast("success", "Spine updated.");
          }}
        />
      )}

      <MoveBookSheet
        book={movingBook}
        currentShelfId={movingShelf}
        placements={placementMap}
        bookcases={bookcases}
        shelves={shelves}
        layout={layout}
        books={bookMap}
        saving={savingMove}
        onClose={() => setMoving(null)}
        onSave={applyMove}
        onEditLook={(id) => {
          setMoving(null);
          setEditing(id);
        }}
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
