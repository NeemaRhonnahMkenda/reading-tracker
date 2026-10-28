// src/app/shelves/_lib/arrange.ts
// How books sit on one shelf, as a small tree:
//
//   rows (front → back)  →  groups (left → right)  →  layers (bottom → top)  →  books (left → right)
//
// A group is anything that touches: a single standing book, a pile of flat books,
// books standing on a pile, a flat book lying across three standing ones…
// The database stores it flat (position + depth + layer + stack_key per book);
// these helpers convert both ways and apply moves.

import type { Orientation, Placement } from "./shelves";

export const MAX_ROWS = 3;
export const ROW_NAMES = ["Front row", "Second row", "Back row"];

export interface Group {
  key: string; // stack_key, or "solo:<bookId>" for a book on its own
  layers: string[][]; // bottom → top; each layer left → right
}

export type Rows = Group[][]; // index = depth

export type Target =
  | { kind: "tray" }
  | { kind: "alone"; depth: number; index: number } // its own group, at this group index
  | { kind: "onTop"; depth: number; groupKey: string } // a new layer on top of a group
  | { kind: "layer"; depth: number; groupKey: string; layer: number; where: "above" | "below" } // a new layer next to an existing one
  | { kind: "beside"; depth: number; groupKey: string; layer: number; index: number }; // into a layer, side by side

export type Relation = "onTop" | "under" | "left" | "right";

type Get = (id: string) => Placement | undefined;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ------------------------------------------------------------
// Flat ⇄ tree
// ------------------------------------------------------------

export function buildRows(ids: string[], get: Get): Rows {
  const rows: Rows = Array.from({ length: MAX_ROWS }, () => []);
  const raw = new Map<string, { depth: number; group: Group; byLayer: Map<number, string[]> }>();

  for (const id of ids) {
    const p = get(id);
    const depth = clamp(p?.depth ?? 0, 0, MAX_ROWS - 1);
    const key = p?.stack_key ?? `solo:${id}`;
    const mapKey = `${depth}|${key}`;
    let entry = raw.get(mapKey);
    if (!entry) {
      entry = { depth, group: { key, layers: [] }, byLayer: new Map() };
      raw.set(mapKey, entry);
      rows[depth].push(entry.group);
    }
    const layer = Math.max(0, p?.layer ?? 0);
    entry.byLayer.set(layer, [...(entry.byLayer.get(layer) ?? []), id]);
  }

  // Compact layer numbers (gaps can appear after books move away)
  raw.forEach(({ group, byLayer }) => {
    group.layers = Array.from(byLayer.keys())
      .sort((a, b) => a - b)
      .map((l) => byLayer.get(l)!);
  });
  return rows;
}

export interface FlatFields {
  depth: number;
  layer: number;
  stack_key: string | null;
}

export function flattenRows(rows: Rows) {
  const ids: string[] = [];
  const fields: Record<string, FlatFields> = {};
  rows.forEach((groups, depth) => {
    for (const g of groups) {
      const count = g.layers.reduce((n, l) => n + l.length, 0);
      if (count === 0) continue;
      // A lone book needs no key; a real group keeps (or gets) one
      const key = count > 1 ? (g.key.startsWith("solo:") ? crypto.randomUUID() : g.key) : null;
      g.layers.forEach((layer, li) =>
        layer.forEach((id) => {
          ids.push(id);
          fields[id] = { depth, layer: li, stack_key: key };
        })
      );
    }
  });
  return { ids, fields };
}

// ------------------------------------------------------------
// Queries
// ------------------------------------------------------------

export function cloneRows(rows: Rows): Rows {
  return rows.map((groups) => groups.map((g) => ({ key: g.key, layers: g.layers.map((l) => [...l]) })));
}

export function locate(rows: Rows, id: string) {
  for (let depth = 0; depth < rows.length; depth++) {
    const groups = rows[depth];
    for (let gi = 0; gi < groups.length; gi++) {
      const layers = groups[gi].layers;
      for (let li = 0; li < layers.length; li++) {
        const bi = layers[li].indexOf(id);
        if (bi >= 0) return { depth, gi, li, bi, group: groups[gi], groups };
      }
    }
  }
  return null;
}

export function usedRows(rows: Rows) {
  let last = 0;
  rows.forEach((groups, d) => groups.length && (last = d));
  return last + 1;
}

// ------------------------------------------------------------
// Moves (pure: always return new rows)
// ------------------------------------------------------------

export function removeBook(rows: Rows, id: string): Rows {
  const next = cloneRows(rows);
  for (const groups of next) {
    for (const g of groups) g.layers = g.layers.map((l) => l.filter((x) => x !== id)).filter((l) => l.length);
  }
  return next.map((groups) => groups.filter((g) => g.layers.length));
}

/** Insert a book (already removed from `rows`) at a target on this shelf. */
export function insertBook(rows: Rows, id: string, t: Exclude<Target, { kind: "tray" }>): Rows {
  const next = cloneRows(rows);
  const groups = next[clamp(t.depth, 0, MAX_ROWS - 1)];
  const solo: Group = { key: `solo:${id}`, layers: [[id]] };

  if (t.kind === "alone") {
    groups.splice(clamp(t.index, 0, groups.length), 0, solo);
    return next;
  }

  const g = groups.find((x) => x.key === t.groupKey);
  if (!g) {
    groups.push(solo);
    return next;
  }

  if (t.kind === "onTop") g.layers.push([id]);
  else if (t.kind === "layer") g.layers.splice(clamp(t.where === "above" ? t.layer + 1 : t.layer, 0, g.layers.length), 0, [id]);
  else {
    const layer = g.layers[clamp(t.layer, 0, g.layers.length - 1)];
    layer.splice(clamp(t.index, 0, layer.length), 0, id);
  }
  return next;
}

/** "On top of / under / left of / right of <anchor>", for the move sheet. */
export function targetFromRelation(rows: Rows, anchorId: string, relation: Relation): Target | null {
  const at = locate(rows, anchorId);
  if (!at) return null;
  const base = { depth: at.depth, groupKey: at.group.key };
  switch (relation) {
    case "onTop":
      return at.li === at.group.layers.length - 1 ? { kind: "onTop", ...base } : { kind: "layer", ...base, layer: at.li, where: "above" };
    case "under":
      return { kind: "layer", ...base, layer: at.li, where: "below" };
    case "left":
      return { kind: "beside", ...base, layer: at.li, index: at.bi };
    case "right":
      return { kind: "beside", ...base, layer: at.li, index: at.bi + 1 };
  }
}

// ------------------------------------------------------------
// Applying a move to the page's state
// ------------------------------------------------------------

export interface MoveResult {
  ids: Record<string, string[]>; // new flat order for each changed shelf (TRAY handled by caller)
  fields: Record<string, FlatFields & { orientation?: Orientation }>;
}

/**
 * Move a book from wherever it is to a target on `toShelf` (null = off the shelf).
 * `shelfIds` gives the current flat order of the shelves involved.
 */
export function moveBook(
  shelfIds: Record<string, string[]>,
  get: Get,
  bookId: string,
  fromShelf: string | null,
  toShelf: string | null,
  target: Target,
  orientation: Orientation
): MoveResult {
  const result: MoveResult = { ids: {}, fields: {} };
  const rowsOf = (sid: string) => buildRows(shelfIds[sid] ?? [], get);

  const apply = (sid: string, rows: Rows) => {
    const flat = flattenRows(rows);
    result.ids[sid] = flat.ids;
    Object.assign(result.fields, flat.fields);
  };

  if (fromShelf) {
    const without = removeBook(rowsOf(fromShelf), bookId);
    if (fromShelf === toShelf && target.kind !== "tray") {
      apply(fromShelf, insertBook(without, bookId, target));
      result.fields[bookId] = { ...result.fields[bookId], orientation };
      return result;
    }
    apply(fromShelf, without);
  }

  if (toShelf && target.kind !== "tray") {
    const rows = removeBook(rowsOf(toShelf), bookId);
    apply(toShelf, insertBook(rows, bookId, target));
    result.fields[bookId] = { ...result.fields[bookId], orientation };
  } else {
    result.fields[bookId] = { depth: 0, layer: 0, stack_key: null, orientation: "upright" };
  }
  return result;
}

// ------------------------------------------------------------
// Words
// ------------------------------------------------------------

function ord(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "back row · on top of a stack · 3rd from the left" */
export function describeSpot(rows: Rows, id: string) {
  const at = locate(rows, id);
  if (!at) return "";
  const parts: string[] = [];
  if (at.depth > 0 || usedRows(rows) > 1) parts.push(ROW_NAMES[at.depth].toLowerCase());

  const layers = at.group.layers.length;
  if (layers > 1) {
    if (at.li === layers - 1) parts.push("on top of a stack");
    else if (at.li === 0) parts.push(`at the bottom of a stack of ${layers}`);
    else parts.push(`${ord(at.li + 1)} up in a stack of ${layers}`);
  }
  if (at.group.layers[at.li].length > 1) parts.push(`${ord(at.bi + 1)} in its layer`);

  const n = at.gi + 1;
  const total = at.groups.length;
  parts.push(n <= Math.ceil(total / 2) ? `${ord(n)} from the left` : `${ord(total - n + 1)} from the right`);
  return parts.join(" · ");
}
