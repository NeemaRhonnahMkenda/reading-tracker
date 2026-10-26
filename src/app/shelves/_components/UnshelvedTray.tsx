// src/app/shelves/_components/UnshelvedTray.tsx
// Books that aren't on any shelf yet. In arrange mode, drag them onto a shelf
// (or tap one to choose where it goes); drag a book here to take it off a shelf.

"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { TRAY, type Placement, type ShelfBook } from "../_lib/shelves";
import Spine from "./Spine";

const TRAY_HEIGHT = 118;
const PREVIEW = 60;

export default function UnshelvedTray({
  ids,
  books,
  placements,
  photos,
  usePhoto,
  arranging,
  onSelect,
  onStartArranging,
}: {
  ids: string[];
  books: Map<string, ShelfBook>;
  placements: Map<string, Placement>;
  photos: Record<string, string>;
  usePhoto: boolean;
  arranging: boolean;
  onSelect: (bookId: string) => void;
  onStartArranging: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY, data: { container: TRAY } });
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return ids;
    return ids.filter((id) => {
      const b = books.get(id);
      return b && (b.title.toLowerCase().includes(term) || (b.author ?? "").toLowerCase().includes(term));
    });
  }, [ids, books, query]);

  const visible = showAll || query ? filtered : filtered.slice(0, PREVIEW);

  if (!arranging) {
    if (ids.length === 0) return null;
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl bg-[#f7f5fa] border border-[#9a86b9]/20 px-4 sm:px-5 py-3.5">
        <p className="flex-1 text-sm text-[#6c5c85]">
          <span className="font-semibold">{ids.length}</span> {ids.length === 1 ? "book isn't" : "books aren't"} on a shelf yet.
        </p>
        <button
          type="button"
          onClick={onStartArranging}
          className="self-start sm:self-auto text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a]"
        >
          Place them
        </button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="tray-title"
      className={`rounded-[1.4rem] border p-4 sm:p-5 transition-colors ${
        isOver ? "border-[#7a947c] bg-[#eef3ee]" : "border-[#0f172a]/[0.07] bg-white/75 backdrop-blur"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 id="tray-title" className="font-classical text-xl font-semibold text-[#0f172a]">
            Not on a shelf
            <span className="ml-2 align-middle text-xs font-sans font-semibold text-slate-500 bg-[#0f172a]/[0.06] rounded-full px-2 py-0.5">{ids.length}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Drag onto a shelf, or tap a book to choose where it goes.</p>
        </div>
        {ids.length > 8 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a book"
            aria-label="Filter books not on a shelf"
            className="w-full sm:w-56 h-10 px-4 rounded-full bg-white border border-[#0f172a]/10 text-base sm:text-sm placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10"
          />
        )}
      </div>

      <div
        ref={setNodeRef}
        className="flex flex-wrap items-end gap-[3px] min-h-[132px] rounded-xl bg-[#f3eee3] p-3 shadow-[inset_0_2px_6px_rgba(15,23,42,0.08)]"
      >
        {visible.length === 0 ? (
          <p className="m-auto text-sm text-slate-500 font-light">
            {ids.length === 0 ? "Every book has a home. Drag one here to take it off its shelf." : "No books match."}
          </p>
        ) : (
          visible.map((id) => {
            const book = books.get(id);
            if (!book) return null;
            const placement = placements.get(id);
            return (
              <Spine
                key={id}
                look={{ book, placement, photo: placement?.spine_path ? photos[placement.spine_path] ?? null : null, usePhoto, shelfHeight: TRAY_HEIGHT }}
                orientation="upright"
                container={TRAY}
                arranging
                dimmed={false}
                onSelect={onSelect}
              />
            );
          })
        )}
      </div>

      {!showAll && !query && filtered.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a]"
        >
          Show all {filtered.length}
        </button>
      )}
    </section>
  );
}
