"use client";

// src/app/diary/_components/GoalPicker.tsx

import { useEffect, useState } from "react";
import Button, { focusRing } from "../../components/ui/Button";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import { supabase } from "../../../lib/supabase";

const OPTIONS = [
  { minutes: 5, label: "A few pages" },
  { minutes: 10, label: "A short chapter" },
  { minutes: 15, label: "A steady habit" },
  { minutes: 30, label: "A proper sit-down" },
  { minutes: 60, label: "An evening with a book" },
];

export default function GoalPicker({
  open,
  onClose,
  userId,
  current,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  current: number;
  onSaved: (minutes: number) => void;
}) {
  const [selected, setSelected] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(current);
      setError("");
    }
  }, [open, current]);

  async function save() {
    setSaving(true);
    setError("");

    const { error: saveError } = await supabase
      .from("reading_goals")
      .upsert({ user_id: userId, daily_minutes: selected, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

    setSaving(false);

    if (saveError) {
      console.error("Goal save failed:", saveError.message);
      setError("Your goal couldn't be saved. Try again.");
      return;
    }

    onSaved(selected);
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy="goal-title" size="sm" dismissible={!saving}>
      <div className="p-6 sm:p-8 overflow-y-auto">
        <ModalHeader
          id="goal-title"
          title="Daily reading goal"
          description="How long would you like to read each day?"
          onClose={onClose}
          disabled={saving}
        />

        <div role="radiogroup" aria-labelledby="goal-title" className="mt-6 grid gap-2">
          {OPTIONS.map((option) => {
            const checked = selected === option.minutes;
            return (
              <button
                key={option.minutes}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setSelected(option.minutes)}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 rounded-2xl border text-left transition-all ${focusRing} ${
                  checked ? "border-[#7a947c] bg-[#eef3ee]" : "border-[#0f172a]/10 bg-white hover:border-[#7a947c]/50"
                }`}
              >
                <span className="font-classical text-lg text-[#0f172a]">{option.minutes} minutes</span>
                <span className={`text-sm font-light ${checked ? "text-[#4a5c4b]" : "text-slate-400"}`}>{option.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div role="alert" className="mt-5 px-4 py-3 rounded-xl bg-[#f8e9e5]/90 border border-[#e8cbc4] text-[#a14e43] text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mt-8">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={selected === current}>
            {saving ? "Saving…" : "Save goal"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
