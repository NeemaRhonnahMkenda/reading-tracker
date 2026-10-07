// src/app/reading/_components/RatingBreakdown.tsx

import Stars from "./Stars";

const LABELS = ["It wasn't for me", "It was okay", "I liked it", "I really liked it", "A new favourite"];

export default function RatingBreakdown({ dist, avg }: { dist: number[]; avg: number | null }) {
  const total = dist.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...dist);

  return (
    <div className="h-full rounded-[1.6rem] bg-white/75 backdrop-blur border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] p-5 sm:p-6">
      <p className="text-xs font-medium tracking-[0.18em] uppercase text-[#7a947c]">Ratings</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
        <h3 className="font-classical text-2xl font-semibold text-[#0f172a]">How you rate</h3>
        {avg != null && (
          <span className="flex items-center gap-2 text-sm text-slate-500">
            <Stars value={Math.round(avg * 4) / 4} />
            {avg.toFixed(2).replace(/0$/, "")} avg
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-500 font-light leading-6">Your ratings will appear here once you review a finished book.</p>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = dist[star - 1];
            return (
              <li
                key={star}
                className="grid grid-cols-[2.5rem_minmax(0,1fr)_1.75rem] items-center gap-3"
                title={`${LABELS[star - 1]}${star < 5 ? ` (${star} to ${star}.75 stars)` : ""}`}
              >
                <span className="text-sm text-slate-600 tabular-nums">
                  {star} <span className="text-[#c5a24a]">★</span>
                </span>
                <span className="h-2.5 rounded-full bg-[#0f172a]/[0.06] overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-[#c69a3d] transition-[width] duration-700 ease-out"
                    style={{ width: count ? `${Math.max(4, (count / max) * 100)}%` : "0%" }}
                  />
                </span>
                <span className="text-sm font-semibold text-[#0f172a] text-right tabular-nums">{count}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
