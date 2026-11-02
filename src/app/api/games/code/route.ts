// src/app/api/games/code/route.ts
// GET /api/games/code?code=0711719541028
// What a barcode or box product code (CUSA-07408, HAC-P-AAAAA...) is.
//   1. Answers people have already confirmed for this exact code (most reliable)
//   2. For barcodes: what shops call it (PriceCharting, a Google/Brave web
//      search for the barcode, UPCitemdb), cleaned up and matched against IGDB
//      on the right platform
// The page always asks the person to confirm, then records their answer.

import { NextRequest, NextResponse } from "next/server";
import { detectPlatform, parseCode, platformById } from "../../../games/_lib/platforms";
import { cleanProductTitle, detectEdition, detectRegion, scoreGame } from "../../../games/_lib/match";
import type { Catalog, CodeLookup, CommunityMatch, GameResult, RankedGame } from "../../../games/_lib/types";
import { CatalogNotConfigured, notConfigured, jsonError, jsonOk, rateLimited, requireUser } from "../_lib/server";
import { gamesById, searchGames } from "../_lib/catalog";
import { productForBarcode } from "../_lib/products";

interface VoteRow {
  catalog: Catalog;
  game_id: number;
  platform_id: number;
  edition: string | null;
  region: string | null;
  votes: number;
  mine: boolean;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const limited = rateLimited(auth.user.id);
  if (limited) return limited;

  const raw = request.nextUrl.searchParams.get("code") ?? "";
  if (raw.length > 30) return jsonError("That code is too long.", 400);
  const parsed = parseCode(raw);
  if (!parsed) return jsonError("That doesn't look like a barcode or product code. Check the digits and try again.", 400);

  const result: CodeLookup = {
    code: parsed.code,
    kind: parsed.kind,
    platformHint: parsed.platformHint,
    edition: null,
    region: null,
    community: [],
    product: null,
    searchedFor: null,
    suggestions: [],
  };

  try {
    // 1. Confirmed answers (totals only; the function never reveals who voted)
    const { data: votes, error } = await auth.supabase.rpc("resolve_game_code", { p_code: parsed.code });
    if (error) console.error("resolve_game_code failed", error.message);
    // Each answer is fetched from the catalogue it was saved from (ids differ
    // between them); answers from a catalogue that isn't set up drop out
    const rows = ((votes ?? []) as VoteRow[]).filter((v) => platformById(v.platform_id)).slice(0, 5);
    if (rows.length) {
      const byCatalog = new Map<Catalog, Map<number, GameResult>>();
      for (const c of [...new Set(rows.map((r) => r.catalog ?? "igdb"))]) {
        byCatalog.set(c, await gamesById(c, rows.filter((r) => (r.catalog ?? "igdb") === c).map((r) => r.game_id)));
      }
      result.community = rows
        .map((r): CommunityMatch | null => {
          const game = byCatalog.get(r.catalog ?? "igdb")?.get(r.game_id);
          return game
            ? { game, platformId: r.platform_id, edition: r.edition, region: r.region, votes: r.votes, mine: r.mine }
            : null;
        })
        .filter((m): m is CommunityMatch => m !== null);
      // A clear, agreed answer: no need to spend barcode-database quota
      const top = result.community[0];
      if (top && (top.mine || top.votes >= 2)) return jsonOk(result);
    }

    // 2. What shops call it (barcode databases, then a web search like Google's)
    if (parsed.kind === "barcode") {
      const product = await productForBarcode(parsed.code);
      if (product) {
        const label = `${product.console ?? ""} ${product.titles.join(" ")}`;
        result.product = { title: product.titles[0], source: product.source };
        result.platformHint = product.platformId ?? detectPlatform(product.console) ?? detectPlatform(label);
        result.edition = product.edition ?? detectEdition(product.titles[0]);
        result.region = (product.region as CodeLookup["region"]) ?? detectRegion(label);

        const phrases = [...new Set(product.titles.map(cleanProductTitle).filter((p) => p.length >= 2))].slice(0, 3);
        if (phrases.length) {
          result.searchedFor = phrases[0];
          const hint = result.platformHint;
          const pool = hint ? [hint] : [];
          // Search each wording (IGDB matches whole words, so shop noise can hide a game)
          const found = new Map<number, GameResult>();
          for (const phrase of phrases) {
            let games = await searchGames(phrase, pool, 10);
            if (!games.length && hint) games = await searchGames(phrase, [], 10);
            games.forEach((g) => found.set(g.gameId, g));
            // A near-certain hit on the first wording is enough
            if (games.some((g) => scoreGame(g, phrase, hint) >= 0.92)) break;
          }
          result.suggestions = [...found.values()]
            .map((g): RankedGame => ({ ...g, score: scoreGame(g, phrases, hint) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 6);
        }
      }
    }

    return jsonOk(result);
  } catch (error) {
    if (error instanceof CatalogNotConfigured) return notConfigured(error);
    console.error("game code lookup failed", error);
    return jsonError("Couldn't look that code up right now. Try again, or search by name.", 502);
  }
}
