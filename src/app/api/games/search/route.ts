// src/app/api/games/search/route.ts
// GET /api/games/search?q=zelda&platforms=130,508
// PlayStation / Nintendo games matching a name, best match first.

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PLATFORM_IDS } from "../../../games/_lib/platforms";
import { scoreGame } from "../../../games/_lib/match";
import type { RankedGame } from "../../../games/_lib/types";
import { CatalogNotConfigured, notConfigured, jsonError, jsonOk, rateLimited, requireUser } from "../_lib/server";
import { searchGames, searchGamesLoose } from "../_lib/catalog";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const limited = rateLimited(auth.user.id);
  if (limited) return limited;

  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length < 2) return jsonError("Type at least 2 characters to search.", 400);
  if (q.length > 100) return jsonError("That search is too long. Shorten it and try again.", 400);

  const platforms = (params.get("platforms") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => PLATFORM_IDS.includes(n));
  const hint = platforms.length === 1 ? platforms[0] : null;

  try {
    let games = await searchGames(q, platforms, 25);
    // Nothing for the exact words (typo, missing colon, partial name): look wider
    if (!games.length) games = await searchGamesLoose(q, platforms, 25);
    // The catalogue's own order knows what's popular; blend it with how close the name is
    const ranked: RankedGame[] = games
      .map((g, i) => {
        const score = scoreGame(g, q, hint);
        return { ...g, score, rank: score * 0.7 + (1 - i / games.length) * 0.3 };
      })
      .sort((a, b) => b.rank - a.rank)
      .map(({ rank: _rank, ...g }) => g);
    return jsonOk({ results: ranked });
  } catch (error) {
    if (error instanceof CatalogNotConfigured) return notConfigured(error);
    console.error("games search failed", error);
    return jsonError("The games catalogue isn't responding. Try again in a moment.", 502);
  }
}
