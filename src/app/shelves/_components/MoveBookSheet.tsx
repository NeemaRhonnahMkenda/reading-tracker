// src/app/shelves/_components/MoveBookSheet.tsx
// Put a book somewhere exact without dragging: which bookcase, which shelf,
// next to which book, standing or lying flat. Works well on phones and with
// a keyboard or screen reader.

"use client";

import { useEffect, useMemo, useState } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import { TRAY, type Bookcase, type Layout, type Orientation, type Shelf, type ShelfBook } from "../_lib/shelves";

export interface MoveRequest {
  bookId: string;
  shelfId: string | null; // null = take off the shelf
  index: number;
  orientation: Orientation;
}

const selectClass = `w-full h-12 sm:h-11 pl-4 pr-10 rounded-xl bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 appearance-none bg-no-repeat bg-[right_0.9rem_center] bg-[url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")] focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10`;
const labelClass = "block text-xs font-medium text-slate-500 mb-1.5";

export default function MoveBookSheet({
  book,
  currentShelfId,
  orientation,
  bookcases,
  shelves,
  layout,
  books,
  saving,
  onClose,
  onSave,
}: {
  book: ShelfBook | null;
  currentShelfId: string | null;
  orientation: Orientation;
  bookcases: Bookcase[];
  shelves: Shelf[];
  layout: Layout;
  books: Map<string, ShelfBook>;
  saving: boolean;
  onClose: () => void;
  onSave: (move: MoveRequest) => void;
}) {
  const open = !!book;
  const [caseId, setCaseId] = useState("");
  const [shelfId, setShelfId] = useState("");
  const [after, setAfter] = useState("end");
  const [orient, setOrient] = useState<Orientation>("upright");

  const shelvesByCase = useMemo(() => {
    const map = new Map<string, Shelf[]>();
    shelves.forEach((s) => map.set(s.bookcase_id, [...(map.get(s.bookcase_id) ?? []), s]));
    map.forEach((list) => list.sort((a, b) => a.position - b.position));
    return map;
  }, [shelves]);

  // Start from where the book is now (or the first shelf)
  useEffect(() => {
    if (!book) return;
    const current = shelves.find((s) => s.id === currentShelfId);
    const startCase = current?.bookcase_id ?? bookcases[0]?.id ?? "";
    setCaseId(startCase);
    setShelfId(current?.id ?? shelvesByCase.get(startCase)?.[0]?.id ?? "");
    setOrient(orientation);
    if (current) {
      const ids = layout[current.id] ?? [];
      const i = ids.indexOf(book.id);
      setAfter(i <= 0 ? "start" : ids[i - 1]);
    } else {
      setAfter("end");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  const caseShelves = shelvesByCase.get(caseId) ?? [];
  const neighbours = (layout[shelfId] ?? []).filter((id) => id !== book?.id);

  function changeCase(id: string) {
    setCaseId(id);
    setShelfId(shelvesByCase.get(id)?.[0]?.id ?? "");
    setAfter("end");
  }

  function save() {
    if (!book || !shelfId) return;
    const index = after === "start" ? 0 : after === "end" ? neighbours.length : neighbours.indexOf(after) + 1;
    onSave({ bookId: book.id, shelfId, index: Math.max(0, index), orientation: orient });
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="move-title" size="md" dismissible={!saving}>
      {book && (
        <>
          <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
            <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
            <ModalHeader
              id="move-title"
              title={currentShelfId && currentShelfId !== TRAY ? "Move this book" : "Place this book"}
              description={`${book.title}${book.author ? ` by ${book.author}` : ""}`}
              onClose={onClose}
              disabled={saving}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-6 space-y-5">
            {bookcases.length === 0 ? (
              <p className="text-sm text-slate-500">Create a bookcase first, then you can place books on it.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                  <label className="block min-w-0">
                    <span className={labelClass}>Bookcase</span>
                    <select value={caseId} onChange={(e) => changeCase(e.target.value)} className={selectClass}>
                      {bookcases.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block min-w-0">
                    <span className={labelClass}>Shelf</span>
                    <select
                      value={shelfId}
                      onChange={(e) => {
                        setShelfId(e.target.value);
                        setAfter("end");
                      }}
                      className={selectClass}
                    >
                      {caseShelves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label || `Shelf ${s.position + 1}`}
                          {s.position === 0 ? " (top)" : s.position === caseShelves.length - 1 ? " (bottom)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className={labelClass}>Position</span>
                  <select value={after} onChange={(e) => setAfter(e.target.value)} className={selectClass}>
                    <option value="start">At the left end</option>
                    {neighbours.map((id) => (
                      <option key={id} value={id}>After {books.get(id)?.title ?? "a book"}</option>
                    ))}
                    <option value="end">At the right end</option>
                  </select>
                </label>

                <fieldset>
                  <legend className={labelClass}>How it sits</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: "upright", label: "Standing", hint: "Spine out" },
                        { value: "flat", label: "Lying flat", hint: "In a pile" },
                      ] as const
                    ).map((o) => {
                      const checked = orient === o.value;
                      return (
                        <label
                          key={o.value}
                          className={`cursor-pointer rounded-2xl border px-3 py-3 text-center transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#7a947c] ${
                            checked ? "border-[#0f172a] bg-[#0f172a] text-[#fdfaf3]" : "border-[#0f172a]/10 bg-white text-slate-600 hover:border-[#7a947c]"
                          }`}
                        >
                          <input type="radio" name="orientation" value={o.value} checked={checked} onChange={() => setOrient(o.value)} className="sr-only" />
                          <span className="block text-sm font-medium">{o.label}</span>
                          <span className={`block text-xs mt-0.5 ${checked ? "text-[#fdfaf3]/60" : "text-slate-400"}`}>{o.hint}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </>
            )}
          </div>

          <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row sm:items-center gap-2.5">
            {currentShelfId && currentShelfId !== TRAY && (
              <button
                type="button"
                onClick={() => onSave({ bookId: book.id, shelfId: null, index: 0, orientation: orient })}
                disabled={saving}
                className={`sm:mr-auto h-11 px-4 rounded-full text-sm text-slate-500 hover:text-[#a14e43] hover:bg-[#f7e9e6] transition-colors disabled:opacity-40 ${focusRing}`}
              >
                Take off shelf
              </button>
            )}
            <Button variant="outline" onClick={onClose} disabled={saving} className={currentShelfId && currentShelfId !== TRAY ? "" : "sm:ml-auto"}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={!shelfId}>
              {saving ? "Saving…" : "Put it here"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
