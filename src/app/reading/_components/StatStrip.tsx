// src/app/reading/_components/StatStrip.tsx
// Four headline numbers at the top of the page.

import type { ShelfStats } from "../../../lib/shelf";

export default function StatStrip({ stats, year }: { stats: ShelfStats; year: number }) {
  const tiles = [
    { label: "Reading now", value: String(stats.counts.reading), hint: stats.counts.want_to_read ? `${stats.counts.want_to_read} waiting` : "Nothing queued", accent: "bg-[#7a947c]" },
    { label: `Finished in ${year}`, value: String(stats.finishedThisYear), hint: `${stats.counts.finished} all time`, accent: "bg-[#0f172a]" },
    {
      label: "Pages read",
      value: stats.pagesRead >= 10000 ? `${(stats.pagesRead / 1000).toFixed(1)}k` : stats.pagesRead.toLocaleString(),
      hint: "In finished books",
      accent: "bg-[#9a86b9]",
    },
    {
      label: "Average rating",
      value: stats.avgRating != null ? stats.avgRating.toFixed(2).replace(/0$/, "") : "—",
      hint: stats.avgRating != null ? "out of 5 stars" : "Rate a book to see this",
      accent: "bg-[#c69a3d]",
      star: stats.avgRating != null,
    },
  ];

  return (
    <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="relative overflow-hidden rounded-2xl bg-white/75 backdrop-blur border border-[#0f172a]/[0.06] shadow-[0_8px_30px_rgba(15,23,42,0.04)] px-4 sm:px-5 py-4 sm:py-5"
        >
          <span aria-hidden="true" className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${tile.accent} opacity-70`} />
          <dt className="text-xs text-slate-500">{tile.label}</dt>
          <dd className="mt-1">
            <span className="font-classical text-3xl sm:text-4xl text-[#0f172a] leading-none">
              {tile.value}
              {tile.star && <span className="text-[#c5a24a] text-xl sm:text-2xl ml-1 align-top">★</span>}
            </span>
            <span className="block mt-1.5 text-[11px] sm:text-xs text-slate-400">{tile.hint}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
