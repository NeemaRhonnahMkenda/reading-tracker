// src/app/shelves/_components/MoveBookSheet.tsx
// Put a book exactly where it is in real life, without dragging:
//   shelf → row (front, second, back) → on its own, or with another book
//   (on top of it, underneath it, to its left or right) → standing or lying flat.
// Every arrangement the shelf can show can be built from here.

"use client";

import { useEffect, useMemo, useState } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import { TRAY, type Bookcase, type Layout, type Orientation, type Placement, type Shelf, type ShelfBook } from "../_lib/shelves";
import { MAX_ROWS, ROW_NAMES, buildRows, locate, removeBook, targetFromRelation, type Relation, type Target } from "../_lib/arrange";

export interface MoveRequest {
  bookId: string;
  shelfId: string | null; // null = take off the shelf
  target: Target;
  orientation: Orientation;
}

type Mode = "alone" | "with";

const selectClass = `w-full h-12 sm:h-11 pl-4 pr-10 rounded-xl bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 appearance-none bg-no-repeat bg-[right_0.9rem_center] bg-[url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")] focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10`;
const labelClass = "block text-xs font-medium text-slate-500 mb-1.5";

const RELATIONS: { value: Relation; label: string; icon: string }[] = [
  { value: "onTop", label: "On top", icon: "▲" },
  { value: "under", label: "Underneath", icon: "▼" },
  { value: "left", label: "Left of", icon: "◀" },
  { value: "right", label: "Right of", icon: "▶" },
];

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div role="radiogroup" aria-label={label} className="grid gap-1 p-1 rounded-2xl bg-[#0f172a]/[0.05]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`min-h-10 px-2 rounded-xl text-sm font-medium transition-all disabled:opacity-35 ${focusRing} ${
              value === o.value ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MoveBookSheet({
  book,
  currentShelfId,
  placements,
  bookcases,
  shelves,
  layout,
  books,
  saving,
  onClose,
  onSave,
  onEditLook,
}: {
  book: ShelfBook | null;
  currentShelfId: string | null;
  placements: Map<string, Placement>;
  bookcases: Bookcase[];
  shelves: Shelf[];
  layout: Layout;
  books: Map<string, ShelfBook>;
  saving: boolean;
  onClose: () => void;
  onSave: (move: MoveRequest) => void;
  onEditLook: (bookId: string) => void;
}) {
  const open = !!book;
  const [caseId, setCaseId] = useState("");
  const [shelfId, setShelfId] = useState("");
  const [depth, setDepth] = useState(0);
  const [mode, setMode] = useState<Mode>("alone");
  const [after, setAfter] = useState("end"); // "start" | "end" | group key
  const [anchor, setAnchor] = useState("");
  const [relation, setRelation] = useState<Relation>("onTop");
  const [orientation, setOrientation] = useState<Orientation>("upright");

  const get = (id: string) => placements.get(id);

  const shelvesByCase = useMemo(() => {
    const map = new Map<string, Shelf[]>();
    shelves.forEach((s) => map.set(s.bookcase_id, [...(map.get(s.bookcase_id) ?? []), s]));
    map.forEach((list) => list.sort((a, b) => a.position - b.position));
    return map;
  }, [shelves]);

  // The chosen shelf as it would be without this book
  const rows = useMemo(
    () => (book && shelfId ? removeBook(buildRows(layout[shelfId] ?? [], get), book.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, shelfId, book?.id, placements]
  );
  const groups = rows[depth] ?? [];
  const rowBooks = groups.flatMap((g) => g.layers.flat());

  // ---------- Start from where and how the book is now ----------
  useEffect(() => {
    if (!book) return;
    const current = shelves.find((s) => s.id === currentShelfId);
    const startCase = current?.bookcase_id ?? bookcases[0]?.id ?? "";
    setCaseId(startCase);
    setShelfId(current?.id ?? shelvesByCase.get(startCase)?.[0]?.id ?? "");
    setOrientation(placements.get(book.id)?.orientation === "flat" ? "flat" : "upright");

    const full = current ? buildRows(layout[current.id] ?? [], get) : null;
    const at = full ? locate(full, book.id) : null;
    setDepth(at?.depth ?? 0);

    if (at && at.group.layers.flat().length > 1) {
      // Describe its spot relative to a neighbour in the same group
      const layer = at.group.layers[at.li];
      setMode("with");
      if (at.li > 0) {
        setAnchor(at.group.layers[at.li - 1][0]);
        setRelation("onTop");
      } else if (layer.length > 1) {
        const leftNeighbour = layer[at.bi - 1];
        setAnchor(leftNeighbour ?? layer[at.bi + 1]);
        setRelation(leftNeighbour ? "right" : "left");
      } else {
        setAnchor(at.group.layers[1][0]);
        setRelation("under");
      }
    } else {
      setMode("alone");
      setAnchor("");
      setRelation("onTop");
      const before = at && at.gi > 0 ? at.groups[at.gi - 1].key : null;
      setAfter(at ? (before ?? "start") : "end");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  // Keep choices valid as the shelf or row changes
  useEffect(() => {
    if (mode === "with" && !rowBooks.includes(anchor)) {
      if (rowBooks[0]) setAnchor(rowBooks[0]);
      else setMode("alone");
    }
    if (mode === "alone" && after !== "start" && after !== "end" && !groups.some((g) => g.key === after)) setAfter("end");
  }, [mode, anchor, after, rowBooks, groups]);

  if (!book) return <Modal open={false} onClose={onClose} labelledBy="move-title">{null}</Modal>;

  const caseShelves = shelvesByCase.get(caseId) ?? [];
  const onShelf = !!currentShelfId && currentShelfId !== TRAY;
  const usedDepths = rows.reduce((n, g, d) => (g.length ? d + 1 : n), 0);
  const depthOptions = Array.from({ length: MAX_ROWS }, (_, d) => ({
    value: d,
    label: `${ROW_NAMES[d].replace(" row", "")}${rows[d]?.length ? ` · ${rows[d].flatMap((g) => g.layers.flat()).length}` : ""}`,
    disabled: d > usedDepths, // one new row at a time
  }));

  const title = (id: string) => books.get(id)?.title ?? "a book";
  const groupLabel = (key: string) => {
    const g = groups.find((x) => x.key === key);
    if (!g) return "";
    const ids = g.layers.flat();
    return ids.length > 1 ? `${title(g.layers[0][0])} + ${ids.length - 1} more` : title(ids[0]);
  };
  const anchorLabel = (id: string) => {
    const at = locate(rows, id);
    if (!at) return title(id);
    const where = at.group.layers.length > 1 ? (at.li === 0 ? " (bottom of a stack)" : at.li === at.group.layers.length - 1 ? " (top of a stack)" : ` (layer ${at.li + 1})`) : "";
    const flat = placements.get(id)?.orientation === "flat" ? ", lying flat" : "";
    return `${title(id)}${where}${flat}`;
  };

  function changeCase(id: string) {
    setCaseId(id);
    setShelfId(shelvesByCase.get(id)?.[0]?.id ?? "");
    setDepth(0);
    setAfter("end");
  }

  function save() {
    if (!book || !shelfId) return;
    let target: Target | null;
    if (mode === "with" && anchor) {
      target = targetFromRelation(rows, anchor, relation);
    } else {
      const index = after === "start" ? 0 : after === "end" ? groups.length : groups.findIndex((g) => g.key === after) + 1;
      target = { kind: "alone", depth, index };
    }
    if (target) onSave({ bookId: book.id, shelfId, target, orientation });
  }

  // Sentence that says what will happen
  const summary =
    mode === "with" && anchor
      ? `${orientation === "flat" ? "Lying flat" : "Standing"} ${
          { onTop: "on top of", under: "underneath", left: "to the left of", right: "to the right of" }[relation]
        } ${title(anchor)}`
      : `${orientation === "flat" ? "Lying flat" : "Standing"} on its own${
          after === "start" ? " at the left end" : after === "end" ? " at the right end" : `, after ${groupLabel(after)}`
        }`;

  return (
    <Modal open={open} onClose={onClose} labelledBy="move-title" size="md" dismissible={!saving}>
      <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <ModalHeader
          id="move-title"
          title={onShelf ? "Move this book" : "Place this book"}
          description={`${book.title}${book.author ? ` by ${book.author}` : ""}`}
          onClose={onClose}
          disabled={saving}
        />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 py-6 space-y-5">
        {bookcases.length === 0 ? (
          <p className="text-sm text-slate-500">Create a bookcase first, then you can place books on it.</p>
        ) : (
          <>
            {/* Where */}
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
                    setDepth(0);
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

            <Segmented<number> label="Row (front to back)" value={depth} options={depthOptions} onChange={(d) => setDepth(d)} />

            {/* With what */}
            <Segmented<Mode>
              label="Placement"
              value={mode}
              options={[
                { value: "alone", label: "On its own" },
                { value: "with", label: "With another book", disabled: rowBooks.length === 0 },
              ]}
              onChange={(m) => {
                setMode(m);
                if (m === "with" && !rowBooks.includes(anchor) && rowBooks[0]) setAnchor(rowBooks[0]);
              }}
            />

            {mode === "alone" ? (
              <label className="block">
                <span className={labelClass}>Position in the row</span>
                <select value={after} onChange={(e) => setAfter(e.target.value)} className={selectClass}>
                  <option value="start">At the left end</option>
                  {groups.map((g) => (
                    <option key={g.key} value={g.key}>After {groupLabel(g.key)}</option>
                  ))}
                  <option value="end">At the right end</option>
                </select>
              </label>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <span className={labelClass}>Next to which book</span>
                  <select value={anchor} onChange={(e) => setAnchor(e.target.value)} className={selectClass}>
                    {groups.map((g) => (
                      <optgroup key={g.key} label={g.layers.flat().length > 1 ? `Stack: ${groupLabel(g.key)}` : "On its own"}>
                        {[...g.layers].reverse().flat().map((id) => (
                          <option key={id} value={id}>{anchorLabel(id)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <div>
                  <p className={labelClass}>Where, compared to it</p>
                  <div role="radiogroup" aria-label="Where, compared to it" className="grid grid-cols-2 min-[420px]:grid-cols-4 gap-2">
                    {RELATIONS.map((r) => {
                      const checked = relation === r.value;
                      return (
                        <button
                          key={r.value}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          onClick={() => setRelation(r.value)}
                          className={`rounded-2xl border px-2 py-2.5 text-center transition-all ${focusRing} ${
                            checked ? "border-[#0f172a] bg-[#0f172a] text-[#fdfaf3]" : "border-[#0f172a]/10 bg-white text-slate-600 hover:border-[#7a947c]"
                          }`}
                        >
                          <span aria-hidden="true" className={`block text-xs ${checked ? "text-[#e8c873]" : "text-[#7a947c]"}`}>{r.icon}</span>
                          <span className="block text-sm font-medium">{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <Segmented<Orientation>
              label="How it sits"
              value={orientation}
              options={[
                { value: "upright", label: "Standing" },
                { value: "flat", label: "Lying flat" },
              ]}
              onChange={setOrientation}
            />

            <p className="rounded-xl bg-[#fbf6ea] border border-[#c69a3d]/20 px-3.5 py-2.5 text-sm text-[#5b4718]" aria-live="polite">
              {summary}, in the {ROW_NAMES[depth].toLowerCase()}.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={() => onEditLook(book.id)}
          disabled={saving}
          className={`w-full flex items-center gap-3 rounded-2xl border border-[#0f172a]/10 bg-white px-4 py-3 text-left hover:border-[#c69a3d] transition-colors ${focusRing}`}
        >
          <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-[#fbf6ea] text-[#8a6a22] flex items-center justify-center">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-[#0f172a]">Edit spine look</span>
            <span className="block text-xs text-slate-500">Photo, colour, lettering, size</span>
          </span>
          <span aria-hidden="true" className="text-slate-300">→</span>
        </button>
      </div>

      <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row sm:items-center gap-2.5">
        {onShelf && (
          <button
            type="button"
            onClick={() => onSave({ bookId: book.id, shelfId: null, target: { kind: "tray" }, orientation: "upright" })}
            disabled={saving}
            className={`sm:mr-auto h-11 px-4 rounded-full text-sm text-slate-500 hover:text-[#a14e43] hover:bg-[#f7e9e6] transition-colors disabled:opacity-40 ${focusRing}`}
          >
            Take off shelf
          </button>
        )}
        <Button variant="outline" onClick={onClose} disabled={saving} className={onShelf ? "" : "sm:ml-auto"}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving} disabled={!shelfId || (mode === "with" && !anchor)}>
          {saving ? "Saving…" : "Put it here"}
        </Button>
      </div>
    </Modal>
  );
}
