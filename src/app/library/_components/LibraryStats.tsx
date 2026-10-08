// src/app/library/_components/LibraryStats.tsx
// The headline numbers plus a few memorable facts about the collection.
// Tapping a segment of the shelf bar filters the books below.

"use client";

import type { ReactNode } from "react";
import { focusRing } from "../../components/ui/Button";
import { STATUS_META, type BookStatus, type LibraryStatsData } from "../_lib/library";

const ORDER: BookStatus[] = ["reading", "want_to_read", "finished", "did_not_finish"];

// Something real-world to compare the stacked height to
function heightComparison(m: number) {
  if (m < 0.3) return "about the height of a ruler";
  if (m < 1) return "about waist-high";
  if (m < 2.1) return "about as tall as a front door";
  if (m < 5.5) return "taller than a front door";
  if (m < 10) return "taller than a giraffe";
  return "taller than a three-storey house";
}

function formatHeight(m: number) {
  return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(1)} m`;
}

function Fact({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}) {
  return (
    <div className="min-w-0 flex items-start gap-3 rounded-2xl bg-white/75 border border-[#0f172a]/[0.06] shadow-[0_8px_30px_rgba(15,23,42,0.04)] p-4 sm:p-5">
      <span aria-hidden="true" className="w-10 h-10 shrink-0 rounded-xl bg-[#f7f5fa] text-[#7a6a96] flex items-center justify-center">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-0.5 font-classical text-lg sm:text-xl font-semibold text-[#0f172a] leading-snug break-words line-clamp-2">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400 leading-5">{sub}</p>}
      </div>
    </div>
  );
}

export default function LibraryStats({
  stats,
  activeStatus,
  onPickStatus,
}: {
  stats: LibraryStatsData | null;
  activeStatus: string;
  onPickStatus: (status: BookStatus) => void;
}) {
  if (!stats) {
    return (
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-12" aria-hidden="true">
        <div className="lg:col-span-5 h-44 rounded-[1.6rem] bg-[#0f172a]/[0.07] animate-pulse motion-reduce:animate-none" />
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 sm:h-full min-h-24 rounded-2xl bg-[#0f172a]/[0.05] animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    );
  }

  const total = stats.total || 1;

  return (
    <div className="grid gap-3 sm:gap-4 lg:grid-cols-12">
      {/* ---------- Headline card ---------- */}
      <section
        aria-label="Library overview"
        className="lg:col-span-5 relative overflow-hidden rounded-[1.6rem] bg-[#0f172a] text-[#fdfaf3] shadow-[0_20px_50px_rgba(15,23,42,0.18)] p-5 sm:p-6"
      >
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 w-44 h-44 rounded-full bg-[#7a947c]/25 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-10 -bottom-16 w-40 h-40 rounded-full bg-[#9a86b9]/20 blur-3xl" />

        <div className="relative flex items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.18em] uppercase text-[#a9bfaa]">In your archive</p>
            <p className="mt-1 font-classical text-5xl sm:text-6xl leading-none tabular-nums">{stats.total}</p>
            <p className="mt-2 text-sm text-[#fdfaf3]/70">{stats.total === 1 ? "book" : "books"}</p>
          </div>
          <div className="text-right text-xs text-[#fdfaf3]/60 space-y-1">
            {stats.addedThisMonth > 0 && (
              <p>
                <span className="text-[#c9dbca] font-semibold">+{stats.addedThisMonth}</span> this month
              </p>
            )}
            {stats.collectingSince && <p>Collecting since {stats.collectingSince}</p>}
          </div>
        </div>

        {/* Shelf bar: share of each status, tap to filter */}
        <div className="relative mt-6">
          <div className="flex h-3 rounded-full overflow-hidden bg-white/10" aria-hidden="true">
            {ORDER.map((s) =>
              stats.counts[s] ? (
                <span
                  key={s}
                  className={`${STATUS_META[s].dot} ${s === "finished" ? "!bg-[#fdfaf3]" : ""} transition-[width] duration-700`}
                  style={{ width: `${(stats.counts[s] / total) * 100}%` }}
                />
              ) : null
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {ORDER.map((s) => {
              const active = activeStatus === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPickStatus(s)}
                  aria-pressed={active}
                  className={`flex items-center gap-2 min-w-0 rounded-xl px-3 py-2 text-left text-sm transition-colors ${focusRing} focus-visible:ring-offset-[#0f172a] ${
                    active ? "bg-white/15" : "hover:bg-white/10"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-2 h-2 rounded-full shrink-0 ${s === "finished" ? "bg-[#fdfaf3]" : STATUS_META[s].dot}`}
                  />
                  <span className="truncate text-[#fdfaf3]/80">{STATUS_META[s].short}</span>
                  <span className="ml-auto font-semibold tabular-nums">{stats.counts[s]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- Memorable facts ---------- */}
      <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3 sm:gap-4 content-start">
        <Fact
          label="Stacked up, your books stand"
          value={stats.pages > 0 ? formatHeight(stats.shelfMetres) : "—"}
          sub={stats.pages > 0 ? `${heightComparison(stats.shelfMetres)} · ${stats.pages.toLocaleString()} pages` : "Add page counts to see this"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="4" y="15" width="16" height="4" rx="1" />
              <rect x="6" y="10" width="13" height="4" rx="1" />
              <rect x="5" y="5" width="12" height="4" rx="1" />
            </svg>
          }
        />
        <Fact
          label="Added this year"
          value={`${stats.addedThisYear} ${stats.addedThisYear === 1 ? "book" : "books"}`}
          sub={stats.counts.finished ? `${Math.round((stats.counts.finished / total) * 100)}% of your library is finished` : "Nothing finished yet"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="4" y="5" width="16" height="15" rx="2" />
              <path d="M4 10h16M9 3v4M15 3v4" />
            </svg>
          }
        />
        <Fact
          label="Most-collected author"
          value={stats.topAuthor && stats.topAuthor.count > 1 ? stats.topAuthor.name : "No favourite yet"}
          sub={stats.topAuthor && stats.topAuthor.count > 1 ? `${stats.topAuthor.count} books on your shelves` : "Two books by one author unlocks this"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4" />
              <circle cx="12" cy="9" r="3.5" />
            </svg>
          }
        />
        <Fact
          label="Favourite place to buy"
          value={stats.topSource ? stats.topSource.name : "Not recorded"}
          sub={stats.topSource ? `${stats.topSource.count} ${stats.topSource.count === 1 ? "book" : "books"} from here` : "Add where you bought a book to see this"}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9l1.5-4h13L20 9" />
              <path d="M4 9h16v10H4z" />
              <path d="M10 19v-5h4v5" />
            </svg>
          }
        />
      </div>
    </div>
  );
}
