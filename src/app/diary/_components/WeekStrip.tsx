// src/app/diary/_components/WeekStrip.tsx
// Monday to Sunday. Sage = logged a session, lilac = journal notes only.

import { addDays, DayStat, formatDay, formatMinutes, weekdayIndex } from "../../../lib/reading";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function describe(stat: DayStat | undefined) {
  if (!stat) return "no reading";
  const parts: string[] = [];
  if (stat.sessions > 0) parts.push(`read for ${formatMinutes(stat.minutes)}`);
  if (stat.notes > 0) parts.push(`${stat.notes} journal ${stat.notes === 1 ? "note" : "notes"}`);
  return parts.length ? parts.join(", ") : "no reading";
}

export default function WeekStrip({ days, today }: { days: DayStat[]; today: string }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const monday = addDays(today, -weekdayIndex(today));

  return (
    <ol className="grid grid-cols-7 gap-1.5 sm:gap-2.5" aria-label="This week">
      {LETTERS.map((letter, i) => {
        const date = addDays(monday, i);
        const stat = byDate.get(date);
        const hasSession = !!stat && stat.sessions > 0;
        const notesOnly = !!stat && stat.sessions === 0 && stat.notes > 0;
        const isToday = date === today;
        const future = date > today;
        const fullDate = formatDay(date, { weekday: "long", day: "numeric", month: "long" });
        const description = future ? "still to come" : describe(stat);

        return (
          <li key={date} className="flex flex-col items-center gap-2">
            <span className={`text-[11px] font-medium ${isToday ? "text-[#0f172a]" : "text-slate-400"}`} aria-hidden="true">
              {letter}
            </span>
            <span
              title={`${fullDate}: ${description}`}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors ${
                hasSession
                  ? "bg-[#7a947c] text-white shadow-[0_6px_14px_rgba(122,148,124,0.3)]"
                  : notesOnly
                    ? "bg-[#d8d0e3] text-[#6c5c85]"
                    : future
                      ? "border border-dashed border-[#0f172a]/12"
                      : "bg-[#0f172a]/[0.05]"
              } ${isToday && !hasSession && !notesOnly ? "ring-2 ring-[#c5a24a]/70 ring-offset-2 ring-offset-[#fdfaf3]" : ""}`}
            >
              {hasSession && (
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
              {notesOnly && <span aria-hidden="true" className="text-sm">✎</span>}
              <span className="sr-only">{fullDate}: {description}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
