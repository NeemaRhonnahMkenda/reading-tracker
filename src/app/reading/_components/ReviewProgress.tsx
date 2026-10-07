// src/app/reading/_components/ReviewProgress.tsx
// Finished books vs finished books with a review, plus the ones still waiting.

import Link from "next/link";
import { focusRing } from "../../components/ui/Button";
import type { ShelfBook } from "../../../lib/shelf";
import ShelfCover from "./ShelfCover";

function Ring({ value, size = 128 }: { value: number; size?: number }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(15,23,42,0.07)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#7a947c"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / 100)}
        className="transition-[stroke-dashoffset] duration-1000 ease-out"
      />
    </svg>
  );
}

export default function ReviewProgress({
  finished,
  reviewed,
  written,
  unreviewed,
}: {
  finished: number;
  reviewed: number;
  written: number;
  unreviewed: ShelfBook[];
}) {
  const pct = finished ? Math.round((reviewed / finished) * 100) : 0;
  const waiting = finished - reviewed;

  return (
    <div className="h-full rounded-[1.6rem] bg-white/75 backdrop-blur border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] p-5 sm:p-6">
      <p className="text-xs font-medium tracking-[0.18em] uppercase text-[#7a947c]">Reviews</p>
      <h3 className="mt-1 font-classical text-2xl font-semibold text-[#0f172a]">Finished vs reviewed</h3>

      {finished === 0 ? (
        <p className="mt-4 text-sm text-slate-500 font-light leading-6">
          Finish a book and it&apos;ll show up here, ready for your thoughts.
        </p>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-5">
            <div className="relative shrink-0">
              <Ring value={pct} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-classical text-3xl text-[#0f172a] leading-none">{pct}%</span>
                <span className="text-[11px] text-slate-400 mt-1">reviewed</span>
              </div>
            </div>

            <dl className="flex-1 min-w-0 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-600">
                  <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-[#0f172a]/15" />
                  Finished
                </dt>
                <dd className="font-semibold text-[#0f172a]">{finished}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-600">
                  <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-[#7a947c]" />
                  Reviewed
                </dt>
                <dd className="font-semibold text-[#0f172a]">{reviewed}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-slate-600">
                  <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-[#c69a3d]" />
                  With written thoughts
                </dt>
                <dd className="font-semibold text-[#0f172a]">{written}</dd>
              </div>
            </dl>
          </div>

          {waiting > 0 ? (
            <div className="mt-6 pt-5 border-t border-[#0f172a]/[0.06]">
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-[#6c5c85]">{waiting}</span> {waiting === 1 ? "book is" : "books are"} waiting for your review
              </p>
              <ul className="mt-3 flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none]">
                {unreviewed.slice(0, 8).map((book) => (
                  <li key={book.id} className="shrink-0">
                    <Link
                      href={`/library/${book.id}`}
                      prefetch={false}
                      title={`Review ${book.title}`}
                      className={`block w-12 sm:w-14 aspect-[2/3] rounded-md overflow-hidden ring-1 ring-[#0f172a]/10 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all ${focusRing}`}
                    >
                      <ShelfCover src={book.cover} title={book.title} compact />
                      <span className="sr-only">Review {book.title}</span>
                    </Link>
                  </li>
                ))}
                {waiting > 8 && (
                  <li className="shrink-0 w-12 sm:w-14 aspect-[2/3] rounded-md bg-[#f7f5fa] border border-dashed border-[#9a86b9]/30 flex items-center justify-center text-xs font-semibold text-[#6c5c85]">
                    +{waiting - 8}
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <p className="mt-6 pt-5 border-t border-[#0f172a]/[0.06] text-sm text-[#4a5c4b]">
              <span aria-hidden="true">✓ </span>Every finished book has a review. Lovely.
            </p>
          )}
        </>
      )}
    </div>
  );
}
