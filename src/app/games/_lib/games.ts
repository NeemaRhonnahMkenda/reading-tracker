// src/app/games/_lib/games.ts
// Reading and writing your games, and calling the games API.

import { supabase } from "../../../lib/supabase";
import { platformById } from "./platforms";
import { safeCoverUrl, type CodeLookup, type Condition, type GameFormat, type GameResult, type GameStatus, type PlayStatus, type RankedGame, type Region, type UserGame } from "./types";

export const GAME_COLUMNS =
  "id, catalog, game_id, name, slug, cover_url, release_year, genres, platform_id, platform_name, status, format, edition, region, condition, play_status, priority, code, notes, acquired_on, created_at, updated_at";

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const e = error as { message: string; code?: string };
    if (e.code === "23505") return "That game is already in your list on this platform and edition.";
    if (e.code === "23514") return "One of the details isn't valid. Check them and try again.";
    if (/JWT|session/i.test(e.message)) return "Your session ended. Sign in again.";
    return e.message.length < 160 ? e.message : fallback;
  }
  return fallback;
}

// ------------------------------------------------------------
// API
// ------------------------------------------------------------

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" }, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong. Try again.");
  return data as T;
}

export function searchCatalogue(q: string, platforms: number[], signal?: AbortSignal) {
  const params = new URLSearchParams({ q });
  if (platforms.length) params.set("platforms", platforms.join(","));
  return getJson<{ results: RankedGame[] }>(`/api/games/search?${params}`, signal).then((d) => d.results);
}

export function lookupCode(code: string, signal?: AbortSignal) {
  return getJson<CodeLookup>(`/api/games/code?code=${encodeURIComponent(code)}`, signal);
}

// ------------------------------------------------------------
// Database
// ------------------------------------------------------------

export async function loadGames(): Promise<UserGame[]> {
  const { data, error } = await supabase.from("user_games").select(GAME_COLUMNS).order("created_at", { ascending: false }).limit(2000);
  if (error) throw error;
  return (data ?? []) as UserGame[];
}

export interface CopyDetails {
  platformId: number;
  status: GameStatus;
  format: GameFormat;
  edition: string | null;
  region: Region | null;
  condition: Condition | null;
  playStatus: PlayStatus;
  priority: number | null;
  notes: string | null;
  acquiredOn: string | null;
}

function tidy(text: string | null | undefined, max: number) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function copyColumns(d: CopyDetails) {
  const physical = d.format === "physical";
  return {
    platform_id: d.platformId,
    platform_name: platformById(d.platformId)?.name ?? "Other",
    status: d.status,
    format: d.format,
    edition: tidy(d.edition, 80),
    region: physical ? d.region : null,
    condition: physical && d.status === "owned" ? d.condition : null,
    play_status: d.status === "owned" ? d.playStatus : "unplayed",
    priority: d.status === "wishlist" ? (d.priority ?? 2) : null,
    notes: d.notes ? d.notes.trim().slice(0, 1000) || null : null,
    acquired_on: d.status === "owned" ? d.acquiredOn || null : null,
  };
}

/** Adds a game, and if it came from a code, records which game that code is. */
export async function addGame(
  userId: string,
  game: GameResult,
  details: CopyDetails,
  code: { code: string; kind: "barcode" | "product" } | null
): Promise<UserGame> {
  const { data, error } = await supabase
    .from("user_games")
    .insert({
      user_id: userId,
      catalog: game.catalog,
      game_id: game.gameId,
      name: game.name.slice(0, 300),
      slug: game.slug,
      cover_url: safeCoverUrl(game.coverUrl),
      release_year: game.releaseYear,
      genres: game.genres.slice(0, 12),
      code: code?.code ?? null,
      ...copyColumns(details),
    })
    .select(GAME_COLUMNS)
    .single();
  if (error) throw error;

  if (code) await recordCode(userId, code, game, details);
  return data as UserGame;
}

/** Your answer for what a code is. One per person per code; changing it replaces it. */
export async function recordCode(
  userId: string,
  code: { code: string; kind: "barcode" | "product" },
  game: Pick<GameResult, "catalog" | "gameId">,
  details: Pick<CopyDetails, "platformId" | "edition" | "region" | "format">
) {
  const { error } = await supabase.from("game_code_votes").upsert(
    {
      user_id: userId,
      code: code.code,
      code_kind: code.kind,
      catalog: game.catalog,
      game_id: game.gameId,
      platform_id: details.platformId,
      edition: tidy(details.edition, 80),
      region: details.format === "physical" ? details.region : null,
    },
    { onConflict: "user_id,code" }
  );
  // The game is saved either way; a missed vote only means the next scan asks again
  if (error) console.warn("Couldn't record the code", error.message);
}

export async function updateGame(id: string, details: CopyDetails): Promise<UserGame> {
  const { data, error } = await supabase.from("user_games").update(copyColumns(details)).eq("id", id).select(GAME_COLUMNS).single();
  if (error) throw error;
  return data as UserGame;
}

export async function setPlayStatus(id: string, playStatus: PlayStatus) {
  const { error } = await supabase.from("user_games").update({ play_status: playStatus }).eq("id", id);
  if (error) throw error;
}

export async function removeGame(id: string) {
  const { error } = await supabase.from("user_games").delete().eq("id", id);
  if (error) throw error;
}

export function detailsFrom(g: UserGame): CopyDetails {
  return {
    platformId: g.platform_id,
    status: g.status,
    format: g.format,
    edition: g.edition,
    region: g.region,
    condition: g.condition,
    playStatus: g.play_status,
    priority: g.priority,
    notes: g.notes,
    acquiredOn: g.acquired_on,
  };
}

export function gameFromRow(g: UserGame): GameResult {
  return {
    catalog: g.catalog,
    gameId: g.game_id,
    name: g.name,
    slug: g.slug,
    coverUrl: g.cover_url,
    releaseYear: g.release_year,
    platforms: [g.platform_id],
    genres: g.genres,
    summary: null,
  };
}

// ------------------------------------------------------------
// Labels
// ------------------------------------------------------------

export const PLAY_LABEL: Record<PlayStatus, string> = {
  unplayed: "Not started",
  playing: "Playing",
  completed: "Completed",
  dropped: "Stopped",
};

export const CONDITION_LABEL: Record<Condition, string> = {
  sealed: "Sealed",
  complete: "Complete in box",
  game_only: "Game + case",
  loose: "Disc / cart only",
};

export const PRIORITY_LABEL: Record<number, string> = { 1: "Must have", 2: "Want", 3: "Maybe" };

export const REGIONS: Region[] = ["PAL", "NTSC-U", "NTSC-J", "Asia", "Other"];
