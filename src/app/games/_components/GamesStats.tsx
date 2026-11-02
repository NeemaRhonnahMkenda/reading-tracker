// src/app/games/_components/GamesStats.tsx
// A few numbers worth seeing: how many you own and want, how far through the
// backlog you are, and which consoles the collection lives on.

import { platformById } from "../_lib/platforms";
import type { UserGame } from "../_lib/types";
import { PlatformBadge } from "./GameBits";

export default function GamesStats({ games }: { games: UserGame[] }) {
  const owned = games.filter((g) => g.status === "owned");
  const wishlist = games.length - owned.length;
  const completed = owned.filter((g) => g.play_status === "completed").length;
  const playing = owned.filter((g) => g.play_status === "playing");
  const backlog = owned.filter((g) => g.play_status === "unplayed").length;
  const pct = owned.length ? Math.round((completed / owned.length) * 100) : 0;

  const perPlatform = new Map<number, number>();
  owned.forEach((g) => perPlatform.set(g.platform_id, (perPlatform.get(g.platform_id) ?? 0) + 1));
  const platforms = [...perPlatform.entries()].sort((a, b) => b[1] - a[1]);
  const top = platforms[0]?.[1] ?? 0;
  const sony = owned.filter((g) => platformById(g.platform_id)?.family === "playstation").length;

  return (
    <section aria-label="Collection at a glance" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile label="In your collection" value={owned.length} note={owned.length ? `${owned.filter((g) => g.format === "physical").length} physical · ${owned.filter((g) => g.format === "digital").length} digital` : "Nothing yet"} />
      <Tile label="On your wishlist" value={wishlist} note={wishlist ? plural(games.filter((g) => g.status === "wishlist" && g.priority === 1).length, "must-have") : "Add games you want"} />

      <div className="col-span-2 lg:col-span-1 rounded-3xl bg-white/80 border border-[#0f172a]/[0.07] p-4 sm:p-5">
        <p className="text-xs font-semibold tracking-wide uppercase text-slate-500">Finished</p>
        <p className="mt-1 font-classical text-3xl font-semibold text-[#0f172a] tabular-nums">
          {pct}
          <span className="text-lg text-slate-400">%</span>
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-[#0f172a]/[0.06] overflow-hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-[#7a947c]" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-slate-500 truncate">
          {playing.length ? `Playing ${playing[0].name}${playing.length > 1 ? ` +${playing.length - 1}` : ""}` : `${backlog} not started`}
        </p>
      </div>

      <div className="rounded-3xl bg-[#0f172a] text-[#fdfaf3] p-4 sm:p-5 col-span-2 lg:col-span-1">
        <p className="text-xs font-semibold tracking-wide uppercase text-[#fdfaf3]/60">By console</p>
        {platforms.length === 0 ? (
          <p className="mt-2 text-sm text-[#fdfaf3]/60">Your consoles will show here.</p>
        ) : (
          <>
            <ul className="mt-2.5 space-y-1.5">
              {platforms.slice(0, 4).map(([id, n]) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0">
                    <PlatformBadge id={id} solid />
                  </span>
                  <span className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                    <span className="block h-full rounded-full bg-[#e8c873]" style={{ width: `${(n / top) * 100}%` }} />
                  </span>
                  <span className="w-6 text-right text-xs tabular-nums text-[#fdfaf3]/80">{n}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-[#fdfaf3]/55">
              {sony} PlayStation · {owned.length - sony} Nintendo
              {platforms.length > 4 ? ` · ${platforms.length} consoles` : ""}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-3xl bg-white/80 border border-[#0f172a]/[0.07] p-4 sm:p-5">
      <p className="text-xs font-semibold tracking-wide uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-classical text-3xl font-semibold text-[#0f172a] tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-slate-500 truncate">{note}</p>
    </div>
  );
}

