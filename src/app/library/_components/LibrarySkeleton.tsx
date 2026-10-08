// src/app/library/_components/LibrarySkeleton.tsx
// Placeholder cards or rows in the same layout as the real grid/list.

import type { ShelfView } from "../../reading/_components/ViewToggle";
import { LIBRARY_GRID, LIBRARY_LIST } from "./layout";

const bone = "bg-[#0f172a]/[0.06] animate-pulse motion-reduce:animate-none";

export default function LibrarySkeleton({ view, count = 12 }: { view: ShelfView; count?: number }) {
  if (view === "list") {
    return (
      <div className={LIBRARY_LIST} aria-hidden="true">
        {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-3 rounded-2xl bg-white/60 border border-[#0f172a]/[0.05]">
            <div className={`w-12 sm:w-14 aspect-[2/3] rounded-md shrink-0 ${bone}`} />
            <div className="flex-1 space-y-2">
              <div className={`h-4 w-3/5 rounded-full ${bone}`} />
              <div className={`h-3 w-2/5 rounded-full ${bone}`} />
            </div>
            <div className={`hidden md:block h-6 w-20 rounded-full ${bone}`} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={LIBRARY_GRID} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}>
          <div className={`aspect-[2/3] rounded-xl ${bone}`} />
          <div className={`mt-3 h-4 w-4/5 rounded-full ${bone}`} />
          <div className={`mt-2 h-3 w-1/2 rounded-full ${bone}`} />
          <div className={`mt-2.5 h-6 w-20 rounded-full ${bone}`} />
        </div>
      ))}
    </div>
  );
}
