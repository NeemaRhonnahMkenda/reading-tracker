// src/app/shelves/_components/BookcaseView.tsx
// A wooden bookcase: name plate on top, shelves inside a frame.

"use client";

import { focusRing } from "../../components/ui/Button";
import type { Bookcase, Layout, Placement, Shelf, ShelfBook } from "../_lib/shelves";
import ShelfRow from "./ShelfRow";

export default function BookcaseView({
  bookcase,
  shelves,
  layout,
  books,
  placements,
  photos,
  usePhoto,
  shelfHeight,
  arranging,
  focusId,
  onSelect,
  onRename,
  onAddShelf,
  onRemoveShelf,
  onDelete,
  onScan,
}: {
  bookcase: Bookcase;
  shelves: Shelf[];
  layout: Layout;
  books: Map<string, ShelfBook>;
  placements: Map<string, Placement>;
  photos: Record<string, string>;
  usePhoto: boolean;
  shelfHeight: number;
  arranging: boolean;
  focusId: string | null;
  onSelect: (bookId: string) => void;
  onRename: () => void;
  onAddShelf: () => void;
  onRemoveShelf: (shelfId: string) => void;
  onDelete: () => void;
  onScan: (shelfId: string) => void;
}) {
  const total = shelves.reduce((sum, s) => sum + (layout[s.id]?.length ?? 0), 0);
  const smallBtn = `h-9 px-3.5 rounded-full text-xs font-medium border transition-colors ${focusRing}`;

  return (
    <section aria-labelledby={`case-${bookcase.id}`} className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-3 px-1">
        <div className="min-w-0">
          <h2 id={`case-${bookcase.id}`} className="font-classical text-2xl sm:text-[1.7rem] font-semibold text-[#0f172a] leading-tight break-words">
            {bookcase.name}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {shelves.length} {shelves.length === 1 ? "shelf" : "shelves"} · {total} {total === 1 ? "book" : "books"}
          </p>
        </div>

        {arranging ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onRename} className={`${smallBtn} bg-white border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c]`}>
              Rename
            </button>
            <button
              type="button"
              onClick={onAddShelf}
              disabled={shelves.length >= 12}
              className={`${smallBtn} bg-white border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c] disabled:opacity-40`}
            >
              + Shelf
            </button>
            <button type="button" onClick={onDelete} className={`${smallBtn} bg-white border-[#0f172a]/10 text-slate-500 hover:border-[#c0675b] hover:text-[#a14e43]`}>
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => shelves[0] && onScan(shelves[0].id)}
            className={`${smallBtn} bg-white/80 border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c] hover:text-[#0f172a] inline-flex items-center gap-1.5`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Scan a shelf
          </button>
        )}
      </div>

      {/* Frame */}
      <div className="rounded-[14px] p-2.5 sm:p-3 bg-[linear-gradient(135deg,#9b7448_0%,#7d5a35_45%,#6a4a2b_100%)] shadow-[0_24px_50px_rgba(15,23,42,0.22),inset_0_1px_0_rgba(255,255,255,0.25)]">
        <div className="rounded-[8px] overflow-hidden ring-1 ring-black/30 space-y-0">
          {shelves.map((shelf) => (
            <ShelfRow
              key={shelf.id}
              shelfId={shelf.id}
              label={shelf.label || `Shelf ${shelf.position + 1}`}
              ids={layout[shelf.id] ?? []}
              books={books}
              placements={placements}
              photos={photos}
              usePhoto={usePhoto}
              shelfHeight={shelfHeight}
              arranging={arranging}
              focusId={focusId}
              canRemove={shelves.length > 1}
              onSelect={onSelect}
              onRemoveShelf={() => onRemoveShelf(shelf.id)}
            />
          ))}
        </div>
        {/* Plinth */}
        <div aria-hidden="true" className="mx-2 mt-2 h-2 rounded-b-md bg-black/20" />
      </div>
    </section>
  );
}
