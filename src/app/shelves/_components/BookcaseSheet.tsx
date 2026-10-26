// src/app/shelves/_components/BookcaseSheet.tsx
// Create a bookcase (name + how many shelves), or rename one.

"use client";

import { FormEvent, useEffect, useState } from "react";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import type { Bookcase } from "../_lib/shelves";

export type BookcaseSheetMode = { kind: "create" } | { kind: "rename"; bookcase: Bookcase } | null;

const NAME_IDEAS = ["Living room", "Bedroom", "Study", "Hallway", "Kids' room"];

export default function BookcaseSheet({
  mode,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  mode: BookcaseSheetMode;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (name: string, shelves: number) => void;
}) {
  const [name, setName] = useState("");
  const [shelves, setShelves] = useState(5);

  useEffect(() => {
    if (!mode) return;
    setName(mode.kind === "rename" ? mode.bookcase.name : "");
    setShelves(5);
  }, [mode]);

  const creating = mode?.kind === "create";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), shelves);
  }

  return (
    <Modal open={!!mode} onClose={onClose} labelledBy="case-sheet-title" size="sm" dismissible={!saving}>
      <form onSubmit={submit} className="flex flex-col min-h-0">
        <div className="px-5 sm:px-8 pt-3 sm:pt-7 pb-4 border-b border-[#0f172a]/[0.06]">
          <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
          <ModalHeader
            id="case-sheet-title"
            title={creating ? "New bookcase" : "Rename bookcase"}
            description={creating ? "Match a real bookcase in your home." : undefined}
            onClose={onClose}
            disabled={saving}
          />
        </div>

        <div className="px-5 sm:px-8 py-6 space-y-6">
          <div>
            <label htmlFor="case-name" className="block text-xs font-medium text-slate-500 mb-1.5">Name</label>
            <input
              id="case-name"
              autoFocus
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Living room"
              className="w-full h-12 px-4 rounded-xl bg-white border border-[#0f172a]/10 text-base sm:text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10"
            />
            {creating && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {NAME_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setName(idea)}
                    className={`h-8 px-3 rounded-full border border-dashed border-[#9a86b9]/40 bg-[#f7f5fa]/70 text-xs text-[#6c5c85] hover:border-[#9a86b9] ${focusRing}`}
                  >
                    {idea}
                  </button>
                ))}
              </div>
            )}
          </div>

          {creating && (
            <div>
              <p id="shelf-count-label" className="text-xs font-medium text-slate-500 mb-2">How many shelves?</p>
              <div className="flex items-center gap-4">
                <div role="group" aria-labelledby="shelf-count-label" className="flex items-center rounded-full border border-[#0f172a]/10 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShelves((n) => Math.max(1, n - 1))}
                    disabled={shelves <= 1}
                    aria-label="One shelf fewer"
                    className={`w-11 h-11 text-lg text-slate-500 hover:bg-[#0f172a]/5 disabled:opacity-30 ${focusRing}`}
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-classical text-xl tabular-nums" aria-live="polite">{shelves}</span>
                  <button
                    type="button"
                    onClick={() => setShelves((n) => Math.min(12, n + 1))}
                    disabled={shelves >= 12}
                    aria-label="One shelf more"
                    className={`w-11 h-11 text-lg text-slate-500 hover:bg-[#0f172a]/5 disabled:opacity-30 ${focusRing}`}
                  >
                    +
                  </button>
                </div>

                {/* Mini preview */}
                <div aria-hidden="true" className="w-14 rounded-md p-1 bg-[#7d5a35] flex flex-col gap-[3px]">
                  {Array.from({ length: shelves }).map((_, i) => (
                    <span key={i} className="block h-[6px] rounded-[2px] bg-[#3b2a1c]" />
                  ))}
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">You can add or remove shelves later.</p>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-[#a14e43]">{error}</p>}
        </div>

        <div className="px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" variant="dark" loading={saving} disabled={!name.trim()}>
            {creating ? "Build bookcase" : "Save name"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
