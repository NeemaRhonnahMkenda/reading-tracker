// src/app/library/_components/LibraryBookItem.tsx
// One book as a grid card or a list row.

"use client";

import Link from "next/link";
import { focusRing } from "../../components/ui/Button";
import type { ShelfView } from "../../reading/_components/ViewToggle";
import { formatAdded, type Book } from "../_lib/library";
import BookCover from "./BookCover";
import StatusPill from "./StatusPill";

export default function LibraryBookItem({
  book,
  cover,
  view,
  eager,
  highlighted,
  onOpen,
}: {
  book: Book;
  cover: string | null;
  view: ShelfView;
  eager: boolean;
  highlighted: boolean;
  onOpen: (bookId: string) => void;
}) {
  const glow = highlighted ? "ring-2 ring-[#7a947c] ring-offset-4 ring-offset-[#fdfaf3] animate-return-glow" : "";
  const details = [book.binding, book.bought_from, book.pages ? `${book.pages} pages` : null].filter(Boolean) as string[];

  // ---------- List row ----------
  if (view === "list") {
    return (
      <Link
        href={`/library/${book.id}`}
        prefetch={false}
        data-book-id={book.id}
        onClick={() => onOpen(book.id)}
        className={`group flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 pr-3 sm:pr-5 rounded-2xl bg-white/75 border border-[#0f172a]/[0.06] hover:bg-white hover:border-[#0f172a]/10 hover:shadow-[0_10px_30px_rgba(15,23,42,0.07)] transition-all scroll-mt-40 ${glow} ${focusRing}`}
      >
        <div className="relative w-12 sm:w-14 aspect-[2/3] shrink-0 rounded-md overflow-hidden shadow-sm ring-1 ring-[#0f172a]/10">
          <BookCover src={cover} title={book.title} size="sm" eager={eager} />
        </div>

        <div className="flex-1 min-w-0 md:grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center md:gap-6">
          <div className="min-w-0">
            <p className="font-classical text-[15px] sm:text-base font-semibold text-[#0f172a] leading-snug line-clamp-1">{book.title}</p>
            {book.author && <p className="text-xs sm:text-sm text-slate-500 truncate">{book.author}</p>}
          </div>

          {/* Details sit under the title on phones, in their own column from tablet up */}
          <p className="mt-1 md:mt-0 text-xs text-slate-400 truncate">
            {details.length ? details.join(" · ") : `Added ${formatAdded(book)}`}
          </p>

          <div className="mt-2 md:mt-0 flex items-center gap-2 md:justify-end">
            <StatusPill status={book.status} short />
            {details.length > 0 && <span className="hidden lg:inline text-xs text-slate-400 whitespace-nowrap">{formatAdded(book)}</span>}
          </div>
        </div>

        <span aria-hidden="true" className="hidden sm:inline text-slate-300 group-hover:text-[#7a947c] group-hover:translate-x-0.5 transition-all">
          →
        </span>
      </Link>
    );
  }

  // ---------- Grid card ----------
  return (
    <Link
      href={`/library/${book.id}`}
      prefetch={false}
      data-book-id={book.id}
      onClick={() => onOpen(book.id)}
      className={`group block rounded-xl scroll-mt-40 ${focusRing}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "340px" }}
    >
      <div
        className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-[#e9e4d9] ring-1 ring-[#0f172a]/10 shadow-[0_10px_25px_rgba(15,23,42,0.12)] group-hover:shadow-[0_18px_40px_rgba(15,23,42,0.18)] group-hover:-translate-y-1 transition-all duration-300 ${glow}`}
      >
        <BookCover src={cover} title={book.title} author={book.author} eager={eager} />
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/20 to-transparent" />
        {book.custom_cover_path && (
          <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-[#fdfaf3]/90 text-[#4a5c4b] flex items-center justify-center shadow-sm" title="Your own cover photo">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="sr-only">Your own cover photo</span>
          </span>
        )}
      </div>

      <div className="mt-3 px-0.5">
        <h3 className="font-classical font-semibold text-[15px] sm:text-base text-[#0f172a] leading-tight line-clamp-2">{book.title}</h3>
        {book.author && <p className="text-xs sm:text-sm text-slate-500 mt-0.5 line-clamp-1">{book.author}</p>}
        <div className="mt-2">
          <StatusPill status={book.status} short />
        </div>
      </div>
    </Link>
  );
}
