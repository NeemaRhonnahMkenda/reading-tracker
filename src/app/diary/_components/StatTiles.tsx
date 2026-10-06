// src/app/diary/_components/StatTiles.tsx
// Same tile style as the library's statistics row.

import { ReadingStats, formatMinutes } from "../../../lib/reading";

export default function StatTiles({ stats }: { stats: ReadingStats }) {
  const tiles: [string, string][] = [
    ["Time reading", formatMinutes(stats.totals.minutes)],
    ["Pages read", stats.totals.pages.toLocaleString()],
    ["Sessions", stats.totals.sessions.toLocaleString()],
    ["Journal notes", stats.totals.notes.toLocaleString()],
  ];

  return (
    <dl className="grid grid-cols-2 gap-4">
      {tiles.map(([label, value]) => (
        <div key={label} className="bg-white border border-[#0f172a]/5 rounded-xl p-5 shadow-sm">
          <dt className="text-sm text-slate-400 mb-2">{label}</dt>
          <dd className="text-3xl font-classical text-[#0f172a] tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
