// src/app/games/_components/GameItem.tsx
// A game in the grid (cover card) or the list (compact row).

"use client";

import { focusRing } from "../../components/ui/Button";
import { CONDITION_LABEL, PLAY_LABEL, PRIORITY_LABEL } from "../_lib/games";
import type { UserGame } from "../_lib/types";
import { GameCover, PlatformBadge } from "./GameBits";

const PLAY_DOT: Record<string, string> = {
  playing: "bg-[#c69a3d]",
  completed: "bg-[#7a947c]",
  dropped: "bg-slate-400",
  unplayed: "bg-[#0f172a]/20",
};

function StatusLine({ game }: { game: UserGame }) {
  if (game.status === "wishlist") {
    return (
      <span className={`text-[11px] font-semibold ${game.priority === 1 ? "text-[#a14e43]" : "text-slate-500"}`}>
        {game.priority ? PRIORITY_LABEL[game.priority] : "Wanted"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${PLAY_DOT[game.play_status]}`} />
      {PLAY_LABEL[game.play_status]}
    </span>
  );
}

export function GameCard({ game, onOpen }: { game: UserGame; onOpen: (g: UserGame) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(game)}
      aria-label={`${game.name}, ${game.platform_name}. Open details.`}
      className={`group w-full text-left rounded-2xl ${focusRing}`}
    >
      <div className="relative">
        <GameCover
          src={game.cover_url}
          name={game.name}
          className="shadow-[0_10px_28px_rgba(15,23,42,0.10)] transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
        />
        <span className="absolute top-2 left-2">
          <PlatformBadge id={game.platform_id} name={game.platform_name} solid />
        </span>
        {game.format === "digital" && (
          <span className="absolute top-2 right-2 h-6 px-2 rounded-full bg-[#0f172a]/75 text-[#fdfaf3] text-[10px] font-semibold uppercase tracking-wide flex items-center">Digital</span>
        )}
        {game.status === "owned" && game.play_status === "completed" && (
          <span aria-hidden="true" className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-[#7a947c] text-white text-sm flex items-center justify-center shadow">
            ✓
          </span>
        )}
      </div>
      <p className="mt-2.5 text-sm font-medium text-[#0f172a] leading-snug line-clamp-2">{game.name}</p>
      <p className="mt-1 flex items-center gap-2">
        <StatusLine game={game} />
        {game.edition && <span className="text-[11px] text-slate-400 truncate">{game.edition}</span>}
      </p>
    </button>
  );
}

export function GameRow({ game, onOpen }: { game: UserGame; onOpen: (g: UserGame) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(game)}
      className={`w-full flex items-center gap-3 sm:gap-4 rounded-2xl bg-white/80 border border-[#0f172a]/[0.07] p-2.5 pr-4 text-left hover:border-[#0f172a]/20 hover:bg-white transition-colors ${focusRing}`}
    >
      <GameCover src={game.cover_url} name={game.name} size="small" className="w-11 sm:w-12 shrink-0 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[#0f172a] truncate">{game.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusLine game={game} />
          <span className="text-[11px] text-slate-400">
            {[game.release_year, game.format === "digital" ? "Digital" : game.condition ? CONDITION_LABEL[game.condition] : null, game.edition, game.region]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </span>
      <PlatformBadge id={game.platform_id} name={game.platform_name} />
      <span aria-hidden="true" className="hidden sm:inline text-slate-300 text-xl">›</span>
    </button>
  );
}
