// src/app/diary/_components/ReadingHeatmap.tsx
// Twelve weeks, one square per day. Sage by minutes read; lilac for journal-only days.

import { addDays, DayStat, formatDay, formatMinutes, weekdayIndex } from "../../../lib/reading";

const WEEKS = 12;
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

const LEVELS = [
  { max: 0, className: "bg-[#0f172a]/[0.05]", label: "No reading" },
  { max: 14, className: "bg-[#d5e0d6]", label: "Under 15 min" },
  { max: 29, className: "bg-[#adc1ae]", label: "15 to 29 min" },
  { max: 59, className: "bg-[#7a947c]", label: "30 to 59 min" },
  { max: Infinity, className: "bg-[#4f6651]", label: "An hour or more" },
];

const NOTES_ONLY = { className: "bg-[#d8d0e3]", label: "Journal notes only" };

function cellClass(stat: DayStat | undefined) {
  if (stat && stat.sessions === 0 && stat.notes > 0) return NOTES_ONLY.className;
  const minutes = stat?.minutes ?? 0;
  return LEVELS[LEVELS.findIndex((level) => minutes <= level.max)].className;
}

function describe(date: string, stat: DayStat | undefined) {
  const name = formatDay(date, { weekday: "short", day: "numeric", month: "short" });
  if (!stat || (stat.sessions === 0 && stat.notes === 0)) return `${name}: no reading`;
  const parts: string[] = [];
  if (stat.minutes) parts.push(formatMinutes(stat.minutes));
  if (stat.pages) parts.push(`${stat.pages} pages`);
  if (stat.notes) parts.push(`${stat.notes} ${stat.notes === 1 ? "note" : "notes"}`);
  return `${name}: ${parts.join(", ")}`;
}

export default function ReadingHeatmap({ days, today }: { days: DayStat[]; today: string }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const firstMonday = addDays(addDays(today, -weekdayIndex(today)), -(WEEKS - 1) * 7);

  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(firstMonday, w * 7 + d))
  );

  const activeDays = days.filter((d) => d.date >= firstMonday && (d.sessions > 0 || d.notes > 0)).length;

  return (
    <section
      aria-labelledby="heatmap-heading"
      className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)] p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <h2 id="heatmap-heading" className="font-classical text-2xl font-semibold text-[#0f172a]">Last 12 weeks</h2>
        <p className="text-sm text-slate-400">
          {activeDays} reading {activeDays === 1 ? "day" : "days"}
        </p>
      </div>

      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="flex gap-[5px] w-max">
          <div className="flex flex-col gap-[5px] pr-1 pt-5" aria-hidden="true">
            {DAY_LABELS.map((label, i) => (
              <span key={i} className="h-[15px] text-[10px] leading-[15px] text-slate-400">{label}</span>
            ))}
          </div>

          {weeks.map((week, w) => {
            const monthStart = week.find((d) => d.endsWith("-01"));
            const label = w === 0 ? formatDay(week[0], { month: "short" }) : monthStart ? formatDay(monthStart, { month: "short" }) : "";

            return (
              <div key={week[0]} className="flex flex-col gap-[5px]">
                <span className="h-[15px] text-[10px] leading-[15px] text-slate-400 whitespace-nowrap" aria-hidden="true">{label}</span>
                {week.map((date) => {
                  if (date > today) return <span key={date} className="w-[15px] h-[15px]" aria-hidden="true" />;
                  const stat = byDate.get(date);
                  const description = describe(date, stat);
                  return (
                    <span
                      key={date}
                      role="img"
                      aria-label={description}
                      title={description}
                      className={`w-[15px] h-[15px] rounded-[4px] ${cellClass(stat)} ${
                        date === today ? "ring-2 ring-[#c5a24a] ring-offset-1 ring-offset-[#fdfaf3]" : ""
                      }`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-[13px] h-[13px] rounded-[3px] ${NOTES_ONLY.className}`} />
          {NOTES_ONLY.label}
        </span>
        <span className="inline-flex items-center gap-1.5">
          Less
          {LEVELS.map((level) => (
            <span key={level.label} title={level.label} className={`w-[13px] h-[13px] rounded-[3px] ${level.className}`} />
          ))}
          More
        </span>
      </div>
    </section>
  );
}
