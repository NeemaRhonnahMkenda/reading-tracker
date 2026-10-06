"use client";

// src/app/diary/_components/LogSessionSheet.tsx
// Log a new reading session, or edit an existing one.
// Responsive: bottom sheet on phones, centred dialog from tablet up.

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Button, { focusRing } from "../../components/ui/Button";
import Modal, { ModalHeader } from "../../components/ui/Modal";
import { supabase } from "../../../lib/supabase";
import {
  BookOption,
  ReadingSession,
  SESSION_COLUMNS,
  STATUS_LABEL,
  SessionDraft,
  SessionInput,
  fetchLastPosition,
  formatMinutes,
  locationLabel,
  parseWholeNumber,
  sortBooksForPicker,
} from "../../../lib/reading";
import BookThumb from "./BookThumb";

const QUICK_MINUTES = [15, 30, 45, 60, 90];
const MAX_THOUGHTS = 2000;

// 16px text on phones stops iOS Safari zooming in when a field is focused;
// min-w-0 lets fields (especially the date picker) shrink inside grids
const fieldClass =
  "w-full min-w-0 h-12 sm:h-11 px-3.5 bg-white border border-[#0f172a]/10 rounded-xl text-base sm:text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all";

const labelClass = "block text-xs font-medium text-slate-500 mb-1.5";

const legendClass = "font-classical text-lg sm:text-xl font-semibold text-[#0f172a]";

// 90 -> { hours: "1", minutes: "30" }; 45 -> { hours: "", minutes: "45" }
function splitDuration(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return { hours: h ? String(h) : "", minutes: m || !h ? String(m) : "" };
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export interface BookStatusChange {
  id: string;
  status: string;
}

interface LogSessionSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  books: BookOption[];
  today: string;
  initial?: ReadingSession | null; // editing an existing session
  draft?: SessionDraft | null; // prefilled new session (e.g. from a journal day)
  defaultBookId?: string | null;
  onSaved: (session: ReadingSession, bookChange: BookStatusChange | null) => void;
}

export default function LogSessionSheet({
  open,
  onClose,
  userId,
  books,
  today,
  initial = null,
  draft = null,
  defaultBookId = null,
  onSaved,
}: LogSessionSheetProps) {
  const isEdit = !!initial;
  const sortedBooks = useMemo(() => sortBooksForPicker(books), [books]);

  const [bookId, setBookId] = useState("");
  const [bookQuery, setBookQuery] = useState("");
  const [startChapter, setStartChapter] = useState("");
  const [startPage, setStartPage] = useState("");
  const [endChapter, setEndChapter] = useState("");
  const [endPage, setEndPage] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [date, setDate] = useState(today);
  const [thoughts, setThoughts] = useState("");
  const [finished, setFinished] = useState(false);

  const [prefillNote, setPrefillNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Don't overwrite a start position that's prefilled or typed by the reader
  const startTouchedRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement | null>(null);

  // ---------- Reset when opened ----------

  useEffect(() => {
    if (!open) return;

    setError("");
    setBookQuery("");
    setPrefillNote("");
    setFinished(false);
    startTouchedRef.current = false;

    if (initial) {
      const duration = splitDuration(initial.minutes_read);
      setBookId(initial.book_id);
      setStartChapter(initial.start_chapter ?? "");
      setStartPage(initial.start_page != null ? String(initial.start_page) : "");
      setEndChapter(initial.end_chapter ?? "");
      setEndPage(initial.end_page != null ? String(initial.end_page) : "");
      setHours(duration.hours);
      setMinutes(duration.minutes);
      setDate(initial.session_date);
      setThoughts(initial.thoughts ?? "");
      return;
    }

    if (draft) {
      startTouchedRef.current = true; // keep the journal's positions
      setBookId(draft.book_id);
      setStartChapter(draft.start_chapter ?? "");
      setStartPage(draft.start_page != null ? String(draft.start_page) : "");
      setEndChapter(draft.end_chapter ?? "");
      setEndPage(draft.end_page != null ? String(draft.end_page) : "");
      setHours("");
      setMinutes("");
      setDate(draft.session_date);
      setThoughts(draft.thoughts ?? "");
      setPrefillNote("Filled in from your journal notes. Add how long you read.");
      return;
    }

    setBookId(books.some((b) => b.id === defaultBookId) ? defaultBookId! : sortedBooks[0]?.id ?? "");
    setStartChapter("");
    setStartPage("");
    setEndChapter("");
    setEndPage("");
    setHours("");
    setMinutes("");
    setDate(today);
    setThoughts("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------- Pick up where you last stopped (session or journal note) ----------

  useEffect(() => {
    if (!open || isEdit || !bookId || startTouchedRef.current) return;

    let cancelled = false;
    setPrefillNote("");

    fetchLastPosition(bookId)
      .then((last) => {
        if (cancelled || startTouchedRef.current) return;

        setStartChapter(last?.chapter ?? "");
        setStartPage(last?.page != null ? String(last.page) : "");

        const where = last ? locationLabel(last.chapter, last.page) : "";
        if (where) {
          const source = last!.source === "journal" ? "in your journal" : "last session";
          setPrefillNote(`You were at ${lowerFirst(where)} ${source}.`);
        }
      })
      .catch((err) => console.error("Couldn't load last position:", err?.message));

    return () => {
      cancelled = true;
    };
  }, [open, isEdit, bookId]);

  // On a small screen the error sits in the footer; make sure it's seen
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  // ---------- Derived ----------

  const selectedBook = books.find((b) => b.id === bookId) ?? null;

  const visibleBooks = useMemo(() => {
    const term = bookQuery.trim().toLowerCase();
    if (!term) return sortedBooks;
    return sortedBooks.filter((b) => b.title.toLowerCase().includes(term) || (b.author ?? "").toLowerCase().includes(term));
  }, [sortedBooks, bookQuery]);

  const parsedHours = parseWholeNumber(hours, 0, 24);
  const parsedMinutes = parseWholeNumber(minutes, 0, 600);
  const totalMinutes =
    (parsedHours === "invalid" ? 0 : (parsedHours ?? 0) * 60) + (parsedMinutes === "invalid" ? 0 : parsedMinutes ?? 0);

  const parsedStart = parseWholeNumber(startPage, 0, 100000);
  const parsedEnd = parseWholeNumber(endPage, 0, 100000);
  const pagePreview =
    typeof parsedStart === "number" && typeof parsedEnd === "number" && parsedEnd >= parsedStart ? parsedEnd - parsedStart : null;

  const willStartReading = !isEdit && !finished && (selectedBook?.status === "want_to_read" || !selectedBook?.status);

  function setQuickDuration(total: number) {
    const duration = splitDuration(total);
    setHours(duration.hours);
    setMinutes(duration.minutes);
  }

  function changeBook(id: string) {
    if (id === bookId) return;
    startTouchedRef.current = false; // new book: fetch its last position
    setBookId(id);
  }

  function touchStart() {
    startTouchedRef.current = true;
    setPrefillNote("");
  }

  // ---------- Save ----------

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");

    if (!bookId) return setError("Choose the book you read.");
    if (parsedStart === "invalid" || parsedEnd === "invalid") return setError("Pages must be whole numbers, like 143.");
    if (typeof parsedStart === "number" && typeof parsedEnd === "number" && parsedEnd < parsedStart) {
      return setError("The page you stopped on is before the page you started on.");
    }
    if (parsedHours === "invalid" || parsedMinutes === "invalid") return setError("Enter the time as whole hours and minutes.");
    if (totalMinutes < 1) return setError("Add how long you read for.");
    if (totalMinutes > 1440) return setError("A session can't be longer than 24 hours.");
    if (!date) return setError("Choose the day you read.");
    if (date > today) return setError("That day hasn't happened yet. Choose today or earlier.");

    const payload: SessionInput = {
      book_id: bookId,
      session_date: date,
      start_chapter: startChapter.trim() || null,
      start_page: parsedStart,
      end_chapter: endChapter.trim() || null,
      end_page: parsedEnd,
      minutes_read: totalMinutes,
      thoughts: thoughts.trim() || null,
    };

    setSaving(true);

    try {
      const query = isEdit
        ? supabase.from("reading_sessions").update(payload).eq("id", initial!.id).eq("user_id", userId)
        : supabase.from("reading_sessions").insert({ ...payload, user_id: userId });

      const { data, error: saveError } = await query.select(SESSION_COLUMNS).single();

      if (saveError || !data) {
        console.error("Session save failed:", saveError?.message);
        setError(
          saveError?.code === "23514"
            ? "Something is outside the allowed range. Check the pages, time and date."
            : "Your session couldn't be saved. Try again."
        );
        return;
      }

      // Move the book along the shelf: finished, or from "want to read" to "reading"
      let bookChange: BookStatusChange | null = null;
      const nextStatus = finished ? "finished" : willStartReading ? "reading" : null;

      if (nextStatus && selectedBook && nextStatus !== selectedBook.status) {
        const { error: statusError } = await supabase
          .from("books")
          .update({ status: nextStatus })
          .eq("id", bookId)
          .eq("user_id", userId);

        if (statusError) console.error("Book status update failed:", statusError.message);
        else bookChange = { id: bookId, status: nextStatus };
      }

      onSaved(data as unknown as ReadingSession, bookChange);
    } catch (err) {
      console.error("Unexpected session save error:", err);
      setError("Your session couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---------- Render ----------

  return (
    <Modal open={open} onClose={onClose} labelledBy="log-title" size="lg" dismissible={!saving}>
      {/* On phones the sheet is capped to the visible screen (dvh accounts for the
          browser bars); the body scrolls and the footer stays in reach */}
      <form onSubmit={handleSubmit} noValidate className="flex flex-col flex-1 min-h-0 max-h-[92dvh] sm:max-h-[90vh]">
        {/* Header */}
        <div className="shrink-0 px-5 sm:px-8 pt-3 sm:pt-8 pb-4 sm:pb-5 border-b border-[#0f172a]/[0.06]">
          {/* Grab handle on the phone bottom sheet */}
          <div aria-hidden="true" className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-[#0f172a]/15" />
          <ModalHeader
            id="log-title"
            title={isEdit ? "Edit session" : "Log reading"}
            description={isEdit ? "Fix anything that's not quite right." : "Every day you read keeps your streak going."}
            onClose={onClose}
            disabled={saving}
          />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-6 sm:py-7 space-y-8 sm:space-y-9">
          {/* Book */}
          <fieldset className="min-w-0">
            <legend className={`${legendClass} mb-3`}>What did you read?</legend>

            {books.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#0f172a]/15 bg-white/60 p-5 sm:p-6 text-center">
                <p className="text-sm text-slate-600 font-light">Add a book to your library first, then log your reading here.</p>
                <Link
                  href="/library"
                  className={`mt-3 inline-flex items-center min-h-11 text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 rounded ${focusRing}`}
                >
                  Go to My Library
                </Link>
              </div>
            ) : (
              <>
                {books.length > 6 && !isEdit && (
                  <div className="mb-3">
                    <label htmlFor="book-search" className="sr-only">Search your books</label>
                    <input
                      id="book-search"
                      type="search"
                      enterKeyHint="search"
                      value={bookQuery}
                      onChange={(e) => setBookQuery(e.target.value)}
                      placeholder="Search by title or author"
                      className="w-full h-12 sm:h-11 px-5 bg-white border border-slate-200 rounded-full text-base sm:text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7a947c]/30 focus:border-[#7a947c] transition-all"
                    />
                  </div>
                )}

                {/* Shorter list on short screens (landscape phones) so the rest of the form stays reachable */}
                <div
                  role="radiogroup"
                  aria-label="Book"
                  className="max-h-[min(16rem,38dvh)] overflow-y-auto overscroll-contain -mx-1 px-1 py-1 space-y-2"
                >
                  {visibleBooks.length === 0 && <p className="text-sm text-slate-500 font-light px-1">No books match that search.</p>}

                  {visibleBooks.map((book) => {
                    const checked = book.id === bookId;
                    return (
                      <button
                        key={book.id}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => changeBook(book.id)}
                        disabled={isEdit && !checked}
                        className={`w-full min-w-0 flex items-center gap-3 p-2.5 pr-3 sm:pr-4 rounded-2xl border text-left transition-all disabled:opacity-35 ${focusRing} ${
                          checked ? "border-[#7a947c] bg-[#eef3ee]" : "border-[#0f172a]/10 bg-white hover:border-[#7a947c]/50"
                        }`}
                      >
                        <BookThumb title={book.title} coverUrl={book.cover_url} className="w-9 h-[54px]" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-classical font-semibold text-[15px] sm:text-base text-[#0f172a] truncate">{book.title}</span>
                          <span className="block text-xs text-slate-400 truncate">
                            {book.author ? `${book.author}, ` : ""}
                            {STATUS_LABEL[book.status ?? "want_to_read"]}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                            checked ? "border-[#7a947c] bg-[#7a947c]" : "border-[#0f172a]/20 bg-white"
                          }`}
                        >
                          {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </fieldset>

          {/* Position */}
          <fieldset className="min-w-0">
            <legend className={legendClass}>Where did you start and stop?</legend>
            <p className="text-sm text-slate-500 font-light mt-1 mb-4" aria-live="polite">
              {prefillNote || "A chapter can be a number or a name, like Prologue."}
            </p>

            {/* Stacked on phones, side by side from tablet up */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {(
                [
                  {
                    title: "Started at",
                    chapterId: "start-chapter",
                    pageId: "start-page",
                    chapter: startChapter,
                    page: startPage,
                    onChapter: (v: string) => { touchStart(); setStartChapter(v); },
                    onPage: (v: string) => { touchStart(); setStartPage(v); },
                    placeholders: ["4", "120"],
                  },
                  {
                    title: "Stopped at",
                    chapterId: "end-chapter",
                    pageId: "end-page",
                    chapter: endChapter,
                    page: endPage,
                    onChapter: setEndChapter,
                    onPage: setEndPage,
                    placeholders: ["6", "168"],
                  },
                ] as const
              ).map((group) => (
                <div key={group.title} className="min-w-0 soft-surface rounded-2xl border soft-border p-4">
                  <p className="text-sm font-medium text-slate-700 mb-3">{group.title}</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,7rem)] gap-3">
                    <div className="min-w-0">
                      <label htmlFor={group.chapterId} className={labelClass}>Chapter</label>
                      <input
                        id={group.chapterId}
                        type="text"
                        maxLength={100}
                        enterKeyHint="next"
                        autoComplete="off"
                        value={group.chapter}
                        onChange={(e) => group.onChapter(e.target.value)}
                        placeholder={group.placeholders[0]}
                        className={fieldClass}
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={group.pageId} className={labelClass}>Page</label>
                      <input
                        id={group.pageId}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        enterKeyHint="next"
                        autoComplete="off"
                        value={group.page}
                        onChange={(e) => group.onPage(e.target.value.replace(/[^\d]/g, ""))}
                        placeholder={group.placeholders[1]}
                        className={fieldClass}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {pagePreview != null && pagePreview > 0 && (
              <p className="mt-3 inline-flex items-center px-2.5 py-1 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                {pagePreview} {pagePreview === 1 ? "page" : "pages"}
              </p>
            )}
          </fieldset>

          {/* Time */}
          <fieldset className="min-w-0">
            <legend className={`${legendClass} mb-3`}>How long did you read?</legend>

            {/* Even grid of tap targets on phones, one pill row on larger screens */}
            <div
              role="group"
              aria-label="Quick times"
              className="grid grid-cols-3 sm:inline-flex sm:flex-wrap gap-1 p-1 rounded-2xl sm:rounded-full bg-[#0f172a]/5 mb-4 w-full sm:w-auto"
            >
              {QUICK_MINUTES.map((value) => {
                const active = totalMinutes === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setQuickDuration(value)}
                    aria-pressed={active}
                    className={`h-10 sm:h-8 px-3.5 rounded-xl sm:rounded-full text-sm sm:text-xs font-medium whitespace-nowrap transition-all ${focusRing} ${
                      active ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
                    }`}
                  >
                    {formatMinutes(value)}
                  </button>
                );
              })}
            </div>

            {/* Hours + minutes share a row; the date gets its own row on phones */}
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.4fr] gap-3">
              <div className="min-w-0">
                <label htmlFor="hours" className={labelClass}>Hours</label>
                <input
                  id="hours"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={2}
                  value={hours}
                  onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  className={fieldClass}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="minutes" className={labelClass}>Minutes</label>
                <input
                  id="minutes"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={3}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="30"
                  className={fieldClass}
                />
              </div>
              <div className="min-w-0 col-span-2 sm:col-span-1">
                <label htmlFor="session-date" className={labelClass}>Day</label>
                <input
                  id="session-date"
                  type="date"
                  value={date}
                  max={today}
                  onChange={(e) => setDate(e.target.value)}
                  className={`${fieldClass} appearance-none [&::-webkit-date-and-time-value]:text-left`}
                />
              </div>
            </div>
          </fieldset>

          {/* Thoughts */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <label htmlFor="thoughts" className={legendClass}>Thoughts so far</label>
              <span className="text-xs text-slate-400 shrink-0">Optional</span>
            </div>
            <textarea
              id="thoughts"
              rows={5}
              maxLength={MAX_THOUGHTS}
              value={thoughts}
              onChange={(e) => setThoughts(e.target.value)}
              placeholder="How's it going? A character you love, a twist you saw coming, a line worth keeping…"
              className="journal-paper w-full px-4 border border-[#0f172a]/10 rounded-xl resize-y min-h-[140px] sm:min-h-[160px] text-base sm:text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
            />
            {thoughts.length > MAX_THOUGHTS * 0.8 && (
              <p className="mt-1 text-right text-[11px] text-slate-400">{MAX_THOUGHTS - thoughts.length} characters left</p>
            )}
          </div>

          {/* Status */}
          {selectedBook && selectedBook.status !== "finished" && (
            <div className="space-y-3">
              <label
                className={`flex items-center gap-3 p-4 min-h-14 rounded-2xl border cursor-pointer transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#7a947c] ${
                  finished ? "border-[#7a947c] bg-[#eef3ee]" : "border-[#0f172a]/10 bg-white"
                }`}
              >
                <input type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} className="w-5 h-5 sm:w-4 sm:h-4 shrink-0 accent-[#7a947c]" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[#0f172a]">I finished this book</span>
                  <span className="block text-xs text-slate-400">It moves to your Finished shelf.</span>
                </span>
              </label>

              {willStartReading && (
                <p className="text-xs text-slate-500 font-light break-words">
                  Logging this moves <span className="font-medium text-slate-700">{selectedBook.title}</span> to Currently reading.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer: always visible; clears the home indicator on iPhones */}
        <div className="shrink-0 px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] bg-[#fdfaf3] sm:rounded-b-[1.6rem]">
          {error && (
            <p ref={errorRef} role="alert" className="mb-3 text-sm text-[#a14e43]">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 sm:gap-3">
            <Button variant="outline" onClick={onClose} disabled={saving} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={saving} disabled={books.length === 0} className="w-full sm:w-auto">
              {saving ? "Saving…" : isEdit ? "Save changes" : totalMinutes > 0 ? `Log ${formatMinutes(totalMinutes)}` : "Log session"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}