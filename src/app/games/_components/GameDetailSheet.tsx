// src/app/games/_components/GameDetailSheet.tsx
// One game: see it, change your copy's details, move it between wishlist and
// collection, or remove it.

"use client";

import { useEffect, useState } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import { CONDITION_LABEL, PLAY_LABEL, PRIORITY_LABEL, detailsFrom, errorMessage, removeGame, updateGame, type CopyDetails } from "../_lib/games";
import { platformById } from "../_lib/platforms";
import { catalogLink, type UserGame } from "../_lib/types";
import CopyForm from "./CopyForm";
import { GameCover, PlatformBadge } from "./GameBits";

export default function GameDetailSheet({
  game,
  others,
  onClose,
  onChanged,
  onRemoved,
}: {
  game: UserGame | null;
  others: UserGame[]; // the rest of the list, to warn about duplicates
  onClose: () => void;
  onChanged: (row: UserGame, action: "updated" | "moved") => void;
  onRemoved: (row: UserGame) => void;
}) {
  const [details, setDetails] = useState<CopyDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "move" | "remove">("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!game) return;
    setDetails(detailsFrom(game));
    setEditing(false);
    setConfirmRemove(false);
    setError("");
  }, [game]);

  if (!game || !details) return null;

  const clash = others.find(
    (o) =>
      o.id !== game.id &&
      o.catalog === game.catalog &&
      o.game_id === game.game_id &&
      o.platform_id === details.platformId &&
      (o.edition ?? "").trim().toLowerCase() === (details.edition ?? "").trim().toLowerCase()
  );

  async function save(next: CopyDetails, kind: "save" | "move") {
    setBusy(kind);
    setError("");
    try {
      const row = await updateGame(game!.id, next);
      onChanged(row, kind === "move" ? "moved" : "updated");
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("remove");
    setError("");
    try {
      await removeGame(game!.id);
      onRemoved(game!);
    } catch (e) {
      setError(errorMessage(e));
      setBusy("");
    }
  }

  const owned = game.status === "owned";
  const facts: [string, string][] = [
    ["Format", game.format === "physical" ? "Physical" : "Digital"],
    ...(game.edition ? [["Edition", game.edition] as [string, string]] : []),
    ...(game.region ? [["Region", game.region] as [string, string]] : []),
    ...(owned ? [["Progress", PLAY_LABEL[game.play_status]] as [string, string]] : []),
    ...(owned && game.condition ? [["Condition", CONDITION_LABEL[game.condition]] as [string, string]] : []),
    ...(!owned && game.priority ? [["Priority", PRIORITY_LABEL[game.priority]] as [string, string]] : []),
    ...(game.acquired_on ? [["Got it on", new Date(`${game.acquired_on}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })] as [string, string]] : []),
    ...(game.code ? [["Code", game.code] as [string, string]] : []),
  ];

  return (
    <Modal open onClose={onClose} labelledBy="game-title" size="lg" dismissible={!busy}>
      <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <ModalHeader id="game-title" title={editing ? "Edit details" : owned ? "In your collection" : "On your wishlist"} onClose={onClose} disabled={!!busy} />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8 py-5 sm:py-6 space-y-6">
        {error && (
          <p role="alert" className="rounded-2xl bg-[#fbefed] border border-red-200/70 px-4 py-3 text-sm text-[#8f3b31]">
            {error}
          </p>
        )}

        <div className="flex gap-4 sm:gap-5">
          <GameCover src={game.cover_url} name={game.name} className="w-24 sm:w-32 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="font-classical text-2xl sm:text-3xl font-semibold text-[#0f172a] leading-tight">{game.name}</h3>
            <p className="mt-1.5 text-sm text-slate-500">{[game.release_year, game.genres.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PlatformBadge id={game.platform_id} name={game.platform_name} solid />
              <span className="text-sm text-slate-600">{platformById(game.platform_id)?.name ?? game.platform_name}</span>
            </div>
            {catalogLink(game.catalog, game.slug) && (
              <a
                href={catalogLink(game.catalog, game.slug)!}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-xs font-medium text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a]"
              >
                More about this game ↗
              </a>
            )}
          </div>
        </div>

        {editing ? (
          <CopyForm
            value={details}
            onChange={setDetails}
            gamePlatforms={[game.platform_id]}
            duplicateOf={clash ? `You already have this on ${platformById(clash.platform_id)?.short ?? clash.platform_name}${clash.edition ? ` (${clash.edition})` : ""}. Choose a different platform or edition.` : null}
          />
        ) : (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {facts.map(([k, v]) => (
                <div key={k} className="rounded-xl bg-white/80 border border-[#0f172a]/[0.06] px-3.5 py-2.5 min-w-0">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</dt>
                  <dd className={`mt-0.5 text-sm text-[#0f172a] truncate ${k === "Code" ? "font-mono" : ""}`}>{v}</dd>
                </div>
              ))}
            </dl>
            {game.notes && <p className="rounded-2xl bg-white/80 border border-[#0f172a]/[0.06] px-4 py-3 text-sm text-slate-600 whitespace-pre-line">{game.notes}</p>}

            {owned ? (
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">Quick update</p>
                <div className="flex flex-wrap gap-2">
                  {(["playing", "completed", "dropped"] as const)
                    .filter((s) => s !== game.play_status)
                    .map((s) => (
                      <Button key={s} variant="outline" size="sm" disabled={!!busy} onClick={() => save({ ...detailsFrom(game), playStatus: s }, "save")}>
                        {s === "playing" ? "▶ Playing now" : s === "completed" ? "✓ Finished it" : "Stopped playing"}
                      </Button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-[#eef3ee] border border-[#7a947c]/25 p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[#3f5a41]">Got it? Move it into your collection.</p>
                <Button
                  size="sm"
                  loading={busy === "move"}
                  onClick={() =>
                    save(
                      { ...detailsFrom(game), status: "owned", priority: null, acquiredOn: new Date().toISOString().slice(0, 10), playStatus: "unplayed" },
                      "move"
                    )
                  }
                >
                  I got it!
                </Button>
              </div>
            )}
          </>
        )}

        {confirmRemove && (
          <div role="alertdialog" aria-labelledby="remove-q" className="rounded-2xl bg-[#fbefed] border border-red-200/70 p-4">
            <p id="remove-q" className="text-sm text-[#8f3b31]">
              Remove <strong>{game.name}</strong> ({platformById(game.platform_id)?.short ?? game.platform_name}) from your {owned ? "collection" : "wishlist"}?
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="danger" size="sm" loading={busy === "remove"} onClick={remove}>
                Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)} disabled={busy === "remove"}>
                Keep it
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 sm:px-8 py-4 border-t border-[#0f172a]/[0.06] flex flex-wrap gap-2 justify-between">
        {editing ? (
          <>
            <Button variant="ghost" onClick={() => (setEditing(false), setDetails(detailsFrom(game)))} disabled={!!busy}>
              Cancel
            </Button>
            <Button onClick={() => save(details, details.status !== game.status ? "move" : "save")} loading={busy === "save" || busy === "move"} disabled={!!clash}>
              Save changes
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={!!busy || confirmRemove} className="text-[#a14e43] hover:text-[#8f3b31]">
              Remove
            </Button>
            <Button variant="dark" onClick={() => setEditing(true)} disabled={!!busy}>
              Edit details
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
