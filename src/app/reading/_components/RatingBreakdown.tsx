// src/app/reading/_components/RatingBreakdown.tsx
// Your average rating as a headline score, plus how your ratings spread
// across 1 to 5 stars. Quarter ratings count under their whole star
// (4.25, 4.5 and 4.75 all sit in the 4★ row).

"use client";

import { useEffect, useState } from "react";
import Stars from "./Stars";

const LABELS = ["It wasn't for me", "It was okay", "I liked it", "I really liked it", "A new favourite"];

function formatAvg(avg: number) {
  return String(Number(avg.toFixed(2)));
}

export default function RatingBreakdown({ dist, avg }: { dist: number[]; avg: number | null }) {
  const total = dist.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...dist);
  const topStar = dist.indexOf(Math.max(...dist)) + 1; // most common whole star
  const fourPlus = total ? Math.round(((dist[3] + dist[4]) / total) * 100) : 0;

  // Grow the bars in after the first paint
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      aria-labelledby="rating-breakdown-title"
      className="h-full rounded-[1.6rem] bg-white/75 backdrop-blur border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] p-5 sm:p-6 lg:p-7"
    >
      <p className="text-xs font-medium tracking-[0.18em] uppercase text-[#7a947c]">Ratings</p>
      <h3 id="rating-breakdown-title" className="mt-1 font-classical text-2xl font-semibold text-[#0f172a]">
        How you rate
      </h3>

      {total === 0 || avg == null ? (
        <div className="mt-5 flex items-center gap-4 rounded-2xl border border-dashed border-[#0f172a]/12 bg-white/50 px-4 py-5">
          <Stars value={0} className="w-5 h-5" />
          <p className="text-sm text-slate-500 font-light leading-6">
            Your ratings will appear here once you review a finished book.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-8 lg:gap-10 items-center">
          {/* ---------- Headline score ---------- */}
          <div className="flex sm:flex-col items-center sm:items-start gap-4 sm:gap-0 rounded-2xl bg-[#fbf6ea] border border-[#c69a3d]/15 px-4 py-4 sm:px-5 sm:py-5">
            <p className="font-classical text-5xl sm:text-6xl leading-none text-[#0f172a] tabular-nums">
              {formatAvg(avg)}
              <span className="sr-only"> out of 5 on average</span>
            </p>

            <div className="min-w-0 sm:mt-3">
              <Stars value={Math.round(avg * 4) / 4} className="w-4 h-4 sm:w-[1.1rem] sm:h-[1.1rem]" />
              <p className="mt-1.5 text-xs text-slate-500">
                Average of {total} rated {total === 1 ? "book" : "books"}
              </p>
            </div>
          </div>

          {/* ---------- Distribution ---------- */}
          <div className="min-w-0">
            <ul className="space-y-2.5 sm:space-y-3">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = dist[star - 1];
                const pct = Math.round((count / total) * 100);
                const width = count ? Math.max(5, (count / max) * 100) : 0;
                const isTop = star === topStar && count > 0;

                return (
                  <li key={star}>
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm font-semibold text-[#0f172a] tabular-nums shrink-0">
                          {star}
                          <span aria-hidden="true" className="text-[#c5a24a] ml-0.5">★</span>
                          <span className="sr-only"> stars</span>
                        </span>
                        {/* Label only where there's room for it */}
                        <span className="hidden min-[420px]:inline text-xs text-slate-400 truncate">{LABELS[star - 1]}</span>
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums shrink-0">
                        <span className="font-semibold text-[#0f172a]">{count}</span>
                        <span className="sr-only">{count === 1 ? " book" : " books"},</span>
                        <span className="text-slate-400"> · {pct}%</span>
                      </span>
                    </div>

                    <div className="h-2.5 rounded-full bg-[#0f172a]/[0.06] overflow-hidden" aria-hidden="true">
                      <div
                        className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${
                          isTop ? "bg-[#c69a3d]" : "bg-[#c69a3d]/45"
                        }`}
                        style={{ width: ready ? `${width}%` : "0%" }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* ---------- Takeaways ---------- */}
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#0f172a]/[0.04] text-xs text-slate-600">
                Most often <span className="font-semibold text-[#0f172a]">{topStar}★</span>
              </span>
              <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#eef3ee] text-xs text-[#4a5c4b]">
                <span className="font-semibold">{fourPlus}%</span> rated 4★ or higher
              </span>
            </div>
          </div>
        </div>
      )}

      {total > 0 && (
        <p className="mt-5 pt-4 border-t border-[#0f172a]/[0.06] text-[11px] text-slate-400 leading-5">
          Quarter ratings count under their whole star, so 4.5 sits in the 4★ row.
        </p>
      )}
    </section>
  );
}
