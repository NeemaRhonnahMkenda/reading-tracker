// src/app/reading/_components/ReadingSkeleton.tsx
// Loading state that mirrors the real page: stat tiles, toolbar, the
// Currently reading and Want to read shelves (grid or list), and the stats.
// Each row shows exactly as many placeholders as fit at that screen size,
// so nothing jumps when the books arrive.

import type { CSSProperties } from "react";
import type { ShelfView } from "./ViewToggle";

// A soft light sweep, staggered so it moves across the page like a wave
function Bone({ className = "", delay = 0, width }: { className?: string; delay?: number; width?: string }) {
  const style: CSSProperties = {};
  if (delay) style.animationDelay = `${delay}ms`;
  if (width) style.width = width;
  return <div className={`skeleton-bone ${className}`} style={style} />;
}

// Hide placeholders that wouldn't fit in one row at the current width
const SHELF_VISIBILITY = ["", "", "hidden min-[480px]:block", "hidden md:block", "hidden lg:block", "hidden xl:block"];
const FEATURED_VISIBILITY = ["", "", "hidden sm:block", "hidden lg:block"];

function ShelfHeader({ dot, delay, wide = false }: { dot: string; delay: number; wide?: boolean }) {
  return (
    <div className="flex items-start gap-3 pb-4 mb-5 sm:mb-6 border-b border-[#0f172a]/[0.07]">
      <span className={`mt-2.5 w-2.5 h-2.5 rounded-full shrink-0 opacity-40 ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <Bone className={`h-7 sm:h-8 rounded-full ${wide ? "w-52 sm:w-64" : "w-40 sm:w-48"}`} delay={delay} />
          <Bone className="h-7 w-7 rounded-full" delay={delay + 60} />
        </div>
        <Bone className="mt-2.5 h-3.5 w-36 sm:w-44 rounded-full" delay={delay + 120} />
      </div>
    </div>
  );
}

function GridCard({ delay, featured = false }: { delay: number; featured?: boolean }) {
  return (
    <div>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-[#0f172a]/[0.04]">
        <Bone className="absolute inset-0 rounded-none" delay={delay} />
        {/* Faint spine, like the real covers */}
        <span className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-[#0f172a]/[0.05] to-transparent" />
      </div>
      <Bone className={`mt-3 rounded-full w-4/5 ${featured ? "h-[18px]" : "h-4"}`} delay={delay + 80} />
      <Bone className="mt-2 h-3 w-1/2 rounded-full" delay={delay + 140} />
      {featured && (
        <>
          <div className="mt-3 flex justify-between">
            <Bone className="h-3 w-9 rounded-full" delay={delay + 200} />
            <Bone className="h-3 w-16 rounded-full" delay={delay + 200} />
          </div>
          <Bone className="mt-1.5 h-1.5 w-full rounded-full" delay={delay + 240} />
        </>
      )}
    </div>
  );
}

function ListRow({ delay }: { delay: number }) {
  return (
    <div className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 pr-3 sm:pr-4 rounded-2xl bg-white/60 border border-[#0f172a]/[0.05]">
      <Bone className="w-11 sm:w-12 aspect-[2/3] rounded-md shrink-0" delay={delay} />
      <div className="flex-1 min-w-0 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(9rem,12rem)] sm:items-center sm:gap-6">
        <div>
          <Bone className="h-4 w-3/4 rounded-full" delay={delay + 60} />
          <Bone className="mt-2 h-3 w-1/2 rounded-full" delay={delay + 120} />
        </div>
        <Bone className="mt-2.5 sm:mt-0 h-2.5 w-2/3 sm:w-full rounded-full" delay={delay + 180} />
      </div>
    </div>
  );
}

function Shelf({ view, featured, delay }: { view: ShelfView; featured: boolean; delay: number }) {
  if (view === "list") {
    return (
      <div className="grid gap-2.5 lg:grid-cols-2 lg:gap-x-4">
        {Array.from({ length: featured ? 2 : 4 }).map((_, i) => (
          // Second column only appears on large screens, so hide its extra rows on small ones
          <div key={i} className={i >= 2 ? "hidden lg:block" : ""}>
            <ListRow delay={delay + i * 70} />
          </div>
        ))}
      </div>
    );
  }

  const visibility = featured ? FEATURED_VISIBILITY : SHELF_VISIBILITY;
  return (
    <div
      className={
        featured
          ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 sm:gap-x-7 gap-y-8"
          : "grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 sm:gap-x-6 gap-y-7 sm:gap-y-8"
      }
    >
      {visibility.map((hide, i) => (
        <div key={i} className={hide}>
          <GridCard delay={delay + i * 70} featured={featured} />
        </div>
      ))}
    </div>
  );
}

export default function ReadingSkeleton({ view = "grid" }: { view?: ShelfView }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading your shelves…</span>

      <style>{`
        .skeleton-bone {
          border-radius: 0.75rem;
          background: linear-gradient(100deg,
            rgba(15, 23, 42, 0.05) 20%,
            rgba(15, 23, 42, 0.095) 40%,
            rgba(15, 23, 42, 0.05) 60%);
          background-size: 250% 100%;
          animation: skeleton-sweep 1.7s ease-in-out infinite;
        }
        @keyframes skeleton-sweep {
          from { background-position: 100% 0; }
          to { background-position: -150% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton-bone { animation: none; background: rgba(15, 23, 42, 0.06); }
        }
      `}</style>

      <div aria-hidden="true">
        {/* ---------- Stat tiles ---------- */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {["bg-[#7a947c]", "bg-[#0f172a]", "bg-[#9a86b9]", "bg-[#c69a3d]"].map((accent, i) => (
            <div
              key={accent}
              className="relative overflow-hidden rounded-2xl bg-white/70 border border-[#0f172a]/[0.06] shadow-[0_8px_30px_rgba(15,23,42,0.04)] px-4 sm:px-5 py-4 sm:py-5"
            >
              <span className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full opacity-30 ${accent}`} />
              <Bone className="h-3 w-20 sm:w-24 rounded-full" delay={i * 80} />
              <Bone className="mt-2.5 h-8 sm:h-9 w-12 sm:w-14 rounded-lg" delay={i * 80 + 60} />
              <Bone className="mt-2.5 h-2.5 w-16 sm:w-20 rounded-full" delay={i * 80 + 120} />
            </div>
          ))}
        </div>

        {/* ---------- Toolbar: search + layout toggle ---------- */}
        <div className="mt-8 sm:mt-10 py-3 flex items-center gap-3 border-b border-[#0f172a]/[0.05]">
          <div className="flex-1 max-w-md h-11 rounded-full bg-white border border-[#0f172a]/[0.08] flex items-center gap-3 px-4">
            <span className="w-4 h-4 rounded-full border-2 border-[#0f172a]/10 shrink-0" />
            <Bone className="h-3 w-32 sm:w-40 rounded-full" />
          </div>
          <div className="ml-auto h-12 w-[88px] sm:w-[170px] rounded-full bg-white/80 border border-[#0f172a]/[0.08] p-1 flex gap-1">
            <div className="flex-1 rounded-full bg-[#0f172a]/[0.12]" />
            <div className="flex-1 rounded-full" />
          </div>
        </div>

        {/* ---------- Shelves ---------- */}
        <div className="mt-10 sm:mt-12 space-y-14 sm:space-y-16">
          <section>
            <ShelfHeader dot="bg-[#7a947c]" delay={200} wide />
            <Shelf view={view} featured delay={260} />
          </section>

          <section>
            <ShelfHeader dot="bg-[#9a86b9]" delay={400} />
            <Shelf view={view} featured={false} delay={460} />
          </section>
        </div>

        {/* ---------- Stats preview ---------- */}
        <div className="mt-20 sm:mt-24">
          <Bone className="h-3 w-24 rounded-full" delay={600} />
          <Bone className="mt-3 h-8 sm:h-10 w-64 sm:w-80 max-w-full rounded-full" delay={640} />

          <div className="mt-6 sm:mt-8 grid gap-4 sm:gap-5 lg:grid-cols-5">
            {/* Year chart */}
            <div className="lg:col-span-3 rounded-[1.6rem] bg-white/70 border border-[#0f172a]/[0.06] p-5 sm:p-6">
              <Bone className="h-3 w-20 rounded-full" delay={700} />
              <Bone className="mt-2.5 h-6 w-40 rounded-full" delay={720} />
              <div className="mt-5 space-y-2.5">
                {/* Bars at different lengths read as a chart, not a block */}
                {[85, 60, 40, 25].map((width, i) => (
                  <div key={width} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-3">
                    <Bone className="h-3.5 w-12 rounded-full" delay={760 + i * 60} />
                    <div className="h-7 rounded-lg bg-[#0f172a]/[0.03]">
                      <Bone className="h-full rounded-lg" delay={760 + i * 60} width={`${width}%`} />
                    </div>
                    <Bone className="h-3.5 w-5 ml-auto rounded-full" delay={760 + i * 60} />
                  </div>
                ))}
              </div>
            </div>

            {/* Review ring */}
            <div className="lg:col-span-2 rounded-[1.6rem] bg-white/70 border border-[#0f172a]/[0.06] p-5 sm:p-6">
              <Bone className="h-3 w-16 rounded-full" delay={720} />
              <Bone className="mt-2.5 h-6 w-44 rounded-full" delay={740} />
              <div className="mt-5 flex items-center gap-5">
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-full border-[10px] border-[#0f172a]/[0.06]" />
                <div className="flex-1 space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <Bone className="h-3 w-24 rounded-full" delay={800 + i * 60} />
                      <Bone className="h-3 w-5 rounded-full" delay={800 + i * 60} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
