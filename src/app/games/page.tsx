// src/app/games/page.tsx
// Games collection: the PlayStation and Nintendo games you own and the ones you
// want. Add them by scanning the barcode on the case, typing the box code, or
// searching by name.

"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import Button from "../components/ui/Button";
import Toast, { useToast } from "../components/ui/Toast";
import { supabase } from "../../lib/supabase";
import { errorMessage, loadGames } from "./_lib/games";
import { platformById } from "./_lib/platforms";
import { words } from "./_lib/match";
import type { GameStatus, UserGame } from "./_lib/types";
import AddGameSheet from "./_components/AddGameSheet";
import GameDetailSheet from "./_components/GameDetailSheet";
import GamesStats from "./_components/GamesStats";
import GamesToolbar, { DEFAULT_FILTERS, type Filters, type View } from "./_components/GamesToolbar";
import { GameCard, GameRow } from "./_components/GameItem";
import { GamesNothingHere, GamesSkeleton, GamesWelcome } from "./_components/GamesEmpty";
import { CatalogCredit } from "./_components/GameBits";

const VIEW_KEY = "archive:games-view";

function sortGames(list: UserGame[], sort: Filters["sort"]) {
  const out = [...list];
  const byName = (a: UserGame, b: UserGame) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  switch (sort) {
    case "name":
      return out.sort(byName);
    case "release":
      return out.sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0) || byName(a, b));
    case "platform":
      return out.sort((a, b) => (platformById(a.platform_id)?.name ?? a.platform_name).localeCompare(platformById(b.platform_id)?.name ?? b.platform_name) || byName(a, b));
    case "priority":
      return out.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || b.created_at.localeCompare(a.created_at));
    default:
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}

export default function GamesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [games, setGames] = useState<UserGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const deferredQ = useDeferredValue(filters.q);
  const [view, setView] = useState<View>("grid");

  const [adding, setAdding] = useState<{ mode: "scan" | "search" | "code" } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setGames(await loadGames());
    } catch (e) {
      setLoadError(errorMessage(e, "Your games couldn't be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "list") setView(v);
    } catch {
      // storage unavailable
    }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        window.location.replace("/login?next=/games");
        return;
      }
      setUserId(user.id);
      load();
    });
  }, [load]);

  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable
    }
  }

  // ---------- Filtering ----------
  const counts = useMemo(
    () => ({ owned: games.filter((g) => g.status === "owned").length, wishlist: games.filter((g) => g.status === "wishlist").length }),
    [games]
  );

  const inTab = useMemo(() => games.filter((g) => g.status === filters.tab), [games, filters.tab]);
  const platformsInUse = useMemo(() => [...new Set(inTab.map((g) => g.platform_id))], [inTab]);

  const shown = useMemo(() => {
    const q = words(deferredQ);
    const list = inTab.filter((g) => {
      const p = platformById(g.platform_id);
      if (filters.family !== "all" && p?.family !== filters.family) return false;
      if (filters.platform !== "all" && g.platform_id !== filters.platform) return false;
      if (filters.play !== "all" && g.play_status !== filters.play) return false;
      if (filters.format !== "all" && g.format !== filters.format) return false;
      if (q.length) {
        const hay = words(`${g.name} ${g.edition ?? ""} ${p?.name ?? ""} ${p?.short ?? ""} ${g.genres.join(" ")}`).join(" ");
        if (!q.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    return sortGames(list, filters.sort);
  }, [inTab, filters, deferredQ]);

  const filtered = !!(filters.q || filters.family !== "all" || filters.platform !== "all" || filters.play !== "all" || filters.format !== "all");
  const openGame = games.find((g) => g.id === openId) ?? null;

  // ---------- Changes from the sheets ----------
  function upsertLocal(row: UserGame) {
    setGames((cur) => (cur.some((g) => g.id === row.id) ? cur.map((g) => (g.id === row.id ? row : g)) : [row, ...cur]));
  }

  function onSaved(row: UserGame, action: "added" | "updated" | "moved") {
    upsertLocal(row);
    const where = row.status === "owned" ? "collection" : "wishlist";
    const label = `${row.name} (${platformById(row.platform_id)?.short ?? row.platform_name})`;
    showToast("success", action === "added" ? `${label} added to your ${where}.` : action === "moved" ? `${label} moved to your ${where}.` : `${label} updated.`);
  }

  const startAdd = (mode: "scan" | "search" | "code") => setAdding({ mode });
  const addStatus: GameStatus = filters.tab;

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] overflow-x-clip">
      <Navbar isLoggedIn={!!userId || undefined} />

      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-28">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="tracking-[0.25em] uppercase text-xs sm:text-sm text-[#7a947c] font-medium mb-3">PlayStation &amp; Nintendo</p>
            <h1 className="font-classical text-[2.6rem] leading-[1.05] sm:text-6xl font-semibold">Games collection</h1>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-600 font-light max-w-xl">What you own, what you&apos;re playing, and what you&apos;re hoping to get next.</p>
          </div>
          {games.length > 0 && (
            <div className="flex gap-2.5 shrink-0">
              <Button variant="outline" onClick={() => startAdd("search")}>
                Search
              </Button>
              <Button variant="dark" onClick={() => startAdd("scan")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
                </svg>
                Scan a game
              </Button>
            </div>
          )}
        </header>

        <div className="mt-8 sm:mt-10">
          {loading ? (
            <GamesSkeleton />
          ) : loadError ? (
            <div className="rounded-[1.6rem] bg-[#fbefed] border border-red-200/70 px-6 py-10 text-center">
              <p className="font-classical text-xl text-[#8f3b31]">{loadError}</p>
              <p className="mt-2 text-sm text-slate-500">If this is the first time, check games.sql has been run in Supabase.</p>
              <Button variant="outline" className="mt-5" onClick={load}>
                Try again
              </Button>
            </div>
          ) : games.length === 0 ? (
            <GamesWelcome onScan={() => startAdd("scan")} onSearch={() => startAdd("search")} />
          ) : (
            <div className="space-y-8">
              <GamesStats games={games} />
              <GamesToolbar
                filters={filters}
                onChange={setFilters}
                counts={counts}
                platformsInUse={platformsInUse}
                view={view}
                onView={changeView}
                shown={shown.length}
              />
              {shown.length === 0 ? (
                <GamesNothingHere tab={filters.tab} filtered={filtered} onAdd={() => startAdd("scan")} onClear={() => setFilters({ ...DEFAULT_FILTERS, tab: filters.tab })} />
              ) : view === "grid" ? (
                <ul className="grid grid-cols-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-7">
                  {shown.map((g) => (
                    <li key={g.id}>
                      <GameCard game={g} onOpen={(x) => setOpenId(x.id)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-2">
                  {shown.map((g) => (
                    <li key={g.id}>
                      <GameRow game={g} onOpen={(x) => setOpenId(x.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <CatalogCredit catalogs={games.map((g) => g.catalog)} />
      </div>

      {/* Quick scan button on phones */}
      {games.length > 0 && !adding && !openId && (
        <button
          type="button"
          onClick={() => startAdd("scan")}
          aria-label="Scan a game"
          className="sm:hidden fixed bottom-6 right-5 z-40 w-14 h-14 rounded-full bg-[#7a947c] text-white shadow-[0_12px_30px_rgba(122,148,124,0.45)] flex items-center justify-center active:scale-95 transition-transform outline-none focus-visible:ring-2 focus-visible:ring-[#0f172a] focus-visible:ring-offset-2"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
          </svg>
        </button>
      )}

      {userId && (
        <AddGameSheet
          open={!!adding}
          onClose={() => setAdding(null)}
          userId={userId}
          existing={games}
          defaultStatus={addStatus}
          initialMode={adding?.mode ?? "scan"}
          onSaved={onSaved}
        />
      )}

      <GameDetailSheet
        game={openGame}
        others={games}
        onClose={() => setOpenId(null)}
        onChanged={(row, action) => {
          upsertLocal(row);
          showToast("success", action === "moved" ? `${row.name} moved to your ${row.status === "owned" ? "collection" : "wishlist"}.` : "Saved.");
        }}
        onRemoved={(row) => {
          setGames((cur) => cur.filter((g) => g.id !== row.id));
          setOpenId(null);
          showToast("success", `${row.name} removed.`);
        }}
      />

      <Toast toast={toast} onDismiss={dismissToast} />
    </main>
  );
}
