// src/app/shelves/_components/ShelfRow.tsx
// One shelf, drawn as up to three rows (front, second, back). Rows further back
// sit a little higher, smaller and darker, peeking out behind the front row.
// Each row is a line of groups; a group is layers stacked bottom to top, and a
// layer is books side by side, standing or lying flat. Books standing on a stack
// shrink to fit the space left under the shelf above.
//
// While arranging, tabs choose which row you're working on (the others fade),
// and dropping a book on a tab sends it to that row.

"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { focusRing } from "../../components/ui/Button";
import { heightRatio, type Placement, type ShelfBook } from "../_lib/shelves";
import { MAX_ROWS, buildRows, usedRows, type Group } from "../_lib/arrange";
import Spine, { spineSize, type SpineLook } from "./Spine";

const ROW_TABS = ["Front", "Second", "Back"];

// ------------------------------------------------------------
// Sizing: how tall each book may be inside its group
// ------------------------------------------------------------

function sizeGroup(group: Group, books: Map<string, ShelfBook>, placements: Map<string, Placement>, shelfHeight: number) {
  const run = (sh: number) => {
    const bookHeight: Record<string, number> = {}; // shelfHeight to draw each book with
    let used = 0;
    group.layers.forEach((layer, li) => {
      const available = shelfHeight - used - 2;
      let layerH = 0;
      for (const id of layer) {
        const book = books.get(id);
        if (!book) continue;
        const p = placements.get(id);
        let h = sh;
        if (p?.orientation !== "flat" && li > 0) {
          // Standing on something: shrink to fit under the shelf above
          h = Math.max(36, Math.min(sh, available / heightRatio(id, p)));
        }
        bookHeight[id] = h;
        const size = spineSize({ book, placement: p, shelfHeight: h });
        layerH = Math.max(layerH, p?.orientation === "flat" ? size.width + 1 : size.height);
      }
      used += layerH;
    });
    return { bookHeight, used };
  };

  const first = run(shelfHeight);
  if (first.used <= shelfHeight) return first.bookHeight;
  // Taller than the shelf (a big pile): scale the whole group down to fit
  return run(Math.max(40, shelfHeight * (shelfHeight / first.used))).bookHeight;
}

// ------------------------------------------------------------
// Pieces
// ------------------------------------------------------------

function RowTab({
  shelfId,
  depth,
  count,
  active,
  onClick,
}: {
  shelfId: string;
  depth: number;
  count: number | null; // null = "+ add a row"
  active: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tab:${shelfId}:${depth}`,
    data: { container: shelfId, depth, tab: true },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 h-6 px-2 rounded-full text-[10px] font-semibold tracking-wide uppercase whitespace-nowrap transition-colors ${focusRing} ${
        isOver
          ? "bg-[#e8c873] text-[#0f172a] scale-110"
          : active
            ? "bg-[#fdfaf3] text-[#0f172a]"
            : "bg-black/40 text-[#fdfaf3]/75 hover:bg-black/60"
      }`}
    >
      {count === null ? "+ Behind" : `${ROW_TABS[depth]} ${count}`}
    </button>
  );
}

function Row({
  shelfId,
  depth,
  groups,
  frontOf,
  interactive,
  faded,
  arranging,
  render,
}: {
  shelfId: string;
  depth: number;
  groups: Group[];
  frontOf: number; // how many rows are in front of this one
  interactive: boolean;
  faded: boolean;
  arranging: boolean;
  render: (group: Group) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `row:${shelfId}:${depth}`,
    data: { container: shelfId, depth },
    disabled: !interactive || !arranging,
  });

  return (
    <div
      ref={setNodeRef}
      data-row={`${shelfId}|${depth}`}
      inert={!interactive ? true : undefined}
      // Reaches up into the gap under the shelf above, so "on top of" works for tall books too
      className={`[grid-area:1/1] flex items-end gap-[2px] -mt-3 h-[calc(100%+0.75rem)] min-w-max pr-6 transition-[opacity,filter] duration-200 ${
        interactive ? "pointer-events-none [&_button]:pointer-events-auto" : "pointer-events-none"
      } ${faded ? "opacity-25" : ""} ${isOver ? "bg-[#7a947c]/20 rounded-md" : ""}`}
      style={{
        zIndex: MAX_ROWS - depth,
        transformOrigin: "bottom left",
        transform: frontOf > 0 ? `translateY(${-frontOf * 10}px) scale(${1 - frontOf * 0.05})` : undefined,
        filter: frontOf > 0 && !faded ? `brightness(${1 - frontOf * 0.18})` : undefined,
      }}
    >
      {groups.map((g) => render(g))}
    </div>
  );
}

// ------------------------------------------------------------
// Shelf
// ------------------------------------------------------------

export default function ShelfRow({
  shelfId,
  label,
  ids,
  books,
  placements,
  photos,
  usePhoto,
  shelfHeight,
  arranging,
  focusId,
  canRemove,
  onSelect,
  onRemoveShelf,
}: {
  shelfId: string;
  label: string;
  ids: string[];
  books: Map<string, ShelfBook>;
  placements: Map<string, Placement>;
  photos: Record<string, string>;
  usePhoto: boolean;
  shelfHeight: number;
  arranging: boolean;
  focusId: string | null;
  canRemove: boolean;
  onSelect: (bookId: string) => void;
  onRemoveShelf: () => void;
}) {
  const rows = useMemo(() => buildRows(ids, (id) => placements.get(id)), [ids, placements]);
  const [activeDepth, setActiveDepth] = useState(0);
  const [extraRows, setExtraRows] = useState(0);
  const shown = Math.min(MAX_ROWS, Math.max(usedRows(rows), extraRows, activeDepth + 1));

  const look = (id: string, sh: number): SpineLook | null => {
    const book = books.get(id);
    if (!book) return null;
    const placement = placements.get(id);
    return { book, placement, photo: placement?.spine_path ? photos[placement.spine_path] ?? null : null, usePhoto, shelfHeight: sh };
  };

  const renderGroup = (depth: number) => (group: Group) => {
    const heights = sizeGroup(group, books, placements, shelfHeight);
    const count = group.layers.reduce((n, l) => n + l.length, 0);
    return (
      <div
        key={`${depth}|${group.key}`}
        data-group={`${shelfId}|${depth}|${group.key}`}
        className={`relative shrink-0 flex flex-col-reverse items-center mx-[1px] rounded-md ${
          arranging && count > 1 ? "outline outline-2 outline-offset-2 outline-dashed outline-white/20" : ""
        }`}
      >
        {group.layers.map((layer, li) => (
          <div key={li} className="flex items-end gap-[1px]">
            {layer.map((id) => {
              const l = look(id, heights[id] ?? shelfHeight);
              const orientation = placements.get(id)?.orientation === "flat" ? "flat" : "upright";
              return l ? (
                <Spine
                  key={id}
                  look={l}
                  orientation={orientation}
                  container={shelfId}
                  arranging={arranging}
                  dimmed={!!focusId && focusId !== id}
                  onSelect={onSelect}
                />
              ) : null;
            })}
          </div>
        ))}
      </div>
    );
  };

  const total = ids.length;
  const activeEmpty = rows[activeDepth]?.length === 0;

  return (
    <div className="relative">
      {/* While arranging: this shelf's rows, name and remove button, in a strip of their own */}
      {arranging && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-[#241a11] border-b border-black/30">
          <span role="group" aria-label={`${label} rows`} className="flex flex-1 min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
            {Array.from({ length: shown }, (_, d) => (
              <RowTab
                key={d}
                shelfId={shelfId}
                depth={d}
                count={rows[d]?.reduce((n, g) => n + g.layers.flat().length, 0) ?? 0}
                active={d === activeDepth}
                onClick={() => setActiveDepth(d)}
              />
            ))}
            {shown < MAX_ROWS && (
              <RowTab
                shelfId={shelfId}
                depth={shown}
                count={null}
                active={false}
                onClick={() => {
                  setExtraRows(shown + 1);
                  setActiveDepth(shown);
                }}
              />
            )}
          </span>
          <span className="shrink-0 text-[10px] font-semibold tracking-wide uppercase text-[#fdfaf3]/55">{label}</span>
          {canRemove && (
            <button
              type="button"
              onClick={onRemoveShelf}
              aria-label={`Remove ${label}`}
              className={`shrink-0 w-6 h-6 rounded-full bg-black/35 text-[#fdfaf3]/80 text-sm leading-none hover:bg-[#c0675b] hover:text-white transition-colors ${focusRing}`}
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Back panel */}
      <div
        data-shelf-id={shelfId}
        role="group"
        aria-label={`${label}, ${total} ${total === 1 ? "book" : "books"}`}
        className="shelf-scroll relative overflow-x-auto overflow-y-hidden px-3 sm:px-4 pt-3 bg-[linear-gradient(180deg,#2b1f15_0%,#3b2a1c_18%,#4a3524_100%)]"
        style={{ height: shelfHeight + 12 }}
      >
        <div className="relative grid min-w-max h-full">
          {Array.from({ length: shown }, (_, d) => shown - 1 - d).map((depth) => {
            const interactive = arranging ? depth === activeDepth : true;
            // While arranging, every row but the one you're working on fades
            const faded = arranging && depth !== activeDepth;
            return (
              <Row
                key={depth}
                shelfId={shelfId}
                depth={depth}
                groups={rows[depth] ?? []}
                frontOf={depth}
                interactive={interactive}
                faded={faded}
                arranging={arranging}
                render={renderGroup(depth)}
              />
            );
          })}

          {total === 0 && !arranging && (
            <p className="[grid-area:1/1] self-center text-xs text-[#fdfaf3]/45 italic px-2 pointer-events-none">Empty shelf</p>
          )}
          {arranging && activeEmpty && (
            <p className="[grid-area:1/1] self-center text-xs text-[#fdfaf3]/55 italic px-2 pointer-events-none" style={{ zIndex: 10 }}>
              {activeDepth === 0 ? "Drag books here" : `Drag books here to put them in the ${ROW_TABS[activeDepth].toLowerCase()} row`}
            </p>
          )}
        </div>

        {/* Shadow cast by the shelf above */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/35 to-transparent z-10" />
      </div>

      {/* Shelf board */}
      <div
        aria-hidden="true"
        className="relative h-3.5 sm:h-4 bg-[linear-gradient(180deg,#c9a274_0%,#a8814f_55%,#7d5c37_100%)] shadow-[0_6px_10px_rgba(15,23,42,0.25)]"
      />

    </div>
  );
}
