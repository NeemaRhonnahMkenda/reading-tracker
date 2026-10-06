"use client";

// src/app/diary/_components/ReadingHeatmap.tsx
// Twelve weeks of reading, one square per day.
// Sage shades = minutes read, lilac = journal notes only, small dot = notes on a reading day.
// Hover, tap or use the arrow keys to see the details for any day.

import { KeyboardEvent, useMemo, useRef, useState } from "react";
import { addDays, DayStat, formatDay, formatMinutes, weekdayIndex } from "../../../lib/reading";

const WEEKS = 12;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Minutes read per day, lightest to darkest
const LEVELS = [
  { min: 0, className: "bg-white border border-[#0f172a]/10", label: "None" },
  { min: 1, className: "bg-[#dfe8df]", label: "Under 15" },
  { min: 15, className: "bg-[#b4c8b5]", label: "15+" },
  { min: 30, className: "bg-[#7a947c]", label: "30+" },
  { min: 60, className: "bg-[#4f6651]", label: "60+" },
];

const NOTES_ONLY_CLASS = "bg-[#d8d0e3]";

function levelFor(minutes: number) {
  for (let i = LEVELS.length - 1; i >= 0; i--) if (minutes >= LEVELS[i].min) return i;
  return 0;
}

function cellClass(stat: DayStat | undefined) {
  if (stat && stat.sessions === 0 && stat.notes > 0) return NOTES_ONLY_CLASS;
  return LEVELS[levelFor(stat?.minutes ?? 0)].className;
}

function summary(stat: DayStat | undefined) {
  if (!stat || (stat.sessions === 0 && stat.notes === 0)) return "no reading";
  const parts: string[] = [];
  if (stat.minutes) parts.push(formatMinutes(stat.minutes));
  if (stat.pages) parts.push(`${stat.pages} ${stat.pages === 1 ? "page" : "pages"}`);
  if (stat.notes) parts.push(`${stat.notes} journal ${stat.notes === 1 ? "note" : "notes"}`);
  return parts.join(", ");
}

export default function ReadingHeatmap({ days, today }: { days: DayStat[]; today: string }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const firstMonday = addDays(addDays(today, -weekdayIndex(today)), -(WEEKS - 1) * 7);

  // weeks[w][d] = date for week w (left to right), day d (Mon to Sun)
  const weeks = useMemo(
    () => Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(firstMonday, w * 7 + d))),
    [firstMonday]
  );

  // A week belongs to the month its Thursday falls in, so each label sits over
  // the weeks that are mostly that month and labels never overlap
  const months = useMemo(() => {
    const segments: { label: string; start: number; span: number }[] = [];
    weeks.forEach((week, w) => {
      const thursday = week[3];
      const label = formatDay(thursday, { month: "short" }).slice(0, 3); // "Sept" -> "Sep"
      const showYear = thursday.slice(0, 4) !== today.slice(0, 4) && thursday.slice(5, 7) === "12";
      const text = showYear ? `${label} ${thursday.slice(2, 4)}` : label;
      const last = segments[segments.length - 1];
      if (last && last.label === text) last.span += 1;
      else segments.push({ label: text, start: w, span: 1 });
    });
    return segments;
  }, [weeks, today]);

  const inRange = days.filter((d) => d.date >= firstMonday && d.date <= today);
  const activeDays = inRange.filter((d) => d.sessions > 0 || d.notes > 0).length;
  const totalDays = inRange.length;

  // Day shown in the detail panel (hover, focus or tap)
  const [active, setActive] = useState(today);
  const [focusDate, setFocusDate] = useState(today);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    if (!(event.key in step)) return;
    event.preventDefault();

    const next = addDays(date, step[event.key]);
    if (next < firstMonday || next > today) return;

    setFocusDate(next);
    setActive(next);
    cellRefs.current.get(next)?.focus();
  }

  const activeStat = byDate.get(active);
  const activeIsEmpty = !activeStat || (activeStat.sessions === 0 && activeStat.notes === 0);

  return (
    <section
      aria-labelledby="heatmap-heading"
      className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)] p-5 sm:p-6"
    >
      {/* Heading */}
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="heatmap-heading" className="font-classical text-2xl font-semibold text-[#0f172a]">
          Last 12 weeks
        </h2>
        <p className="text-sm text-slate-500">
          <span className="font-classical text-lg text-[#0f172a]">{activeDays}</span>
          <span className="font-light"> of {totalDays} days</span>
        </p>
      </div>

      {/* Calendar grid: a day-name column, then one column per week */}
      <div
        role="group"
        aria-label="Reading calendar for the last 12 weeks. Use the arrow keys to move between days."
        className="mt-5 grid gap-1"
        style={{ gridTemplateColumns: `2.1rem repeat(${WEEKS}, minmax(0, 1fr))` }}
        onMouseLeave={() => setActive(focusDate)}
      >
        {/* Month labels */}
        {months.map((month) => (
          <span
            key={`${month.label}-${month.start}`}
            aria-hidden="true"
            style={{ gridRow: 1, gridColumn: `${month.start + 2} / span ${month.span}` }}
            className={`text-[11px] font-medium text-slate-500 pb-1 truncate ${
              month.start > 0 ? "border-l border-[#0f172a]/10 pl-1" : ""
            }`}
          >
            {month.label}
          </span>
        ))}

        {/* Day names */}
        {DAY_NAMES.map((name, d) => (
          <span
            key={name}
            aria-hidden="true"
            style={{ gridRow: d + 2, gridColumn: 1 }}
            className={`self-center text-[11px] leading-none ${d >= 5 ? "text-slate-400" : "text-slate-500"}`}
          >
            {name}
          </span>
        ))}

        {/* Days */}
        {weeks.map((week, w) =>
          week.map((date, d) => {
            const position = { gridRow: d + 2, gridColumn: w + 2 };

            if (date > today) {
              return (
                <span
                  key={date}
                  aria-hidden="true"
                  style={position}
                  className="aspect-square rounded-[5px] border border-dashed border-[#0f172a]/10"
                />
              );
            }

            const stat = byDate.get(date);
            const hasNotesOnReadingDay = !!stat && stat.sessions > 0 && stat.notes > 0;
            const isToday = date === today;
            const isActive = date === active;
            const label = `${formatDay(date, { weekday: "long", day: "numeric", month: "long" })}: ${summary(stat)}`;

            return (
              <button
                key={date}
                ref={(el) => {
                  if (el) cellRefs.current.set(date, el);
                  else cellRefs.current.delete(date);
                }}
                type="button"
                style={position}
                tabIndex={date === focusDate ? 0 : -1}
                aria-label={label}
                aria-current={isToday ? "date" : undefined}
                onMouseEnter={() => setActive(date)}
                onFocus={() => {
                  setFocusDate(date);
                  setActive(date);
                }}
                onClick={() => {
                  setFocusDate(date);
                  setActive(date);
                }}
                onKeyDown={(event) => moveFocus(event, date)}
                className={`relative aspect-square rounded-[5px] transition-transform outline-none
                  focus-visible:ring-2 focus-visible:ring-[#0f172a] focus-visible:ring-offset-1
                  ${cellClass(stat)}
                  ${isToday ? "ring-2 ring-[#c5a24a] ring-offset-1 ring-offset-[#fdfaf3]" : ""}
                  ${isActive && !isToday ? "scale-110 shadow-md" : ""}`}
              >
                {hasNotesOnReadingDay && (
                  <span aria-hidden="true" className="absolute top-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-[#9a86b9] ring-1 ring-white" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Details for the highlighted day */}
      <div className="mt-5 rounded-2xl bg-white/80 border border-[#0f172a]/8 px-4 py-3.5 min-h-[76px]" aria-live="polite">
        <p className="text-xs text-slate-400">
          {active === today ? "Today" : active === addDays(today, -1) ? "Yesterday" : formatDay(active, { weekday: "long" })}
        </p>
        <p className="font-classical text-lg text-[#0f172a] leading-snug">
          {formatDay(active, { day: "numeric", month: "long", year: "numeric" })}
        </p>
        {activeIsEmpty ? (
          <p className="mt-1 text-sm text-slate-400 font-light">No reading logged</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activeStat!.minutes > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                {formatMinutes(activeStat!.minutes)}
              </span>
            )}
            {activeStat!.pages > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                {activeStat!.pages} {activeStat!.pages === 1 ? "page" : "pages"}
              </span>
            )}
            {activeStat!.notes > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#f7f5fa] text-[#6c5c85] text-xs font-medium border border-[#9a86b9]/20">
                {activeStat!.notes} journal {activeStat!.notes === 1 ? "note" : "notes"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Key */}
      <div className="mt-5 space-y-3" aria-hidden="true">
        <div>
          <p className="text-[11px] font-medium text-slate-500 mb-1.5">Minutes read</p>
          <div className="grid grid-cols-5 gap-1.5">
            {LEVELS.map((level) => (
              <div key={level.label} className="flex flex-col items-center gap-1">
                <span className={`w-full h-3 rounded-[4px] ${level.className}`} />
                <span className="text-[10px] text-slate-400">{level.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-[3px] ${NOTES_ONLY_CLASS}`} />
            Journal notes only
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="relative w-3 h-3 rounded-[3px] bg-[#7a947c]">
              <span className="absolute top-[2px] right-[2px] w-[4px] h-[4px] rounded-full bg-[#9a86b9] ring-1 ring-white" />
            </span>
            Notes on a reading day
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-[3px] bg-white ring-2 ring-[#c5a24a]" />
            Today
          </span>
        </div>
      </div>
    </section>
  );
}