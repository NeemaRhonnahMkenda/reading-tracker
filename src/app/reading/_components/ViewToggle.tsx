// src/app/reading/_components/ViewToggle.tsx
// Grid / list switch.

"use client";

import type { ReactNode } from "react";
import { focusRing } from "../../components/ui/Button";

export type ShelfView = "grid" | "list";

const OPTIONS: { value: ShelfView; label: string; icon: ReactNode }[] = [
  {
    value: "grid",
    label: "Grid",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
      </svg>
    ),
  },
  {
    value: "list",
    label: "List",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <rect x="3.5" y="4.5" width="3" height="3" rx="0.8" />
        <rect x="3.5" y="10.5" width="3" height="3" rx="0.8" />
        <rect x="3.5" y="16.5" width="3" height="3" rx="0.8" />
      </svg>
    ),
  },
];

export default function ViewToggle({ view, onChange }: { view: ShelfView; onChange: (view: ShelfView) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="inline-flex p-1 rounded-full bg-white/80 border border-[#0f172a]/8 shadow-sm">
      {OPTIONS.map((option) => {
        const active = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`h-10 px-3.5 sm:px-4 rounded-full inline-flex items-center gap-2 text-sm font-medium transition-all ${focusRing} ${
              active ? "bg-[#0f172a] text-[#fdfaf3] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
            }`}
          >
            {option.icon}
            <span className="hidden sm:inline">{option.label}</span>
            <span className="sr-only sm:hidden">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
