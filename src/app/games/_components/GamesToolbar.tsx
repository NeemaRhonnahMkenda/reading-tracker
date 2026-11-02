// src/app/games/_components/GamesToolbar.tsx
// Collection / Wishlist tabs, search, console and progress filters, sort, and
// grid or list view.

"use client";

import { focusRing } from "../../components/ui/Button";
import { PLAY_LABEL } from "../_lib/games";
import { FAMILY_LABEL, PLATFORMS, type Family } from "../_lib/platforms";
import type { GameStatus, PlayStatus } from "../_lib/types";
import { Chip, inputClass } from "./GameBits";

export type SortKey = "recent" | "name" | "release" | "platform" | "priority";
export type View = "grid" | "list";

export interface Filters {
  tab: GameStatus;
  q: string;
  family: Family | "all";
  platform: number | "all";
  play: PlayStatus | "all";
  format: "all" | "physical" | "digital";
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = { tab: "owned", q: "", family: "all", platform: "all", play: "all", format: "all", sort: "recent" };

export default function GamesToolbar({
  filters,
  onChange,
  counts,
  platformsInUse,
  view,
  onView,
  shown,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  counts: { owned: number; wishlist: number };
  platformsInUse: number[];
  view: View;
  onView: (v: View) => void;
  shown: number;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...filters, [k]: v });
  const consoles = PLATFORMS.filter((p) => platformsInUse.includes(p.id) && (filters.family === "all" || p.family === filters.family));
  const narrowed = filters.q || filters.family !== "all" || filters.platform !== "all" || filters.play !== "all" || filters.format !== "all";

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div role="tablist" aria-label="Collection or wishlist" className="flex gap-6 border-b border-[#0f172a]/10">
        {(["owned", "wishlist"] as const).map((t) => {
          const on = filters.tab === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange({ ...filters, tab: t, play: "all", sort: t === "wishlist" && filters.sort === "recent" ? "priority" : filters.sort === "priority" ? "recent" : filters.sort })}
              className={`relative -mb-px pb-3 text-base sm:text-lg font-classical font-semibold transition-colors rounded-t ${focusRing} ${
                on ? "text-[#0f172a]" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {t === "owned" ? "Collection" : "Wishlist"}
              <span className={`ml-2 text-xs font-sans font-semibold tabular-nums px-2 py-0.5 rounded-full ${on ? "bg-[#0f172a] text-[#fdfaf3]" : "bg-[#0f172a]/[0.06] text-slate-500"}`}>
                {counts[t]}
              </span>
              {on && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#7a947c]" />}
            </button>
          );
        })}
      </div>

      {/* Search + sort + view */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 min-w-0">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder={filters.tab === "owned" ? "Search your collection" : "Search your wishlist"}
            aria-label="Search your games"
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="flex gap-2.5">
          <select value={filters.sort} onChange={(e) => set("sort", e.target.value as SortKey)} aria-label="Sort by" className={`${inputClass} flex-1 sm:w-44`}>
            {filters.tab === "wishlist" && <option value="priority">Most wanted</option>}
            <option value="recent">Recently added</option>
            <option value="name">Name A–Z</option>
            <option value="release">Newest release</option>
            <option value="platform">Console</option>
          </select>
          <div role="radiogroup" aria-label="View" className="flex p-1 rounded-xl bg-[#0f172a]/[0.05] gap-1 shrink-0">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                aria-label={v === "grid" ? "Grid view" : "List view"}
                onClick={() => onView(v)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${focusRing} ${view === v ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-400 hover:text-[#0f172a]"}`}
              >
                {v === "grid" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="9" rx="1.5" />
                    <rect x="14" y="3" width="7" height="9" rx="1.5" />
                    <rect x="3" y="15" width="7" height="6" rx="1.5" />
                    <rect x="14" y="15" width="7" height="6" rx="1.5" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-5 px-5 sm:mx-0 sm:px-0 sm:flex-wrap">
        <Chip on={filters.family === "all" && filters.platform === "all"} onClick={() => onChange({ ...filters, family: "all", platform: "all" })}>
          All consoles
        </Chip>
        {(["playstation", "nintendo"] as const).map((f) => (
          <Chip key={f} on={filters.family === f && filters.platform === "all"} onClick={() => onChange({ ...filters, family: f, platform: "all" })}>
            {FAMILY_LABEL[f]}
          </Chip>
        ))}
        {consoles.length > 1 &&
          consoles.map((p) => (
            <Chip key={p.id} on={filters.platform === p.id} onClick={() => set("platform", filters.platform === p.id ? "all" : p.id)}>
              {p.short}
            </Chip>
          ))}
        <span aria-hidden="true" className="shrink-0 w-px bg-[#0f172a]/10 mx-1" />
        {filters.tab === "owned" &&
          (["playing", "unplayed", "completed"] as PlayStatus[]).map((s) => (
            <Chip key={s} on={filters.play === s} onClick={() => set("play", filters.play === s ? "all" : s)}>
              {PLAY_LABEL[s]}
            </Chip>
          ))}
        {(["physical", "digital"] as const).map((f) => (
          <Chip key={f} on={filters.format === f} onClick={() => set("format", filters.format === f ? "all" : f)}>
            {f === "physical" ? "Physical" : "Digital"}
          </Chip>
        ))}
      </div>

      {narrowed && (
        <p className="text-sm text-slate-500" aria-live="polite">
          Showing {shown} of {counts[filters.tab]}.{" "}
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, tab: filters.tab, sort: filters.sort })}
            className={`font-medium text-[#0f172a] underline underline-offset-4 decoration-slate-300 rounded ${focusRing}`}
          >
            Clear filters
          </button>
        </p>
      )}
    </div>
  );
}
