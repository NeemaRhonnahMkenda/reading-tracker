// src/app/library/_components/LibraryToolbar.tsx
// Search, sort, filters and layout. The top row sticks under the navbar;
// status tabs, the filter panel and active-filter chips sit beneath it.

"use client";

import { useId, useState } from "react";
import { focusRing } from "../../components/ui/Button";
import ViewToggle, { type ShelfView } from "../../reading/_components/ViewToggle";
import {
  activeFilterCount,
  SORT_OPTIONS,
  STATUS_META,
  type BookStatus,
  type LibraryFilters,
  type LibraryStatsData,
  type SortKey,
  type StatusFilter,
} from "../_lib/library";

const selectClass = `h-11 w-full min-w-0 pl-4 pr-10 rounded-full bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 appearance-none bg-no-repeat bg-[right_0.9rem_center] bg-[url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")] focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all disabled:opacity-50`;

const STATUS_TABS: StatusFilter[] = ["all", "reading", "want_to_read", "finished", "did_not_finish"];

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className={`group inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full bg-[#0f172a] text-[#fdfaf3] text-xs font-medium max-w-full ${focusRing}`}
      aria-label={`Remove filter: ${label}`}
    >
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="w-4 h-4 rounded-full bg-white/15 group-hover:bg-white/30 flex items-center justify-center leading-none">
        ×
      </span>
    </button>
  );
}

export default function LibraryToolbar({
  filters,
  onChange,
  onReset,
  view,
  onViewChange,
  stats,
  shown,
  total,
  loading,
}: {
  filters: LibraryFilters;
  onChange: (patch: Partial<LibraryFilters>) => void;
  onReset: () => void;
  view: ShelfView;
  onViewChange: (view: ShelfView) => void;
  stats: LibraryStatsData | null;
  shown: number;
  total: number;
  loading: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const active = activeFilterCount(filters);
  const extraActive = [filters.format, filters.source, filters.year, filters.ownCover].filter(Boolean).length;

  const chips: { label: string; clear: () => void }[] = [];
  if (filters.status !== "all") chips.push({ label: STATUS_META[filters.status as BookStatus].label, clear: () => onChange({ status: "all" }) });
  if (filters.format) chips.push({ label: filters.format, clear: () => onChange({ format: "" }) });
  if (filters.source) chips.push({ label: `From ${filters.source}`, clear: () => onChange({ source: "" }) });
  if (filters.year) chips.push({ label: `Added in ${filters.year}`, clear: () => onChange({ year: "" }) });
  if (filters.ownCover) chips.push({ label: "My cover photos", clear: () => onChange({ ownCover: false }) });

  return (
    <div>
      {/* ---------- Sticky row ---------- */}
      <div className="sticky top-16 sm:top-[4.5rem] z-20 -mx-5 sm:-mx-8 px-5 sm:px-8 py-3 bg-[#fdfaf3]/85 backdrop-blur-md border-b border-[#0f172a]/[0.05]">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
          {/* Search */}
          <div className="relative order-1 w-full sm:w-auto sm:flex-1 sm:max-w-sm">
            <label htmlFor="library-search" className="sr-only">Search your library</label>
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="library-search"
              type="search"
              value={filters.search}
              onChange={(e) => onChange({ search: e.target.value })}
              placeholder="Search title or author"
              className="w-full h-11 pl-11 pr-4 rounded-full bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
            />
          </div>

          {/* Sort */}
          <div className="order-2 flex-1 sm:flex-none sm:w-44 min-w-0">
            <label htmlFor="library-sort" className="sr-only">Sort by</label>
            <select
              id="library-sort"
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as SortKey })}
              className={selectClass}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Filters */}
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            className={`order-3 shrink-0 h-11 px-4 rounded-full border inline-flex items-center gap-2 text-sm font-medium transition-all ${focusRing} ${
              panelOpen || extraActive
                ? "bg-[#0f172a] border-[#0f172a] text-[#fdfaf3]"
                : "bg-white border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c]"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            <span className="hidden min-[400px]:inline">Filters</span>
            {extraActive > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-[#7a947c] text-white text-[11px] inline-flex items-center justify-center">
                {extraActive}
              </span>
            )}
          </button>

          <div className="order-4 shrink-0 sm:ml-auto">
            <ViewToggle view={view} onChange={onViewChange} />
          </div>
        </div>
      </div>

      {/* ---------- Status tabs ---------- */}
      <div
        role="group"
        aria-label="Filter by status"
        className="mt-4 flex gap-2 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none]"
      >
        {STATUS_TABS.map((s) => {
          const selected = filters.status === s;
          const count = s === "all" ? stats?.total : stats?.counts[s as BookStatus];
          const label = s === "all" ? "All books" : STATUS_META[s as BookStatus].label;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ status: s })}
              className={`shrink-0 h-10 px-4 rounded-full text-sm inline-flex items-center gap-2 border transition-all ${focusRing} ${
                selected
                  ? "bg-[#0f172a] border-[#0f172a] text-[#fdfaf3]"
                  : "bg-white/80 border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c] hover:text-[#0f172a]"
              }`}
            >
              {s !== "all" && <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${selected ? "bg-current opacity-70" : STATUS_META[s as BookStatus].dot}`} />}
              {label}
              {count !== undefined && (
                <span className={`text-xs tabular-nums ${selected ? "text-[#fdfaf3]/60" : "text-slate-400"}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---------- More filters ---------- */}
      <div id={panelId} hidden={!panelOpen} className="mt-4">
        <div className="rounded-[1.4rem] bg-white/75 border border-[#0f172a]/[0.06] shadow-[0_10px_35px_rgba(15,23,42,0.05)] p-4 sm:p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <label className="block min-w-0">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">Format</span>
              <select value={filters.format} onChange={(e) => onChange({ format: e.target.value })} className={selectClass} disabled={!stats?.formats.length}>
                <option value="">Any format</option>
                {stats?.formats.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>

            <label className="block min-w-0">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">Bought from</span>
              <select value={filters.source} onChange={(e) => onChange({ source: e.target.value })} className={selectClass} disabled={!stats?.sources.length}>
                <option value="">Anywhere</option>
                {stats?.sources.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>

            <label className="block min-w-0">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">Year added</span>
              <select value={filters.year} onChange={(e) => onChange({ year: e.target.value })} className={selectClass} disabled={!stats?.years.length}>
                <option value="">Any year</option>
                {stats?.years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>

            <div className="min-w-0">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">Cover</span>
              <button
                type="button"
                role="switch"
                aria-checked={filters.ownCover}
                onClick={() => onChange({ ownCover: !filters.ownCover })}
                className={`w-full h-11 px-4 rounded-full border flex items-center justify-between gap-3 text-sm transition-all ${focusRing} ${
                  filters.ownCover ? "bg-[#eef3ee] border-[#7a947c] text-[#4a5c4b]" : "bg-white border-[#0f172a]/10 text-slate-600"
                }`}
              >
                <span className="truncate">Only my cover photos</span>
                <span aria-hidden="true" className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${filters.ownCover ? "bg-[#7a947c]" : "bg-[#0f172a]/15"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${filters.ownCover ? "left-[18px]" : "left-0.5"}`} />
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Active filters + result count ---------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2 min-h-8" aria-live="polite">
        {chips.map((c) => (
          <Chip key={c.label} label={c.label} onRemove={c.clear} />
        ))}
        {active > 1 && (
          <button
            type="button"
            onClick={onReset}
            className={`h-8 px-2 text-xs font-medium text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] rounded ${focusRing}`}
          >
            Clear all
          </button>
        )}
        <p className="ml-auto text-xs text-slate-400 whitespace-nowrap">
          {loading ? "Loading…" : `${shown} of ${total} ${total === 1 ? "book" : "books"}`}
        </p>
      </div>
    </div>
  );
}
