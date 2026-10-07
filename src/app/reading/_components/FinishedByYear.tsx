// src/app/reading/_components/FinishedByYear.tsx
// Books finished per year as bars. Tap a year to filter the Finished shelf.

"use client";

import { focusRing } from "../../components/ui/Button";
import type { YearCount } from "../../../lib/shelf";

export type YearFilter = number | "unknown" | null;

export default function FinishedByYear({
  data,
  selected,
  onSelect,
  currentYear,
}: {
  data: YearCount[];
  selected: YearFilter;
  onSelect: (year: YearFilter) => void;
  currentYear: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const dated = data.filter((d) => d.year !== null);
  const best = dated.length ? dated.reduce((a, b) => (b.count > a.count ? b : a)) : null;

  return (
    <div className="h-full rounded-[1.6rem] bg-white/75 backdrop-blur border border-[#0f172a]/[0.06] shadow-[0_15px_45px_rgba(15,23,42,0.05)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] uppercase text-[#7a947c]">Year by year</p>
          <h3 className="mt-1 font-classical text-2xl font-semibold text-[#0f172a]">Books finished</h3>
        </div>
        {best && (
          <p className="text-xs text-slate-500 bg-[#fbf3e2] border border-[#c69a3d]/20 rounded-full px-3 py-1.5">
            Best year: <span className="font-semibold text-[#8a6a22]">{best.year}</span> with {best.count}
          </p>
        )}
      </div>

      {data.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 font-light leading-6">
          Finish a book and add when you finished it in its review to start your timeline.
        </p>
      ) : (
        <>
          <ul className="mt-5 space-y-2">
            {data.map((row) => {
              const key: YearFilter = row.year ?? "unknown";
              const active = selected === key;
              const isNow = row.year === currentYear;
              return (
                <li key={String(key)}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(active ? null : key)}
                    className={`group w-full grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-3 rounded-xl px-2 py-1.5 -mx-2 text-left transition-colors ${focusRing} ${
                      active ? "bg-[#eef3ee]" : "hover:bg-[#0f172a]/[0.03]"
                    }`}
                  >
                    <span className={`text-sm ${row.year === null ? "text-slate-400 italic" : "text-slate-700 font-medium"}`}>
                      {row.year ?? "No date"}
                    </span>
                    <span className="h-7 rounded-lg bg-[#0f172a]/[0.04] overflow-hidden">
                      <span
                        className={`block h-full rounded-lg transition-[width] duration-700 ease-out ${
                          row.year === null
                            ? "bg-[repeating-linear-gradient(45deg,#d8d0e3,#d8d0e3_6px,#e7e1ee_6px,#e7e1ee_12px)]"
                            : active || isNow
                              ? "bg-[#7a947c]"
                              : "bg-[#7a947c]/45 group-hover:bg-[#7a947c]/70"
                        }`}
                        style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }}
                      />
                    </span>
                    <span className="text-sm font-semibold text-[#0f172a] text-right tabular-nums">{row.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-slate-400 leading-5">
            Tap a year to show just those books on your Finished shelf. Dates come from your reviews.
          </p>
        </>
      )}
    </div>
  );
}
