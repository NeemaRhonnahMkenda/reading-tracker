"use client";

// src/app/diary/page.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import Button from "../components/ui/Button";
import Toast, { useToast } from "../components/ui/Toast";
import { supabase } from "../../lib/supabase";
import {
  ACTIVITY_WINDOW_DAYS,
  BookOption,
  JournalDay,
  ReadingSession,
  ReadingStats,
  SessionDraft,
  addDays,
  buildActivity,
  dayHeading,
  fetchBookOptions,
  fetchJournalDays,
  fetchOldestActivityDate,
  fetchReadingStats,
  fetchSessionsInRange,
  formatMinutes,
  localDateString,
  sortBooksForPicker,
  todayMinutes,
} from "../../lib/reading";

import GoalPicker from "./_components/GoalPicker";
import JournalDayCard from "./_components/JournalDayCard";
import LogSessionSheet, { BookStatusChange } from "./_components/LogSessionSheet";
import ReadingHeatmap from "./_components/ReadingHeatmap";
import SessionCard from "./_components/SessionCard";
import StatTiles from "./_components/StatTiles";
import StreakCelebration from "./_components/StreakCelebration";
import StreakFlame from "./_components/StreakFlame";
import StreakHero from "./_components/StreakHero";

const MAX_EMPTY_WINDOWS = 24; // stop paging back after ~2 years of empty windows

export default function DiaryPage() {
  const router = useRouter();
  const { toast, showToast, dismissToast } = useToast();

  // Data
  const [userId, setUserId] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [journalDays, setJournalDays] = useState<JournalDay[]>([]);
  const [windowStart, setWindowStart] = useState(""); // oldest day loaded
  const [oldestActivity, setOldestActivity] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  // UI
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ReadingSession | null>(null);
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [logBookId, setLogBookId] = useState<string | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [celebration, setCelebration] = useState<{ streak: number; goalMet: boolean } | null>(null);

  // --------------------------------------------------
  // Load
  // --------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session?.user) {
      router.replace("/login");
      return;
    }

    const uid = session.user.id;
    const localToday = localDateString();
    const from = addDays(localToday, -(ACTIVITY_WINDOW_DAYS - 1));

    setUserId(uid);
    setToday(localToday);

    try {
      const [nextStats, nextBooks, nextSessions, nextJournal, oldest] = await Promise.all([
        fetchReadingStats(localToday),
        fetchBookOptions(uid),
        fetchSessionsInRange(uid, from, localToday),
        fetchJournalDays(from, localToday),
        fetchOldestActivityDate(uid),
      ]);

      setStats(nextStats);
      setBooks(nextBooks);
      setSessions(nextSessions);
      setJournalDays(nextJournal);
      setWindowStart(from);
      setOldestActivity(oldest);

      // /diary?log=<bookId> opens the log sheet for that book (e.g. from a book page)
      const requested = new URLSearchParams(window.location.search).get("log");
      if (requested !== null) {
        if (nextBooks.some((b) => b.id === requested)) setLogBookId(requested);
        setSheetOpen(true);
        window.history.replaceState(null, "", "/diary");
      }
    } catch (err) {
      console.error("Diary load failed:", (err as Error)?.message ?? err);
      setLoadError("Your diary couldn't be loaded. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // Only reload if a different user signs in (not when you return to the tab)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") router.replace("/login");
      else if (session?.user && userId && session.user.id !== userId) load();
    });
    return () => subscription.unsubscribe();
  }, [userId, load, router]);

  const refreshStats = useCallback(async () => {
    if (!today) return null;
    try {
      const fresh = await fetchReadingStats(today);
      setStats(fresh);
      return fresh;
    } catch (err) {
      console.error("Stats refresh failed:", (err as Error)?.message ?? err);
      return null;
    }
  }, [today]);

  // Journal days depend on sessions (a session hides that day's journal card)
  const refreshJournalDays = useCallback(async () => {
    if (!today || !windowStart) return;
    try {
      setJournalDays(await fetchJournalDays(windowStart, today));
    } catch (err) {
      console.error("Journal refresh failed:", (err as Error)?.message ?? err);
    }
  }, [today, windowStart]);

  // Page back through older activity, skipping empty stretches
  async function loadOlder() {
    if (!userId || !oldestActivity || loadingMore) return;
    setLoadingMore(true);

    try {
      let to = addDays(windowStart, -1);
      let from = addDays(to, -(ACTIVITY_WINDOW_DAYS - 1));
      const olderSessions: ReadingSession[] = [];
      const olderJournal: JournalDay[] = [];

      for (let i = 0; i < MAX_EMPTY_WINDOWS; i++) {
        const [s, j] = await Promise.all([fetchSessionsInRange(userId, from, to), fetchJournalDays(from, to)]);
        olderSessions.push(...s);
        olderJournal.push(...j);
        if (s.length || j.length || from <= oldestActivity) break;
        to = addDays(from, -1);
        from = addDays(to, -(ACTIVITY_WINDOW_DAYS - 1));
      }

      setSessions((current) => [...current, ...olderSessions]);
      setJournalDays((current) => [...current, ...olderJournal]);
      setWindowStart(from);
    } catch (err) {
      console.error("Load older failed:", (err as Error)?.message ?? err);
      showToast("error", "Older entries couldn't be loaded. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  // --------------------------------------------------
  // Logging, editing, deleting
  // --------------------------------------------------

  const defaultBookId = useMemo(
    () => logBookId ?? sessions[0]?.book_id ?? journalDays[0]?.book_id ?? sortBooksForPicker(books)[0]?.id ?? null,
    [logBookId, sessions, journalDays, books]
  );

  function openLog() {
    setEditing(null);
    setDraft(null);
    setSheetOpen(true);
  }

  function openEdit(session: ReadingSession) {
    setDraft(null);
    setEditing(session);
    setSheetOpen(true);
  }

  // Turn a journal-only day into a session: positions are prefilled, you add the time
  function openFromJournal(day: JournalDay) {
    setEditing(null);
    setDraft({
      book_id: day.book_id,
      session_date: day.activity_date,
      start_chapter: null,
      start_page: day.start_page,
      end_chapter: day.last_chapter,
      end_page: day.end_page,
    });
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditing(null);
    setDraft(null);
    setLogBookId(null);
  }

  async function handleSaved(saved: ReadingSession, bookChange: BookStatusChange | null) {
    const wasEdit = !!editing;
    const previous = stats;

    setSessions((current) => {
      const without = current.filter((s) => s.id !== saved.id);
      return saved.session_date >= windowStart ? [saved, ...without] : without;
    });

    // A session on this day replaces the journal card for that book
    setJournalDays((current) =>
      current.filter((d) => !(d.book_id === saved.book_id && d.activity_date === saved.session_date))
    );

    if (bookChange) {
      setBooks((current) => current.map((b) => (b.id === bookChange.id ? { ...b, status: bookChange.status } : b)));
    }

    closeSheet();

    const [fresh] = await Promise.all([refreshStats(), wasEdit ? refreshJournalDays() : Promise.resolve()]);

    if (!oldestActivity || saved.session_date < oldestActivity) setOldestActivity(saved.session_date);

    // First reading of the day: celebrate the streak
    if (!wasEdit && fresh && previous && !previous.read_today && fresh.read_today) {
      setCelebration({ streak: fresh.current_streak, goalMet: todayMinutes(fresh) >= fresh.goal_minutes });
      return;
    }

    const goalJustMet =
      !wasEdit && fresh && previous && todayMinutes(previous) < previous.goal_minutes && todayMinutes(fresh) >= fresh.goal_minutes;

    if (bookChange?.status === "finished") showToast("success", "Finished. It's on your Finished shelf now.");
    else if (goalJustMet) showToast("success", "You've met today's reading goal.");
    else showToast("success", wasEdit ? "Session updated." : `Logged ${formatMinutes(saved.minutes_read)}.`);
  }

  async function handleDelete(id: string) {
    if (!userId) return;

    const previous = sessions;
    setSessions((current) => current.filter((s) => s.id !== id));

    const { error } = await supabase.from("reading_sessions").delete().eq("id", id).eq("user_id", userId);

    if (error) {
      console.error("Delete failed:", error.message);
      setSessions(previous);
      showToast("error", "The session couldn't be deleted. Try again.");
      return;
    }

    // Journal notes from that day may now show again
    await Promise.all([refreshStats(), refreshJournalDays()]);
    showToast("success", "Session deleted.");
  }

  // --------------------------------------------------
  // Derived
  // --------------------------------------------------

  const groups = useMemo(() => buildActivity(sessions, journalDays), [sessions, journalDays]);
  const hasOlder = !!oldestActivity && !!windowStart && oldestActivity < windowStart;

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] relative overflow-x-clip">
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[120px]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[120px]" />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }

            .soft-surface { background: rgba(255, 255, 255, 0.65); backdrop-filter: blur(12px); }
            .soft-border { border-color: rgba(15, 23, 42, 0.08); }

            .journal-paper {
              --line: 32px;
              --pad: 16px;
              --rule: rgba(15, 23, 42, 0.08);
              --rule-at: calc(var(--line) * 0.78);
              line-height: var(--line);
              padding-top: var(--pad);
              padding-bottom: var(--pad);
              background-color: #fefcf6;
              background-image: linear-gradient(to bottom, transparent var(--rule-at), var(--rule) var(--rule-at), var(--rule) calc(var(--rule-at) + 1px), transparent calc(var(--rule-at) + 1px));
              background-size: 100% var(--line);
              background-position: 0 var(--pad);
              background-attachment: local;
            }

            @keyframes streak-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.04) } }
            @keyframes streak-flicker { 0%, 100% { opacity: 1 } 50% { opacity: .55 } }
            .streak-breathe { animation: streak-breathe 3.5s ease-in-out infinite; transform-origin: 50% 90%; }
            .streak-flicker { animation: streak-flicker 2.4s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) { .streak-breathe, .streak-flicker { animation: none; } }
          `,
        }}
      />

      <Navbar isLoggedIn={!!userId || undefined} />

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 pb-32 lg:pb-24 relative z-10">
        <header className="mb-10">
          <p className="tracking-[0.25em] text-sm text-[#7a947c] font-medium mb-3">Your reading</p>
          <h1 className="text-5xl md:text-6xl font-classical font-semibold text-[#0f172a]">Diary</h1>
          <p className="mt-4 text-slate-600 font-light max-w-xl text-lg">
            Log each time you read. Journal notes count too, so your streak keeps going either way.
          </p>
        </header>

        {loading ? (
          <DiarySkeleton />
        ) : loadError || !stats || !userId ? (
          <div className="soft-surface rounded-[1.6rem] border soft-border p-10 text-center">
            <p role="alert" className="text-[#a14e43]">{loadError || "Your diary couldn't be loaded."}</p>
            <Button variant="dark" className="mt-6" onClick={load}>Try again</Button>
          </div>
        ) : (
          <>
            <StreakHero stats={stats} onLog={openLog} onChangeGoal={() => setGoalOpen(true)} />

            <div className="mt-10 grid lg:grid-cols-[minmax(0,1fr)_380px] gap-8 lg:gap-10 items-start">
              {/* Stats + heatmap (first on mobile) */}
              <aside className="space-y-6 lg:order-2 lg:sticky lg:top-24">
                <StatTiles stats={stats} />
                <ReadingHeatmap days={stats.days} today={stats.today} />
              </aside>

              {/* Activity */}
              <div className="lg:order-1 min-w-0">
                <h2 className="font-classical text-3xl font-semibold text-[#0f172a] mb-6">Your reading</h2>

                {groups.length === 0 ? (
                  <div className="soft-surface border border-dashed border-[#0f172a]/12 rounded-[1.6rem] p-10 sm:p-14 text-center">
                    <StreakFlame lit={false} size={52} className="mx-auto" />
                    <h3 className="mt-5 font-classical text-2xl font-semibold">
                      {hasOlder ? "Nothing in the last month" : "Nothing logged yet"}
                    </h3>
                    <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto leading-6 font-light">
                      Read for a few minutes, then log it here. Notes in a book&apos;s journal count towards your streak too.
                    </p>
                    <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                      <Button variant="primary" onClick={openLog}>Log reading</Button>
                      {hasOlder && (
                        <Button variant="outline" onClick={loadOlder} loading={loadingMore}>Show older entries</Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-10">
                    {groups.map((group) => (
                      <section key={group.date} aria-labelledby={`day-${group.date}`}>
                        <div className="flex items-baseline justify-between gap-3 mb-4 pb-2 border-b border-[#0f172a]/8">
                          <h3 id={`day-${group.date}`} className="font-classical text-xl font-semibold text-[#0f172a]">
                            {dayHeading(group.date, today)}
                          </h3>
                          {group.minutes > 0 && <span className="text-sm text-slate-400">{formatMinutes(group.minutes)}</span>}
                        </div>
                        <div className="space-y-4">
                          {group.items.map((item) =>
                            item.kind === "session" ? (
                              <SessionCard key={item.key} session={item.session} onEdit={openEdit} onDelete={handleDelete} />
                            ) : (
                              <JournalDayCard key={item.key} day={item.day} onAddTime={openFromJournal} />
                            )
                          )}
                        </div>
                      </section>
                    ))}

                    {hasOlder && (
                      <div className="text-center">
                        <Button variant="outline" onClick={loadOlder} loading={loadingMore}>
                          {loadingMore ? "Loading…" : "Show older entries"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Log button within thumb reach on phones */}
      {!loading && stats && !sheetOpen && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 px-5 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-[#fdfaf3] via-[#fdfaf3]/95 to-transparent">
          <Button variant="primary" size="lg" fullWidth onClick={openLog}>
            <span aria-hidden="true">✎</span>
            Log reading
          </Button>
        </div>
      )}

      {userId && (
        <LogSessionSheet
          open={sheetOpen}
          onClose={closeSheet}
          userId={userId}
          books={books}
          today={today}
          initial={editing}
          draft={draft}
          defaultBookId={defaultBookId}
          onSaved={handleSaved}
        />
      )}

      {userId && stats && (
        <GoalPicker
          open={goalOpen}
          onClose={() => setGoalOpen(false)}
          userId={userId}
          current={stats.goal_minutes}
          onSaved={(minutes) => {
            setGoalOpen(false);
            setStats((current) => (current ? { ...current, goal_minutes: minutes } : current));
            showToast("success", `Daily goal set to ${minutes} minutes.`);
          }}
        />
      )}

      {stats && celebration && (
        <StreakCelebration
          open
          streak={celebration.streak}
          goalMet={celebration.goalMet}
          days={stats.days}
          today={stats.today}
          onClose={() => setCelebration(null)}
        />
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
    </main>
  );
}

function DiarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your diary" className="animate-pulse">
      <div className="h-72 rounded-[1.6rem] bg-slate-900/[0.06]" />
      <div className="mt-10 grid lg:grid-cols-[minmax(0,1fr)_380px] gap-10">
        <div className="space-y-4 lg:order-1">
          <div className="h-8 w-48 rounded-xl bg-slate-900/[0.06]" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-[1.4rem] bg-slate-900/[0.06]" />
          ))}
        </div>
        <div className="space-y-6 lg:order-2">
          <div className="grid grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-slate-900/[0.06]" />
            ))}
          </div>
          <div className="h-60 rounded-[1.6rem] bg-slate-900/[0.06]" />
        </div>
      </div>
    </div>
  );
}