// src/app/games/_components/AddGameSheet.tsx
// Add a game three ways:
//   Scan     point the camera at the barcode on the back of the case
//   Search   type the name
//   Code     type the barcode numbers or the product code (CUSA-07408, HAC-P-AAAAA)
// Every match is confirmed before it's saved. When a game came from a code,
// your confirmation is remembered, so that code is instant for everyone next time.

"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import Spinner from "../../components/ui/Spinner";
import { addGame, errorMessage, lookupCode, recordCode, searchCatalogue, updateGame, type CopyDetails } from "../_lib/games";
import { FAMILY_LABEL, PLATFORMS, familyIds, parseCode, platformById, type Family } from "../_lib/platforms";
import type { CodeLookup, GameResult, GameStatus, RankedGame, Region, UserGame } from "../_lib/types";
import BarcodeScanner from "./BarcodeScanner";
import CopyForm from "./CopyForm";
import { CatalogCredit, Chip, ConfidencePill, GameCover, PlatformBadge, Segmented, inputClass } from "./GameBits";

type Mode = "scan" | "search" | "code";
type Step = "find" | "pick" | "details";

interface Chosen {
  game: GameResult;
  code: { code: string; kind: "barcode" | "product" } | null;
  platformHint: number | null;
  via: string | null; // "Confirmed by 4 people", "Matched from the barcode"...
}

function defaultDetails(
  game: GameResult,
  status: GameStatus,
  hint: number | null,
  extra: { edition?: string | null; region?: string | null; physical?: boolean },
  usage: Map<number, number>
): CopyDetails {
  const fromGame = PLATFORMS.filter((p) => game.platforms.includes(p.id));
  // No hint from a code: the console you have most games on, then the newest
  const favourite = [...fromGame].sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0))[0];
  const platformId =
    (hint && (game.platforms.includes(hint) || !game.platforms.length) ? hint : null) ??
    (favourite && (usage.get(favourite.id) ?? 0) > 0 ? favourite.id : null) ??
    fromGame.find((p) => p.current)?.id ??
    fromGame[0]?.id ??
    hint ??
    167;
  return {
    platformId,
    status,
    format: extra.physical === false ? "digital" : "physical",
    edition: extra.edition ?? null,
    region: (extra.region as Region | null) ?? null,
    condition: null,
    playStatus: "unplayed",
    priority: status === "wishlist" ? 2 : null,
    notes: null,
    acquiredOn: null,
  };
}

export default function AddGameSheet({
  open,
  onClose,
  userId,
  existing,
  defaultStatus,
  initialMode = "scan",
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  existing: UserGame[];
  defaultStatus: GameStatus;
  initialMode?: Mode;
  onSaved: (row: UserGame, action: "added" | "updated" | "moved") => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("find");
  const [cameraError, setCameraError] = useState("");
  const [error, setError] = useState("");

  // Code lookup
  const [looking, setLooking] = useState(false);
  const [lookup, setLookup] = useState<CodeLookup | null>(null);
  const [codeText, setCodeText] = useState("");
  const pendingCode = useRef<{ code: string; kind: "barcode" | "product"; platformHint: number | null } | null>(null);
  const originMode = useRef<Mode>(initialMode); // where to go back to after saving
  const [, rerender] = useState(0);

  // Name search
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<Family | "all">("all");
  const [results, setResults] = useState<RankedGame[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Details
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [details, setDetails] = useState<CopyDetails | null>(null);
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  // Fresh start each time it opens
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setStep("find");
    setError("");
    setCameraError("");
    setLookup(null);
    setCodeText("");
    setQuery("");
    setResults([]);
    setChosen(null);
    setDetails(null);
    setAddedCount(0);
    pendingCode.current = null;
    originMode.current = initialMode;
  }, [open, initialMode]);

  // ---------- Name search (debounced) ----------
  useEffect(() => {
    if (mode !== "search" || step !== "find") return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        setResults(await searchCatalogue(q, family === "all" ? [] : familyIds(family), controller.signal));
      } catch (e) {
        if (!controller.signal.aborted) setSearchError(errorMessage(e));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, family, mode, step]);

  useEffect(() => {
    if (mode === "search" && step === "find") requestAnimationFrame(() => searchRef.current?.focus());
  }, [mode, step]);

  // ---------- Codes ----------
  // The case you just saved is probably still in front of the camera
  const justSaved = useRef<{ code: string; at: number } | null>(null);

  function onScanned(raw: string) {
    const parsed = parseCode(raw);
    const recent = justSaved.current;
    if (parsed && recent && recent.code === parsed.code && Date.now() - recent.at < 8000) return;
    runLookup(raw);
  }

  async function runLookup(raw: string) {
    const parsed = parseCode(raw);
    if (!parsed) {
      setError("That doesn't look like a barcode or product code. Check it and try again.");
      return;
    }
    setError("");
    originMode.current = mode;
    setLooking(true);
    setStep("pick");
    setLookup(null);
    pendingCode.current = { code: parsed.code, kind: parsed.kind, platformHint: parsed.platformHint };
    try {
      const found = await lookupCode(parsed.code);
      setLookup(found);
      pendingCode.current = { code: found.code, kind: found.kind, platformHint: found.platformHint };

      // Clear answers skip straight to the details
      const top = found.community[0];
      if (top && (top.mine || top.votes >= 3)) {
        choose(top.game, {
          platformHint: top.platformId,
          edition: top.edition,
          region: top.region,
          via: top.mine ? "You matched this code before" : `Confirmed by ${top.votes} people`,
        });
        return;
      }
      const best = found.suggestions[0];
      const second = found.suggestions[1];
      if (!found.community.length && best && best.score >= 0.92 && found.platformHint && (!second || best.score - second.score > 0.15)) {
        choose(best, { platformHint: found.platformHint, edition: found.edition, region: found.region, via: "Matched from the barcode" });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLooking(false);
    }
  }

  function searchInstead(prefill?: string | null) {
    setStep("find");
    setMode("search");
    if (prefill) setQuery(prefill);
  }

  // ---------- Choosing ----------
  function choose(game: GameResult, extra: { platformHint?: number | null; edition?: string | null; region?: string | null; via?: string | null } = {}) {
    const code = pendingCode.current;
    const hint = extra.platformHint ?? code?.platformHint ?? lookup?.platformHint ?? null;
    setChosen({ game, code: code ? { code: code.code, kind: code.kind } : null, platformHint: hint, via: extra.via ?? null });
    setDetails(defaultDetails(game, defaultStatus, hint, { edition: extra.edition ?? lookup?.edition, region: extra.region ?? lookup?.region }, usage));
    setError("");
    setStep("details");
  }

  const usage = useMemo(() => {
    const m = new Map<number, number>();
    existing.forEach((g) => m.set(g.platform_id, (m.get(g.platform_id) ?? 0) + 1));
    return m;
  }, [existing]);

  // Already in the list on this platform (and edition)?
  const match = useMemo(() => {
    if (!chosen || !details) return null;
    const ed = (details.edition ?? "").trim().toLowerCase();
    return existing.find((g) => g.catalog === chosen.game.catalog && g.game_id === chosen.game.gameId && g.platform_id === details.platformId && (g.edition ?? "").trim().toLowerCase() === ed) ?? null;
  }, [chosen, details, existing]);

  const duplicateMessage = match
    ? match.status === "wishlist" && details?.status === "owned"
      ? "This is on your wishlist. Saving moves it into your collection."
      : match.status === details?.status
        ? `Already in your ${match.status === "owned" ? "collection" : "wishlist"} on ${platformById(match.platform_id)?.short ?? match.platform_name}. Saving updates it.`
        : "You already own this copy. Saving moves it to your wishlist."
    : null;

  async function save() {
    if (!chosen || !details) return;
    setSaving(true);
    setError("");
    try {
      let row: UserGame;
      let action: "added" | "updated" | "moved";
      if (match) {
        row = await updateGame(match.id, details);
        action = match.status !== details.status ? "moved" : "updated";
        if (chosen.code) await recordCode(userId, chosen.code, chosen.game, details);
      } else {
        row = await addGame(userId, chosen.game, details, chosen.code);
        action = "added";
      }
      onSaved(row, action);
      setAddedCount((n) => n + 1);
      if (chosen.code) justSaved.current = { code: chosen.code.code, at: Date.now() };
      // Ready for the next one, the same way this one was found
      pendingCode.current = null;
      setChosen(null);
      setDetails(null);
      setLookup(null);
      setCodeText("");
      setStep("find");
      setMode(originMode.current);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // ---------- Render ----------
  const title = step === "details" ? (match ? "Update this game" : "Add this game") : step === "pick" ? "Is it one of these?" : "Add a game";

  return (
    <Modal open={open} onClose={onClose} labelledBy="add-game-title" size="lg" dismissible={!saving}>
      <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <ModalHeader
          id="add-game-title"
          title={title}
          description={
            step === "find"
              ? addedCount > 0
                ? `${addedCount} saved. Keep going, or close when you're done.`
                : "Scan the barcode on the back of the case, or search by name."
              : undefined
          }
          onClose={onClose}
          disabled={saving}
        />
        {step === "find" && (
          <div className="mt-4">
            <Segmented
              label="How to find the game"
              value={mode}
              onChange={(m) => {
                setMode(m);
                originMode.current = m;
                pendingCode.current = null;
                setError("");
              }}
              options={[
                { value: "scan", label: <><CameraIcon /> Scan</> },
                { value: "search", label: <><SearchIcon /> Name</> },
                { value: "code", label: <><HashIcon /> Code</> },
              ]}
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 py-5 sm:py-6">
        {error && (
          <p role="alert" className="mb-4 rounded-2xl bg-[#fbefed] border border-red-200/70 px-4 py-3 text-sm text-[#8f3b31]">
            {error}
          </p>
        )}

        {/* ---------- Find: scan ---------- */}
        {step === "find" && mode === "scan" && (
          <div className="space-y-4">
            {cameraError ? (
              <div className="rounded-2xl bg-white border border-[#0f172a]/10 p-5 text-center">
                <p className="text-sm text-slate-600 leading-6">{cameraError}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMode("code")}>
                    Type the numbers
                  </Button>
                  <Button variant="dark" size="sm" onClick={() => setMode("search")}>
                    Search by name
                  </Button>
                </div>
              </div>
            ) : (
              <BarcodeScanner paused={looking || !open} onDetected={onScanned} onError={setCameraError} />
            )}
            <ul className="grid sm:grid-cols-3 gap-2 text-xs text-slate-500">
              <li className="rounded-xl bg-white/70 border border-[#0f172a]/[0.06] px-3 py-2.5">Use the barcode on the <strong className="text-slate-700">back of the case</strong>.</li>
              <li className="rounded-xl bg-white/70 border border-[#0f172a]/[0.06] px-3 py-2.5">Hold it flat, about a hand&apos;s width away.</li>
              <li className="rounded-xl bg-white/70 border border-[#0f172a]/[0.06] px-3 py-2.5">Glare? Tilt the case or turn on the light.</li>
            </ul>
          </div>
        )}

        {/* ---------- Find: code ---------- */}
        {step === "find" && mode === "code" && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              runLookup(codeText);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="game-code" className="block text-sm font-medium text-[#0f172a] mb-2">
                Barcode numbers or product code
              </label>
              <input
                id="game-code"
                value={codeText}
                onChange={(e) => setCodeText(e.target.value.toUpperCase())}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={30}
                placeholder="0711719541028  or  CUSA-07408"
                className={`${inputClass} h-12 text-base font-mono tracking-wide`}
              />
              <p className="mt-2 text-xs text-slate-500 leading-5">
                The product code is printed on the spine or back: <span className="font-mono">CUSA-</span> or <span className="font-mono">PPSA-</span> for PlayStation,{" "}
                <span className="font-mono">HAC-</span> or <span className="font-mono">BEE-</span> for Switch. It&apos;s different for each region, so it&apos;s the most exact way to match.
              </p>
            </div>
            <Button type="submit" variant="dark" fullWidth disabled={codeText.trim().length < 6}>
              Look it up
            </Button>
          </form>
        )}

        {/* ---------- Find: search ---------- */}
        {step === "find" && mode === "search" && (
          <div className="space-y-4">
            {pendingCode.current && (
              <p className="rounded-2xl bg-[#eef3ee] border border-[#7a947c]/25 px-4 py-3 text-sm text-[#3f5a41]">
                Pick the right game and we&apos;ll remember code <span className="font-mono">{pendingCode.current.code}</span> for next time.{" "}
                <button
                  type="button"
                  onClick={() => {
                    pendingCode.current = null;
                    rerender((n) => n + 1);
                  }}
                  className={`underline underline-offset-4 rounded ${focusRing}`}>
                  Forget the code
                </button>
              </p>
            )}
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
                placeholder="Game name, e.g. Tears of the Kingdom"
                aria-label="Game name"
                className={`${inputClass} h-12 pl-10 text-base`}
              />
            </div>
            <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-1 px-1">
              <Chip on={family === "all"} onClick={() => setFamily("all")}>
                All
              </Chip>
              {(["playstation", "nintendo"] as const).map((f) => (
                <Chip key={f} on={family === f} onClick={() => setFamily(f)}>
                  {FAMILY_LABEL[f]}
                </Chip>
              ))}
            </div>

            <div aria-live="polite" className="min-h-[3rem]">
              {searching && (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Spinner light={false} /> Searching…
                </p>
              )}
              {!searching && searchError && <p className="text-sm text-[#8f3b31]">{searchError}</p>}
              {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
                <p className="text-sm text-slate-500">No PlayStation or Nintendo games found for “{query.trim()}”. Try fewer words or check the spelling.</p>
              )}
              {!searching && query.trim().length < 2 && <p className="text-sm text-slate-400">Start typing to search PlayStation and Nintendo games.</p>}
              {!searching && results.length > 0 && (
                <ul className="space-y-2">
                  {results.map((g) => (
                    <li key={g.gameId}>
                      <ResultRow game={g} owned={sameGame(existing, g)} onPick={() => choose(g)} />
                    </li>
                  ))}
                </ul>
              )}
              <CatalogCredit catalogs={results.map((g) => g.catalog)} className="mt-4" />
            </div>
          </div>
        )}

        {/* ---------- Pick: what the code turned up ---------- */}
        {step === "pick" && (
          <div className="space-y-5">
            {looking && (
              <div className="flex flex-col items-center gap-3 py-10 text-sm text-slate-500" aria-live="polite">
                <Spinner light={false} size={22} />
                Looking up {pendingCode.current?.kind === "product" ? "product code" : "barcode"}{" "}
                <span className="font-mono text-slate-700">{pendingCode.current?.code}</span>…
              </div>
            )}

            {!looking && lookup && (
              <>
                <p className="text-sm text-slate-500">
                  {lookup.kind === "barcode" ? "Barcode" : "Product code"} <span className="font-mono text-slate-700">{lookup.code}</span>
                  {lookup.product && (
                    <>
                      {" "}
                      · shops call it <span className="text-slate-700">“{lookup.product.title}”</span>
                    </>
                  )}
                </p>

                {lookup.community.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Confirmed by people using The Archive</h3>
                    <ul className="space-y-2">
                      {lookup.community.map((m) => (
                        <li key={`${m.game.gameId}-${m.platformId}`}>
                          <ResultRow
                            game={m.game}
                            platformId={m.platformId}
                            badge={
                              <span className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold bg-[#e6efe6] text-[#3f5a41]">
                                {m.mine ? "Your match" : `✓ ${m.votes} ${m.votes === 1 ? "person" : "people"}`}
                              </span>
                            }
                            owned={sameGame(existing, m.game)}
                            onPick={() => choose(m.game, { platformHint: m.platformId, edition: m.edition, region: m.region, via: `Confirmed by ${m.votes} ${m.votes === 1 ? "person" : "people"}` })}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {lookup.suggestions.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
                      {lookup.community.length ? "Other possible matches" : "Best matches"}
                    </h3>
                    <ul className="space-y-2">
                      {lookup.suggestions.map((g, i) => (
                        <li key={g.gameId}>
                          <ResultRow
                            game={g}
                            platformId={lookup.platformHint}
                            badge={i === 0 || g.score >= 0.6 ? <ConfidencePill score={g.score} /> : null}
                            owned={sameGame(existing, g)}
                            onPick={() => choose(g, { platformHint: lookup.platformHint, edition: lookup.edition, region: lookup.region, via: "Matched from the barcode" })}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {!lookup.community.length && !lookup.suggestions.length && (
                  <div className="rounded-2xl bg-white border border-[#0f172a]/10 p-5">
                    <p className="font-classical text-lg text-[#0f172a]">We don&apos;t know this code yet</p>
                    <p className="mt-1 text-sm text-slate-500 leading-6">
                      {lookup.product
                        ? "The shop name didn't match a PlayStation or Nintendo game. Search by name instead."
                        : "Search for the game by name. Once you pick it, this code will match straight away next time, for you and everyone else."}
                    </p>
                  </div>
                )}
              </>
            )}

            {!looking && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="dark" onClick={() => searchInstead(lookup?.searchedFor)}>
                  {lookup?.community.length || lookup?.suggestions.length ? "None of these, search by name" : "Search by name"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    pendingCode.current = null;
                    setLookup(null);
                    setStep("find");
                  }}
                >
                  {mode === "scan" ? "Scan again" : "Try another code"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ---------- Details ---------- */}
        {step === "details" && chosen && details && (
          <div className="space-y-6">
            <div className="flex gap-4">
              <GameCover src={chosen.game.coverUrl} name={chosen.game.name} className="w-20 sm:w-24 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="font-classical text-xl sm:text-2xl font-semibold text-[#0f172a] leading-tight">{chosen.game.name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {[chosen.game.releaseYear, chosen.game.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {chosen.game.platforms.map((p) => (
                    <PlatformBadge key={p} id={p} />
                  ))}
                </div>
                {chosen.via && (
                  <p className="mt-2 text-xs text-[#3f5a41]">
                    ✓ {chosen.via}
                    {chosen.code && <span className="text-slate-400"> · {chosen.code.code}</span>}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setStep(lookup ? "pick" : "find")}
                  className={`mt-2 text-xs font-medium text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] rounded ${focusRing}`}
                >
                  Not this game?
                </button>
              </div>
            </div>

            <CopyForm
              key={chosen.game.gameId}
              value={details}
              onChange={setDetails}
              gamePlatforms={chosen.game.platforms}
              platformHint={chosen.platformHint}
              duplicateOf={duplicateMessage}
            />
          </div>
        )}
      </div>

      {step === "details" && (
        <div className="px-5 sm:px-8 py-4 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button variant="ghost" onClick={() => setStep(lookup ? "pick" : "find")} disabled={saving}>
            Back
          </Button>
          <Button variant="primary" onClick={save} loading={saving} className="sm:min-w-[12rem]">
            {match ? (match.status !== details?.status ? (details?.status === "owned" ? "Move to collection" : "Move to wishlist") : "Update") : details?.status === "owned" ? "Add to collection" : "Add to wishlist"}
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------
// Pieces
// ------------------------------------------------------------

function sameGame(list: UserGame[], game: GameResult) {
  return list.filter((x) => x.catalog === game.catalog && x.game_id === game.gameId);
}

function ResultRow({
  game,
  platformId,
  badge,
  owned,
  onPick,
}: {
  game: GameResult;
  platformId?: number | null;
  badge?: ReactNode;
  owned: UserGame[];
  onPick: () => void;
}) {
  const platforms = platformId && game.platforms.includes(platformId) ? [platformId, ...game.platforms.filter((p) => p !== platformId)] : game.platforms;
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full flex items-center gap-3 rounded-2xl bg-white border border-[#0f172a]/[0.08] p-2.5 pr-3 text-left hover:border-[#7a947c]/60 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-all ${focusRing}`}
    >
      <GameCover src={game.coverUrl} name={game.name} size="small" className="w-12 shrink-0 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-[#0f172a] leading-snug">{game.name}</span>
          {game.releaseYear && <span className="text-xs text-slate-400">{game.releaseYear}</span>}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          {badge}
          {platforms.slice(0, 4).map((p) => (
            <PlatformBadge key={p} id={p} />
          ))}
          {platforms.length > 4 && <span className="text-[11px] text-slate-400">+{platforms.length - 4}</span>}
        </span>
        {owned.length > 0 && (
          <span className="mt-1 block text-[11px] text-[#7a5a14]">
            In your {owned.some((o) => o.status === "owned") ? "collection" : "wishlist"} on {owned.map((o) => platformById(o.platform_id)?.short ?? o.platform_name).join(", ")}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="text-slate-300 text-xl">›</span>
    </button>
  );
}

function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function HashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18" />
    </svg>
  );
}
