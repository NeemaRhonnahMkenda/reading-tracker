// src/app/shelves/_components/ShelfRow.tsx
// One shelf: books stand left to right; books lying flat stack into piles.
// Scrolls sideways when a shelf is fuller than the screen is wide.

"use client";

import { useDroppable } from "@dnd-kit/core";
import { focusRing } from "../../components/ui/Button";
import type { Placement, ShelfBook } from "../_lib/shelves";
import Spine, { type SpineLook } from "./Spine";

type Group = { kind: "upright"; id: string } | { kind: "pile"; ids: string[] };

// Neighbouring flat books become one pile (listed bottom to top)
function groupBooks(ids: string[], placements: Map<string, Placement>): Group[] {
  const groups: Group[] = [];
  for (const id of ids) {
    const flat = placements.get(id)?.orientation === "flat";
    const last = groups[groups.length - 1];
    if (flat && last?.kind === "pile") last.ids.push(id);
    else if (flat) groups.push({ kind: "pile", ids: [id] });
    else groups.push({ kind: "upright", id });
  }
  return groups;
}

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
  const { setNodeRef, isOver } = useDroppable({ id: shelfId, data: { container: shelfId } });

  const look = (id: string): SpineLook | null => {
    const book = books.get(id);
    if (!book) return null;
    const placement = placements.get(id);
    return { book, placement, photo: placement?.spine_path ? photos[placement.spine_path] ?? null : null, usePhoto, shelfHeight };
  };

  return (
    <div className="relative">
      {/* Back panel */}
      <div
        ref={setNodeRef}
        data-shelf-id={shelfId}
        aria-label={`${label}, ${ids.length} ${ids.length === 1 ? "book" : "books"}`}
        role="group"
        className={`shelf-scroll relative overflow-x-auto overflow-y-hidden px-3 sm:px-4 pt-3 transition-colors ${
          isOver ? "bg-[#7a947c]/25" : "bg-[linear-gradient(180deg,#2b1f15_0%,#3b2a1c_18%,#4a3524_100%)]"
        }`}
        style={{ height: shelfHeight + 12 }}
      >
        <div className="flex items-end gap-[2px] h-full min-w-max pr-6">
          {ids.length === 0 && (
            <p className="self-center text-xs text-[#fdfaf3]/45 italic px-2">
              {arranging ? "Drag books here" : "Empty shelf"}
            </p>
          )}

          {groupBooks(ids, placements).map((group) => {
            if (group.kind === "upright") {
              const l = look(group.id);
              return l ? (
                <Spine
                  key={group.id}
                  look={l}
                  orientation="upright"
                  container={shelfId}
                  arranging={arranging}
                  dimmed={!!focusId && focusId !== group.id}
                  onSelect={onSelect}
                />
              ) : null;
            }
            return (
              <div key={group.ids[0]} className="flex flex-col-reverse items-start gap-[1px] mx-[3px]">
                {group.ids.map((id) => {
                  const l = look(id);
                  return l ? (
                    <Spine
                      key={id}
                      look={l}
                      orientation="flat"
                      container={shelfId}
                      arranging={arranging}
                      dimmed={!!focusId && focusId !== id}
                      onSelect={onSelect}
                    />
                  ) : null;
                })}
              </div>
            );
          })}
        </div>

        {/* Shadow cast by the shelf above */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/35 to-transparent" />
      </div>

      {/* Shelf board */}
      <div
        aria-hidden="true"
        className="relative h-3.5 sm:h-4 bg-[linear-gradient(180deg,#c9a274_0%,#a8814f_55%,#7d5c37_100%)] shadow-[0_6px_10px_rgba(15,23,42,0.25)]"
      />

      {arranging && (
        <div className="absolute top-1.5 left-2 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-wide uppercase text-[#fdfaf3]/60 bg-black/30 rounded-full px-2 py-0.5">{label}</span>
          {canRemove && (
            <button
              type="button"
              onClick={onRemoveShelf}
              aria-label={`Remove ${label}`}
              className={`w-6 h-6 rounded-full bg-black/35 text-[#fdfaf3]/80 text-sm leading-none hover:bg-[#c0675b] hover:text-white transition-colors ${focusRing}`}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
