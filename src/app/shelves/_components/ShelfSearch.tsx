// src/app/shelves/_components/ShelfSearch.tsx
// "Where's my copy of…?" Type a title or author; picking a result runs the
// find animation, or offers to place the book if it isn't on a shelf.

"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { ShelfBook } from "../_lib/shelves";

export interface SearchLocation {
  shelved: boolean;
  text: string; // "Living room · Shelf 2" or "Not on a shelf"
}

export default function ShelfSearch({
  books,
  locate,
  onPick,
}: {
  books: ShelfBook[];
  locate: (bookId: string) => SearchLocation;
  onPick: (bookId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return books
      .map((b) => {
        const title = b.title.toLowerCase();
        const author = (b.author ?? "").toLowerCase();
        const rank = title.startsWith(term) ? 0 : title.includes(term) ? 1 : author.includes(term) ? 2 : -1;
        return { b, rank };
      })
      .filter((r) => r.rank >= 0)
      .sort((a, z) => a.rank - z.rank || a.b.title.localeCompare(z.b.title))
      .slice(0, 8)
      .map((r) => r.b);
  }, [books, query]);

  function pick(id: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    onPick(id);
  }

  const showList = open && query.trim().length > 0;

  return (
    <div className="relative w-full sm:max-w-sm">
      <label htmlFor="shelf-find" className="sr-only">Find a book on your shelves</label>
      <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        id="shelf-find"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={query}
        placeholder="Where's my copy of…"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showList || results.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[active].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full h-12 pl-11 pr-4 rounded-full bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 placeholder:text-slate-400 shadow-sm focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 left-0 right-0 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl bg-white border border-[#0f172a]/10 shadow-[0_20px_50px_rgba(15,23,42,0.15)] p-1.5"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-500">No books match &ldquo;{query.trim()}&rdquo;.</li>
          ) : (
            results.map((b, i) => {
              const loc = locate(b.id);
              return (
                <li
                  key={b.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(b.id)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer ${i === active ? "bg-[#f3eee3]" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 shrink-0 rounded-full ${loc.shelved ? "bg-[#c69a3d]" : "bg-[#0f172a]/15"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-classical font-semibold text-[#0f172a] truncate">{b.title}</span>
                    <span className="block text-xs text-slate-500 truncate">
                      {b.author ? `${b.author} · ` : ""}
                      <span className={loc.shelved ? "text-[#8a6a22]" : "text-slate-400"}>{loc.text}</span>
                    </span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
