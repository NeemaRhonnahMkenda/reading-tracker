// src/app/games/_components/GamesEmpty.tsx
// First-visit welcome, empty tab, and the loading skeleton.

import Button from "../../components/ui/Button";

export function GamesWelcome({ onScan, onSearch }: { onScan: () => void; onSearch: () => void }) {
  return (
    <section className="rounded-[2rem] bg-[#0f172a] text-[#fdfaf3] overflow-hidden">
      <div className="grid md:grid-cols-[1.2fr_1fr]">
        <div className="p-7 sm:p-10">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#e8c873]">Games collection</p>
          <h2 className="mt-3 font-classical text-3xl sm:text-4xl font-semibold leading-tight">Every game on your shelf, and every one you&apos;re hoping for.</h2>
          <p className="mt-4 text-sm sm:text-base text-[#fdfaf3]/70 leading-7 max-w-md">
            Scan the barcode on the back of a PlayStation or Nintendo case and it&apos;s added in seconds. No barcode? Search by name.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="primary" size="lg" onClick={onScan}>
              Scan your first game
            </Button>
            <Button variant="outline" size="lg" onClick={onSearch} className="!bg-transparent !text-[#fdfaf3] !border-white/25 hover:!bg-white/10">
              Search by name
            </Button>
          </div>
        </div>
        <ol className="p-7 sm:p-10 md:border-l border-t md:border-t-0 border-white/10 space-y-5 text-sm">
          {[
            ["Scan", "Fit the barcode in the frame. We check it's read correctly before looking it up."],
            ["Confirm", "Pick the right game and console. Your answer teaches the scanner for next time."],
            ["Keep track", "Collection or wishlist, physical or digital, edition, region and how far you've played."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-4">
              <span className="shrink-0 w-8 h-8 rounded-full bg-white/10 text-[#e8c873] font-semibold flex items-center justify-center">{i + 1}</span>
              <span>
                <span className="block font-semibold">{t}</span>
                <span className="block mt-0.5 text-[#fdfaf3]/60 leading-6">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function GamesNothingHere({ tab, filtered, onAdd, onClear }: { tab: "owned" | "wishlist"; filtered: boolean; onAdd: () => void; onClear: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#0f172a]/15 bg-white/50 px-6 py-14 text-center">
      <p className="font-classical text-xl text-[#0f172a]">{filtered ? "No games match these filters" : tab === "owned" ? "Your collection is empty" : "Your wishlist is empty"}</p>
      <p className="mt-2 text-sm text-slate-500">
        {filtered ? "Try a different console or clear the filters." : tab === "owned" ? "Scan or search for a game you own." : "Add games you'd like to get, and move them across when you do."}
      </p>
      <div className="mt-5 flex justify-center">
        {filtered ? (
          <Button variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        ) : (
          <Button variant="dark" onClick={onAdd}>
            {tab === "owned" ? "Add a game" : "Add to wishlist"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function GamesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your games" className="space-y-8 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-32 rounded-3xl bg-[#0f172a]/[0.05]" />
        ))}
      </div>
      <div className="h-10 w-64 rounded-full bg-[#0f172a]/[0.05]" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-7">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i}>
            <div className="aspect-[3/4] rounded-xl bg-[#0f172a]/[0.06]" />
            <div className="mt-3 h-3 w-4/5 rounded bg-[#0f172a]/[0.05]" />
            <div className="mt-2 h-3 w-1/2 rounded bg-[#0f172a]/[0.04]" />
          </div>
        ))}
      </div>
    </div>
  );
}
