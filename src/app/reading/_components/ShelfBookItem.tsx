// src/app/reading/_components/ShelfBookItem.tsx
// One book on a shelf, as a grid card or a list row.

"use client";

import Link from "next/link";
import { focusRing } from "../../components/ui/Button";
import { formatFinished, MONTHS_SHORT, type ShelfBook } from "../../../lib/shelf";
import ShelfCover from "./ShelfCover";
import Stars from "./Stars";
import ProgressBar from "./ProgressBar";
import type { ShelfView } from "./ViewToggle";

function addedLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Added ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function progressText(book: ShelfBook) {
  if (book.progress != null) return `${book.progress}%`;
  if (book.furthestPage != null) return `Page ${book.furthestPage}`;
  return "Just started";
}

function pageText(book: ShelfBook) {
  if (book.furthestPage == null) return book.pages ? `${book.pages} pages` : null;
  return book.pages ? `p. ${book.furthestPage} of ${book.pages}` : `p. ${book.furthestPage}`;
}

// The line of detail that changes with the shelf
function Meta({ book, compact = false }: { book: ShelfBook; compact?: boolean }) {
  switch (book.status) {
    case "reading": {
      const pages = pageText(book);
      return (
        <div className="w-full">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-[#4a5c4b]">{progressText(book)}</span>
            {pages && <span className="text-slate-400 truncate">{pages}</span>}
          </div>
          <ProgressBar value={book.progress ?? 0} className="h-1.5 mt-1.5" label={`${book.title} progress`} />
        </div>
      );
    }
    case "finished": {
      const when = formatFinished(book.review?.finishedYear, book.review?.finishedMonth);
      if (!book.review) {
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6c5c85]">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#9a86b9]" />
            {compact ? "Needs a review" : "Not reviewed yet"}
          </span>
        );
      }
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {book.review.rating ? (
            <span className="inline-flex items-center gap-1">
              <Stars value={book.review.rating} />
              <span className="tabular-nums text-slate-500">{Number(book.review.rating.toFixed(2))}</span>
            </span>
          ) : null}
          {when && <span>{when}</span>}
        </span>
      );
    }
    case "did_not_finish":
      return (
        <span className="text-xs text-[#7a3f33]/80">
          {book.furthestPage != null ? `Stopped at p. ${book.furthestPage}` : "Put down"}
        </span>
      );
    default:
      return <span className="text-xs text-slate-400">{addedLabel(book.addedAt)}</span>;
  }
}

export default function ShelfBookItem({
  book,
  view,
  featured = false,
  eager = false,
}: {
  book: ShelfBook;
  view: ShelfView;
  featured?: boolean;
  eager?: boolean;
}) {
  const href = `/library/${book.id}`;
  const needsReview = book.status === "finished" && !book.review;

  // ---------- List row ----------
  if (view === "list") {
    return (
      <Link
        href={href}
        prefetch={false}
        className={`group flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 pr-3 sm:pr-4 rounded-2xl bg-white/70 border border-[#0f172a]/[0.06] hover:bg-white hover:border-[#0f172a]/10 hover:shadow-[0_8px_25px_rgba(15,23,42,0.06)] transition-all ${focusRing}`}
      >
        <div className="w-11 sm:w-12 aspect-[2/3] shrink-0 rounded-md overflow-hidden shadow-sm ring-1 ring-[#0f172a]/10">
          <ShelfCover src={book.cover} title={book.title} compact eager={eager} />
        </div>

        <div className="flex-1 min-w-0 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)] sm:items-center sm:gap-6">
          <div className="min-w-0">
            <p className="font-classical text-[15px] sm:text-base font-semibold text-[#0f172a] leading-snug truncate">{book.title}</p>
            {book.author && <p className="text-xs sm:text-sm text-slate-500 truncate">{book.author}</p>}
          </div>
          <div className="mt-1.5 sm:mt-0 min-w-0">
            <Meta book={book} compact />
          </div>
        </div>

        <span aria-hidden="true" className="text-slate-300 group-hover:text-[#7a947c] group-hover:translate-x-0.5 transition-all">
          →
        </span>
      </Link>
    );
  }

  // ---------- Grid card ----------
  return (
    <Link href={href} prefetch={false} className={`group block rounded-xl ${focusRing}`}>
      <div
        className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-[#e9e4d9] ring-1 ring-[#0f172a]/10 shadow-[0_10px_25px_rgba(15,23,42,0.12)] group-hover:shadow-[0_18px_40px_rgba(15,23,42,0.18)] group-hover:-translate-y-1 transition-all duration-300`}
      >
        <ShelfCover src={book.cover} title={book.title} author={book.author} eager={eager} />

        {/* Spine shading for a bit of depth */}
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/20 to-transparent" />

        {needsReview && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#fdfaf3]/95 text-[#6c5c85] text-[10px] font-semibold shadow-sm">
            <span aria-hidden="true">✎</span> Review
          </span>
        )}

        {book.status === "reading" && featured && book.progress != null && (
          <div className="absolute inset-x-0 bottom-0 p-3 pt-8 bg-gradient-to-t from-[#0f172a]/85 to-transparent">
            <div className="flex items-baseline justify-between text-[#fdfaf3] text-xs mb-1.5">
              <span className="font-semibold">{book.progress}%</span>
              {book.pages && book.furthestPage != null && (
                <span className="opacity-70">
                  {book.pages - book.furthestPage > 0 ? `${book.pages - book.furthestPage} pages left` : "Almost done"}
                </span>
              )}
            </div>
            <ProgressBar value={book.progress} tone="light" className="h-1" label={`${book.title} progress`} />
          </div>
        )}
      </div>

      <div className="mt-3 px-0.5">
        <h3 className={`font-classical font-semibold text-[#0f172a] leading-tight line-clamp-2 ${featured ? "text-lg" : "text-[15px] sm:text-base"}`}>
          {book.title}
        </h3>
        {book.author && <p className="text-xs sm:text-sm text-slate-500 mt-0.5 line-clamp-1">{book.author}</p>}
        {!(book.status === "reading" && featured && book.progress != null) && (
          <div className="mt-2">
            <Meta book={book} />
          </div>
        )}
      </div>
    </Link>
  );
}
