// src/app/shelves/_lib/shelves.ts
// Types, queries and spine maths for the digital bookcases.

import { supabase } from "../../../lib/supabase";

// ============================================================
// Types
// ============================================================

export type Orientation = "upright" | "flat";
export type SpineStyle = "auto" | "photo" | "painted";
export type SpineText = "auto" | "light" | "dark";
export type SpineFont = "serif" | "sans";

export interface ShelfBook {
  id: string;
  title: string;
  author: string | null;
  pages: number | null;
  status: string | null;
  cover_url: string | null;
  custom_cover_path: string | null;
}

export interface Bookcase {
  id: string;
  name: string;
  position: number;
}

export interface Shelf {
  id: string;
  bookcase_id: string;
  position: number; // 0 = top
  label: string | null;
}

export interface Placement {
  book_id: string;
  shelf_id: string | null;
  position: number | null;
  orientation: Orientation;
  spine_color: string | null;
  spine_path: string | null;
  spine_ratio: number | null;
  stack_key: string | null; // books with the same key form one group (null = on its own)
  depth: number; // 0 = front row, 1 = behind it, 2 = at the back
  layer: number; // 0 = on the shelf, 1 = on top of layer 0, …
  spine_style: SpineStyle;
  spine_text: SpineText;
  spine_font: SpineFont;
  height_ratio: number | null;
  photo_flip: boolean;
  photo_brightness: number;
}

// The parts of a placement that change how a spine looks
export type SpineLookFields = Pick<
  Placement,
  "spine_style" | "spine_text" | "spine_font" | "spine_color" | "spine_ratio" | "height_ratio" | "photo_flip" | "photo_brightness" | "spine_path"
>;

export const PLACEMENT_COLUMNS =
  "book_id, shelf_id, position, orientation, spine_color, spine_path, spine_ratio, stack_key, depth, layer, spine_style, spine_text, spine_font, height_ratio, photo_flip, photo_brightness";

export function emptyPlacement(bookId: string): Placement {
  return {
    book_id: bookId,
    shelf_id: null,
    position: null,
    orientation: "upright",
    spine_color: null,
    spine_path: null,
    spine_ratio: null,
    stack_key: null,
    depth: 0,
    layer: 0,
    spine_style: "auto",
    spine_text: "auto",
    spine_font: "serif",
    height_ratio: null,
    photo_flip: false,
    photo_brightness: 1,
  };
}

export interface ShelvesData {
  bookcases: Bookcase[];
  shelves: Shelf[];
  placements: Placement[];
  books: ShelfBook[];
}

// Ordered book ids per container: a shelf id, or TRAY for "not on a shelf"
export type Layout = Record<string, string[]>;

export const TRAY = "tray";
export const SPINE_BUCKET = "book-spines";
const COVER_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
const SIGNED_TTL = 60 * 60;

// ============================================================
// Load
// ============================================================

export async function loadShelvesData(userId: string): Promise<ShelvesData> {
  const [cases, shelves, placements, books] = await Promise.all([
    supabase.from("bookcases").select("id, name, position").eq("user_id", userId).order("position"),
    supabase.from("shelves").select("id, bookcase_id, position, label").eq("user_id", userId).order("position"),
    supabase
      .from("shelf_placements")
      .select(PLACEMENT_COLUMNS)
      .eq("user_id", userId),
    supabase
      .from("books")
      .select("id, title, author, pages, status, cover_url, custom_cover_path")
      .eq("user_id", userId)
      .order("title"),
  ]);

  for (const result of [cases, shelves, placements, books]) {
    if (result.error) throw result.error;
  }

  return {
    bookcases: (cases.data ?? []) as Bookcase[],
    shelves: (shelves.data ?? []) as Shelf[],
    placements: (placements.data ?? []) as Placement[],
    books: (books.data ?? []) as ShelfBook[],
  };
}

// Containers in display order with their book ids
export function buildLayout(data: ShelvesData): Layout {
  const layout: Layout = { [TRAY]: [] };
  data.shelves.forEach((s) => (layout[s.id] = []));

  const placed = new Map(data.placements.map((p) => [p.book_id, p]));
  const sorted = [...data.placements]
    .filter((p) => p.shelf_id && layout[p.shelf_id])
    .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || (a.position ?? 0) - (b.position ?? 0));

  sorted.forEach((p) => layout[p.shelf_id!].push(p.book_id));

  data.books.forEach((b) => {
    const p = placed.get(b.id);
    if (!p || !p.shelf_id || !layout[p.shelf_id]) layout[TRAY].push(b.id);
  });

  return layout;
}

// ============================================================
// Writes
// ============================================================

export async function applyLayout(
  shelves: {
    shelf_id: string;
    items: { book_id: string; orientation: Orientation; depth: number; layer: number; stack_key: string | null }[];
  }[]
) {
  if (shelves.length === 0) return;
  const { error } = await supabase.rpc("apply_shelf_layout", { p_shelves: shelves });
  if (error) throw error;
}

export async function createBookcase(name: string, shelfCount: number) {
  const { data, error } = await supabase.rpc("create_bookcase", { p_name: name, p_shelves: shelfCount });
  if (error) throw error;
  return data as string;
}

export async function renameBookcase(id: string, name: string) {
  const { error } = await supabase.from("bookcases").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function deleteBookcase(id: string) {
  const { error } = await supabase.from("bookcases").delete().eq("id", id);
  if (error) throw error;
}

export async function addShelf(bookcaseId: string) {
  const { error } = await supabase.rpc("add_shelf", { p_bookcase_id: bookcaseId });
  if (error) throw error;
}

export async function removeShelf(shelfId: string) {
  const { error } = await supabase.rpc("remove_shelf", { p_shelf_id: shelfId });
  if (error) throw error;
}

// Save how a spine looks. Creates the placement row if the book has never been placed.
export async function saveSpineLook(userId: string, bookId: string, look: Partial<SpineLookFields>) {
  const { data, error } = await supabase
    .from("shelf_placements")
    .upsert({ book_id: bookId, user_id: userId, ...look }, { onConflict: "book_id" })
    .select(PLACEMENT_COLUMNS)
    .single();
  if (error) throw error;
  return data as Placement;
}

// ============================================================
// Signed URLs (private buckets)
// ============================================================

const signedCache = new Map<string, { url: string; expiresAt: number }>();

export async function signPaths(bucket: string, paths: (string | null | undefined)[]) {
  const now = Date.now();
  const out: Record<string, string> = {};
  const missing: string[] = [];

  for (const p of new Set(paths.filter((x): x is string => !!x))) {
    const hit = signedCache.get(`${bucket}:${p}`);
    if (hit && hit.expiresAt - now > 5 * 60 * 1000) out[p] = hit.url;
    else missing.push(p);
  }

  if (missing.length) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, SIGNED_TTL);
    if (error) console.error(`Signing ${bucket} failed:`, error.message);
    const expiresAt = Date.now() + SIGNED_TTL * 1000;
    data?.forEach((item) => {
      if (item.path && item.signedUrl) {
        signedCache.set(`${bucket}:${item.path}`, { url: item.signedUrl, expiresAt });
        out[item.path] = item.signedUrl;
      }
    });
  }
  return out;
}

export const signSpines = (paths: (string | null)[]) => signPaths(SPINE_BUCKET, paths);
export const signCovers = (paths: (string | null)[]) => signPaths(COVER_BUCKET, paths);

// ============================================================
// Spine looks (deterministic, so a book always looks the same)
// ============================================================

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Muted cloth-binding colours that sit well on cream and wood
export const PAINTED = ["#1e2a44", "#3d5a45", "#7a3f33", "#a47a25", "#5f4f7a", "#2f5d62", "#8a5a44", "#4a4e57", "#6d7f9c", "#b98f6b", "#2b2b2b", "#7a947c"];

export function paintedColor(book: Pick<ShelfBook, "id" | "title">) {
  return PAINTED[hash(book.id + book.title) % PAINTED.length];
}

export function readableText(hex: string, mode: SpineText = "auto") {
  if (mode === "light") return "#fdfaf3";
  if (mode === "dark") return "#0f172a";
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.35 ? "#0f172a" : "#fdfaf3";
}

// How tall the book stands, as a share of the shelf's inner height (0.74 to 0.97)
export function heightRatio(bookId: string, placement?: Placement) {
  return placement?.height_ratio ?? 0.74 + (hash(bookId) % 24) / 100;
}

// Photo when there is one, unless this book (or the page) says painted
export function showsPhoto(placement: Placement | undefined, photo: string | null, pagePrefersPhoto: boolean) {
  if (!photo || !placement?.spine_path) return false;
  if (placement.spine_style === "photo") return true;
  if (placement.spine_style === "painted") return false;
  return pagePrefersPhoto;
}

// Spine thickness ÷ book height: from a scan, or guessed from the page count
export function spineRatio(placement: Placement | undefined, book: ShelfBook | undefined) {
  if (placement?.spine_ratio) return placement.spine_ratio;
  const pages = book?.pages ?? 280;
  const thicknessMm = Math.min(70, Math.max(9, pages * 0.065 + 4));
  return thicknessMm / 200;
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function errorMessage(err: unknown, fallback: string) {
  const e = err as { code?: string; message?: string } | null;
  if (e?.code === "42P01" || e?.code === "PGRST202") return "The shelves database isn't set up yet. Run shelves.sql in Supabase.";
  if (e?.code === "22023" && e.message) return e.message.endsWith(".") ? e.message : `${e.message}.`;
  return fallback;
}
