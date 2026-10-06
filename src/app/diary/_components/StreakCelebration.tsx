"use client";

// src/app/diary/_components/StreakCelebration.tsx
// Shown after your first session of the day.

import { useEffect, useState } from "react";
import Button from "../../components/ui/Button";
import Modal from "../../components/ui/Modal";
import { DayStat } from "../../../lib/reading";
import StreakFlame from "./StreakFlame";
import WeekStrip from "./WeekStrip";

export default function StreakCelebration({
  open,
  streak,
  goalMet,
  days,
  today,
  onClose,
}: {
  open: boolean;
  streak: number;
  goalMet: boolean;
  days: DayStat[];
  today: string;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(Math.max(streak - 1, 0));

  useEffect(() => {
    if (!open) return;
    setShown(Math.max(streak - 1, 0));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setShown(streak), reduce ? 0 : 600);
    return () => window.clearTimeout(timer);
  }, [open, streak]);

  const headline =
    streak === 1
      ? "Your streak has begun"
      : streak % 7 === 0
        ? `${streak / 7} ${streak === 7 ? "week" : "weeks"} of reading`
        : "Another day on the shelf";

  return (
    <Modal open={open} onClose={onClose} labelledBy="celebration-title" size="sm">
      <div className="px-6 pt-10 pb-8 sm:px-10 text-center overflow-y-auto">
        <StreakFlame lit size={88} className="mx-auto celebrate-rise" />

        <p className="mt-4 font-classical font-semibold text-7xl leading-none text-[#0f172a] tabular-nums" aria-hidden="true">
          <span key={shown} className="inline-block celebrate-tick">{shown}</span>
        </p>
        <p className="mt-1 text-slate-500 font-light" aria-hidden="true">
          day streak
        </p>

        <h2 id="celebration-title" className="mt-6 font-classical text-3xl font-semibold text-[#0f172a]">
          {headline}
          <span className="sr-only">. Your streak is {streak} {streak === 1 ? "day" : "days"}.</span>
        </h2>
        <p className="mt-2 text-sm text-slate-500 font-light leading-6">
          {goalMet ? "You've met today's goal too. See you tomorrow." : "Read again tomorrow to keep it going."}
        </p>

        <div className="mt-7 mx-auto max-w-xs">
          <WeekStrip days={days} today={today} />
        </div>

        <Button variant="primary" size="lg" fullWidth className="mt-8" onClick={onClose} autoFocus>
          Keep reading
        </Button>
      </div>

      <style>{`
        @keyframes celebrate-rise { from { transform: translateY(12px) scale(.85); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes celebrate-tick { from { transform: translateY(35%); opacity: 0 } to { transform: none; opacity: 1 } }
        .celebrate-rise { animation: celebrate-rise 600ms cubic-bezier(.2,.8,.2,1) both; }
        .celebrate-tick { animation: celebrate-tick 380ms cubic-bezier(.2,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) { .celebrate-rise, .celebrate-tick { animation: none; } }
      `}</style>
    </Modal>
  );
}
