// src/app/diary/_components/StreakHero.tsx

import Button, { focusRing } from "../../components/ui/Button";
import { ReadingStats, formatMinutes, todayMinutes } from "../../../lib/reading";
import GoalRing from "./GoalRing";
import StreakFlame from "./StreakFlame";
import WeekStrip from "./WeekStrip";

function streakState(stats: ReadingStats) {
  const { current_streak: streak, read_today: readToday, totals } = stats;

  if (totals.sessions === 0 && totals.notes === 0) {
    return { pill: "No streak yet", message: "Log a session or write a journal note to light the flame." };
  }
  if (readToday) {
    return {
      pill: "Streak safe today",
      message: streak === 1 ? "Day one. Read again tomorrow to make it two." : "You've read today. Come back tomorrow to keep it going.",
    };
  }
  if (streak > 0) return { pill: "Read today", message: `Read today to keep your ${streak}-day streak.` };
  return { pill: "Streak ended", message: "Your streak went out. Read today to start a new one." };
}

export default function StreakHero({
  stats,
  onLog,
  onChangeGoal,
}: {
  stats: ReadingStats;
  onLog: () => void;
  onChangeGoal: () => void;
}) {
  const minutesToday = todayMinutes(stats);
  const goalMet = minutesToday >= stats.goal_minutes;
  const atRisk = !stats.read_today && stats.current_streak > 0;
  const { pill, message } = streakState(stats);

  return (
    <section
      aria-labelledby="streak-heading"
      className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)]"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-8 lg:gap-12 p-6 sm:p-8 lg:p-10">
        {/* Streak */}
        <div className="min-w-0">
          <span
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium border ${
              atRisk
                ? "bg-[#fbf3e2] text-[#8a6a22] border-[#c69a3d]/25"
                : "bg-[#f7f5fa] text-[#6c5c85] border-[#9a86b9]/20"
            }`}
          >
            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${atRisk ? "bg-[#c69a3d]" : "bg-[#9a86b9]"}`} />
            {pill}
          </span>

          <div className="mt-6 flex items-center gap-4 sm:gap-6">
            <StreakFlame
              lit={stats.read_today}
              size={72}
              className={`shrink-0 ${atRisk ? "streak-flicker" : stats.read_today ? "streak-breathe" : ""}`}
            />
            <div>
              <h2 id="streak-heading" className="flex items-baseline gap-3">
                <span className="font-classical font-semibold text-6xl sm:text-7xl leading-none text-[#0f172a] tabular-nums">
                  {stats.current_streak}
                </span>
                <span className="text-lg sm:text-xl text-slate-500 font-light">
                  day streak
                </span>
              </h2>
              <p className="mt-2 text-slate-600 font-light">{message}</p>
            </div>
          </div>

          <div className="mt-8 max-w-md">
            <WeekStrip days={stats.days} today={stats.today} />
          </div>

          <p className="mt-6 text-sm text-slate-400">
            Longest streak{" "}
            <span className="font-classical text-base text-[#0f172a]">
              {stats.longest_streak} {stats.longest_streak === 1 ? "day" : "days"}
            </span>
          </p>
        </div>

        {/* Today's goal + log */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-center lg:items-stretch gap-6 lg:border-l lg:border-[#0f172a]/8 lg:pl-12">
          <div className="flex items-center gap-5 lg:flex-col lg:text-center">
            <GoalRing value={minutesToday} goal={stats.goal_minutes}>
              <span className="font-classical text-3xl leading-none text-[#0f172a] tabular-nums">{minutesToday}</span>
              <span className="text-[11px] text-slate-400 mt-1">of {stats.goal_minutes} min</span>
            </GoalRing>
            <div>
              <p className="font-classical text-xl font-semibold text-[#0f172a]">{goalMet ? "Goal complete" : "Today's goal"}</p>
              <p className="text-sm text-slate-500 font-light">
                {goalMet ? `${formatMinutes(minutesToday)} read today` : `${formatMinutes(stats.goal_minutes - minutesToday)} to go`}
              </p>
              <button
                type="button"
                onClick={onChangeGoal}
                className={`mt-1.5 text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
              >
                Change goal
              </button>
            </div>
          </div>

          <Button variant="primary" size="lg" fullWidth onClick={onLog} className="sm:max-w-xs lg:max-w-none">
            <span aria-hidden="true">✎</span>
            Log reading
          </Button>
        </div>
      </div>
    </section>
  );
}
