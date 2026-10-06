// src/lib/reading.ts
// Types, formatting helpers and queries shared by the Diary page and its components.

import { supabase } from "./supabase";

// --------------------------------------------------
// Types
// --------------------------------------------------

export interface BookOption {
  id: string;
  title: string;
  author: string | null;
  status: string | null;
  cover_url: string | null;
}

export interface ReadingSession {
  id: string;
  user_id: string;
  book_id: string;
  session_date: string; // YYYY-MM-DD, the reader's local date
  start_chapter: string | null;
  start_page: number | null;
  end_chapter: string | null;
  end_page: number | null;
  minutes_read: number;
  thoughts: string | null;
  created_at: string;
  updated_at: string;
  book: { id: string; title: string; author: string | null; cover_url: string | null } | null;
}

// A day where you wrote journal notes for a book but didn't log a session for it
export interface JournalDay {
  book_id: string;
  activity_date: string;
  notes: number;
  first_chapter: string | null;
  last_chapter: string | null;
  start_page: number | null; // furthest page known before this day
  end_page: number | null; // furthest page noted this day
  pages: number;
  book_title: string;
  book_author: string | null;
  cover_url: string | null;
}

export type ActivityItem =
  | { kind: "session"; key: string; date: string; session: ReadingSession }
  | { kind: "journal"; key: string; date: string; day: JournalDay };

export interface DayStat {
  date: string;
  minutes: number;
  pages: number;
  sessions: number;
  notes: number;
}

export interface ReadingStats {
  today: string;
  current_streak: number;
  longest_streak: number;
  read_today: boolean;
  goal_minutes: number;
  totals: { sessions: number; minutes: number; pages: number; books: number; notes: number };
  days: DayStat[];
}

export type SessionInput = {
  book_id: string;
  session_date: string;
  start_chapter: string | null;
  start_page: number | null;
  end_chapter: string | null;
  end_page: number | null;
  minutes_read: number;
  thoughts: string | null;
};

// Prefill for a new session (e.g. turning a journal day into a session)
export type SessionDraft = Omit<SessionInput, "minutes_read" | "thoughts"> & { thoughts?: string | null };

// --------------------------------------------------
// Constants
// --------------------------------------------------

export const SESSION_COLUMNS =
  "id, user_id, book_id, session_date, start_chapter, start_page, end_chapter, end_page, minutes_read, thoughts, created_at, updated_at, book:books(id, title, author, cover_url)";

export const ACTIVITY_WINDOW_DAYS = 30;
export const STATS_DAYS = 98; // 14 weeks: enough for the heatmap plus padding

export const STATUS_ORDER: Record<string, number> = {
  reading: 0,
  want_to_read: 1,
  did_not_finish: 2,
  finished: 3,
};

export const STATUS_LABEL: Record<string, string> = {
  reading: "Currently reading",
  want_to_read: "Want to read",
  did_not_finish: "Did not finish",
  finished: "Finished",
};

// --------------------------------------------------
// Dates
// --------------------------------------------------

// Local calendar date as YYYY-MM-DD (not UTC)
export function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

// Monday = 0 … Sunday = 6
export function weekdayIndex(date: string) {
  return (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
}

export function formatDay(date: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", options);
}

export function dayHeading(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return formatDay(
    date,
    sameYear
      ? { weekday: "long", day: "numeric", month: "long" }
      : { weekday: "long", day: "numeric", month: "long", year: "numeric" }
  );
}

// --------------------------------------------------
// Formatting
// --------------------------------------------------

export function formatMinutes(total: number) {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function pagesRead(session: Pick<ReadingSession, "start_page" | "end_page">) {
  if (session.start_page == null || session.end_page == null) return null;
  return Math.max(session.end_page - session.start_page, 0);
}

// "12" -> "Chapter 12"; "Prologue" stays "Prologue"
export function chapterLabel(chapter: string) {
  const trimmed = chapter.trim();
  return /^\d+$/.test(trimmed) ? `Chapter ${trimmed}` : trimmed;
}

// "Chapter 4, page 120" / "Page 120" / "Prologue"
export function locationLabel(chapter: string | null, page: number | null) {
  const hasChapter = !!chapter?.trim();
  if (hasChapter && page != null) return `${chapterLabel(chapter!)}, page ${page}`;
  if (hasChapter) return chapterLabel(chapter!);
  if (page != null) return `Page ${page}`;
  return "";
}

// Returns a number, null (empty) or "invalid"
export function parseWholeNumber(value: string, min: number, max: number): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const n = Number(trimmed);
  return n < min || n > max ? "invalid" : n;
}

export function todayMinutes(stats: ReadingStats) {
  return stats.days.find((d) => d.date === stats.today)?.minutes ?? 0;
}

// A day counts if you logged a session or wrote a journal note
export function isActiveDay(day: DayStat | undefined) {
  return !!day && (day.sessions > 0 || day.notes > 0);
}

export function sortBooksForPicker(books: BookOption[]) {
  return [...books].sort((a, b) => {
    const byStatus = (STATUS_ORDER[a.status ?? "want_to_read"] ?? 9) - (STATUS_ORDER[b.status ?? "want_to_read"] ?? 9);
    return byStatus !== 0 ? byStatus : a.title.localeCompare(b.title);
  });
}

// Sessions and journal days, newest day first; sessions before journal days
export function buildActivity(sessions: ReadingSession[], journalDays: JournalDay[]) {
  const items: ActivityItem[] = [
    ...sessions.map((session) => ({
      kind: "session" as const,
      key: `s-${session.id}`,
      date: session.session_date,
      session,
    })),
    ...journalDays.map((day) => ({
      kind: "journal" as const,
      key: `j-${day.book_id}-${day.activity_date}`,
      date: day.activity_date,
      day,
    })),
  ];

  items.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.kind !== b.kind) return a.kind === "session" ? -1 : 1;
    if (a.kind === "session" && b.kind === "session") return b.session.created_at.localeCompare(a.session.created_at);
    return 0;
  });

  const groups: { date: string; items: ActivityItem[]; minutes: number }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    const minutes = item.kind === "session" ? item.session.minutes_read : 0;
    if (last && last.date === item.date) {
      last.items.push(item);
      last.minutes += minutes;
    } else {
      groups.push({ date: item.date, items: [item], minutes });
    }
  }
  return groups;
}

// --------------------------------------------------
// Queries
// --------------------------------------------------

export async function fetchReadingStats(today: string): Promise<ReadingStats> {
  const { data, error } = await supabase.rpc("get_reading_stats", { p_today: today, p_days: STATS_DAYS });
  if (error) throw error;
  return data as ReadingStats;
}

export async function fetchSessionsInRange(userId: string, from: string, to: string) {
  const { data, error } = await supabase
    .from("reading_sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", userId)
    .gte("session_date", from)
    .lte("session_date", to)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as ReadingSession[];
}

export async function fetchJournalDays(from: string, to: string) {
  const { data, error } = await supabase.rpc("journal_reading_days", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as JournalDay[];
}

// Earliest day with any reading activity, to know when to stop paging back
export async function fetchOldestActivityDate(userId: string) {
  const [sessionResult, journalResult] = await Promise.all([
    supabase
      .from("reading_sessions")
      .select("session_date")
      .eq("user_id", userId)
      .order("session_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("book_journal_entries")
      .select("entry_date")
      .eq("user_id", userId)
      .order("entry_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (sessionResult.error) throw sessionResult.error;
  if (journalResult.error) throw journalResult.error;

  const dates = [
    (sessionResult.data as { session_date: string } | null)?.session_date,
    (journalResult.data as { entry_date: string } | null)?.entry_date,
  ].filter((d): d is string => !!d);

  return dates.length ? dates.sort()[0] : null;
}

export async function fetchBookOptions(userId: string) {
  const { data, error } = await supabase
    .from("books")
    .select("id, title, author, status, cover_url")
    .eq("user_id", userId)
    .order("title");

  if (error) throw error;
  return (data ?? []) as BookOption[];
}

// Where you stopped last time in this book: latest session or journal note
export async function fetchLastPosition(bookId: string) {
  const [sessionResult, journalResult] = await Promise.all([
    supabase
      .from("reading_sessions")
      .select("end_chapter, end_page, session_date, created_at")
      .eq("book_id", bookId)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("book_journal_entries")
      .select("chapter, page_number, entry_date, created_at")
      .eq("book_id", bookId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (sessionResult.error) throw sessionResult.error;
  if (journalResult.error) throw journalResult.error;

  const session = sessionResult.data as { end_chapter: string | null; end_page: number | null; session_date: string; created_at: string } | null;
  const note = journalResult.data as { chapter: string | null; page_number: number | null; entry_date: string; created_at: string } | null;

  const fromSession = session && { chapter: session.end_chapter, page: session.end_page, date: session.session_date, at: session.created_at, source: "session" as const };
  const fromNote = note && { chapter: note.chapter, page: note.page_number, date: note.entry_date, at: note.created_at, source: "journal" as const };

  if (!fromSession) return fromNote;
  if (!fromNote) return fromSession;

  // Most recent wins: later day, then later time
  if (fromNote.date !== fromSession.date) return fromNote.date > fromSession.date ? fromNote : fromSession;
  return fromNote.at > fromSession.at ? fromNote : fromSession;
}