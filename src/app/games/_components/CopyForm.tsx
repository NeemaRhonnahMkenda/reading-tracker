// src/app/games/_components/CopyForm.tsx
// The details of your copy: collection or wishlist, platform, physical or
// digital, edition, region, condition, progress or priority, notes.
// Used when adding a game and when editing one.

"use client";

import { useId, useState } from "react";
import { focusRing } from "../../components/ui/Button";
import { CONDITION_LABEL, PLAY_LABEL, PRIORITY_LABEL, REGIONS, type CopyDetails } from "../_lib/games";
import { FAMILY_LABEL, PLATFORMS, platformById } from "../_lib/platforms";
import type { Condition, PlayStatus, Region } from "../_lib/types";
import { Chip, FieldLabel, PlatformBadge, Segmented, inputClass } from "./GameBits";

const EDITIONS = ["Standard", "Deluxe Edition", "Collector's Edition", "Game of the Year Edition", "Gold Edition", "Steelbook", "Limited Run"];

export default function CopyForm({
  value,
  onChange,
  gamePlatforms,
  platformHint,
  duplicateOf,
}: {
  value: CopyDetails;
  onChange: (next: CopyDetails) => void;
  gamePlatforms: number[]; // platforms the game came out on
  platformHint?: number | null; // what the barcode said, shown as "from the barcode"
  duplicateOf?: string | null; // message when this copy is already in the list
}) {
  const ids = useId();
  const [morePlatforms, setMorePlatforms] = useState(() => gamePlatforms.length > 0 && !gamePlatforms.includes(value.platformId));
  const [moreDetails, setMoreDetails] = useState(() => !!(value.notes || value.acquiredOn));
  const set = <K extends keyof CopyDetails>(key: K, v: CopyDetails[K]) => onChange({ ...value, [key]: v });

  const owned = value.status === "owned";
  const physical = value.format === "physical";
  const listed = gamePlatforms.length ? gamePlatforms : PLATFORMS.filter((p) => p.current).map((p) => p.id);
  const ordered = PLATFORMS.filter((p) => listed.includes(p.id));

  return (
    <div className="space-y-6">
      <Segmented
        label="Where it goes"
        value={value.status}
        onChange={(v) => set("status", v)}
        options={[
          { value: "owned", label: "In my collection" },
          { value: "wishlist", label: "On my wishlist" },
        ]}
      />

      {/* Platform */}
      <div>
        <FieldLabel hint={platformHint && platformById(platformHint) ? `barcode says ${platformById(platformHint)!.short}` : undefined}>Platform</FieldLabel>
        <div role="radiogroup" aria-label="Platform" className="flex flex-wrap gap-2">
          {ordered.map((p) => {
            const on = value.platformId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("platformId", p.id)}
                className={`inline-flex items-center gap-2 h-11 pl-1.5 pr-3.5 rounded-full border text-sm font-medium transition-colors ${focusRing} ${
                  on ? "bg-[#0f172a] border-[#0f172a] text-[#fdfaf3]" : "bg-white border-[#0f172a]/10 text-slate-700 hover:border-[#0f172a]/25"
                }`}
              >
                <PlatformBadge id={p.id} solid={on} />
                {p.name}
              </button>
            );
          })}
          {!morePlatforms && (
            <button
              type="button"
              onClick={() => setMorePlatforms(true)}
              className={`h-11 px-3.5 rounded-full text-sm text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] ${focusRing}`}
            >
              Another platform…
            </button>
          )}
        </div>
        {morePlatforms && (
          <select
            aria-label="Choose any platform"
            value={value.platformId}
            onChange={(e) => set("platformId", Number(e.target.value))}
            className={`${inputClass} mt-2`}
          >
            {(["playstation", "nintendo"] as const).map((f) => (
              <optgroup key={f} label={FAMILY_LABEL[f]}>
                {PLATFORMS.filter((p) => p.family === f).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {gamePlatforms.length && !gamePlatforms.includes(p.id) ? " (not listed for this game)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      {duplicateOf && (
        <p role="alert" className="rounded-2xl bg-[#fbf3df] border border-[#c69a3d]/30 px-4 py-3 text-sm text-[#5b4718]">
          {duplicateOf}
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <FieldLabel>Format</FieldLabel>
          <Segmented
            label="Format"
            size="sm"
            value={value.format}
            onChange={(v) => set("format", v)}
            options={[
              { value: "physical", label: "Physical" },
              { value: "digital", label: "Digital" },
            ]}
          />
        </div>

        {owned ? (
          <div>
            <FieldLabel htmlFor={`${ids}-play`}>Progress</FieldLabel>
            <select id={`${ids}-play`} value={value.playStatus} onChange={(e) => set("playStatus", e.target.value as PlayStatus)} className={inputClass}>
              {(Object.keys(PLAY_LABEL) as PlayStatus[]).map((k) => (
                <option key={k} value={k}>
                  {PLAY_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <FieldLabel>How much you want it</FieldLabel>
            <Segmented
              label="Priority"
              size="sm"
              value={String(value.priority ?? 2)}
              onChange={(v) => set("priority", Number(v))}
              options={[1, 2, 3].map((n) => ({ value: String(n), label: PRIORITY_LABEL[n] }))}
            />
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <FieldLabel htmlFor={`${ids}-edition`} hint="optional">
            Edition
          </FieldLabel>
          <input
            id={`${ids}-edition`}
            list={`${ids}-editions`}
            value={value.edition ?? ""}
            maxLength={80}
            placeholder="Standard"
            onChange={(e) => set("edition", e.target.value || null)}
            className={inputClass}
          />
          <datalist id={`${ids}-editions`}>
            {EDITIONS.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </div>

        {physical && (
          <div>
            <FieldLabel htmlFor={`${ids}-region`} hint="optional">
              Region
            </FieldLabel>
            <select
              id={`${ids}-region`}
              value={value.region ?? ""}
              onChange={(e) => set("region", (e.target.value || null) as Region | null)}
              className={inputClass}
            >
              <option value="">Not sure</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r === "PAL" ? "PAL (UK, Europe, Africa, Australia)" : r === "NTSC-U" ? "NTSC-U (Americas)" : r === "NTSC-J" ? "NTSC-J (Japan)" : r}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {owned && physical && (
        <div>
          <FieldLabel hint="optional">Condition</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
              <Chip key={c} on={value.condition === c} onClick={() => set("condition", value.condition === c ? null : c)}>
                {CONDITION_LABEL[c]}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {moreDetails ? (
        <div className="grid sm:grid-cols-[auto_1fr] gap-5">
          {owned && (
            <div>
              <FieldLabel htmlFor={`${ids}-date`} hint="optional">
                Got it on
              </FieldLabel>
              <input
                id={`${ids}-date`}
                type="date"
                value={value.acquiredOn ?? ""}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => set("acquiredOn", e.target.value || null)}
                className={inputClass}
              />
            </div>
          )}
          <div className={owned ? "" : "sm:col-span-2"}>
            <FieldLabel htmlFor={`${ids}-notes`} hint="optional">
              Notes
            </FieldLabel>
            <textarea
              id={`${ids}-notes`}
              rows={2}
              maxLength={1000}
              value={value.notes ?? ""}
              placeholder={owned ? "Lent to Sam, missing manual…" : "Wait for a sale, gift idea…"}
              onChange={(e) => set("notes", e.target.value || null)}
              className={`${inputClass} h-auto py-2.5 resize-y`}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setMoreDetails(true)}
          className={`text-sm font-medium text-slate-500 hover:text-[#0f172a] rounded ${focusRing}`}
        >
          + Add notes{owned ? " or the date you got it" : ""}
        </button>
      )}
    </div>
  );
}
