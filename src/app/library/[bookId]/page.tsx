"use client";

// src/app/library/[bookId]/page.tsx

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "../../components/Navbar";
import { supabase } from "../../../lib/supabase";

// ============================================================
// Types
// ============================================================

interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  custom_cover_path: string | null;
  status: string | null;
}

interface Review {
  id: string;
  rating: number | null;
  review_text: string | null;
  finished_year: number | null;
  finished_month: number | null;
  created_at: string;
  updated_at: string;
}

interface JournalEntry {
  id: string;
  entry_date: string;
  content: string;
  chapter: string | null;
  page_number: number | null;
  created_at: string;
  updated_at: string;
}

type Tab = "journal" | "review";
type SortMode = "recent" | "page";
type BookStatus = "want_to_read" | "reading" | "finished" | "did_not_finish";

type Toast = {
  type: "success" | "error";
  message: string;
} | null;

// ============================================================
// Cover storage config (keep in sync with the library page)
// ============================================================

const COVER_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB
const SIGNED_URL_TTL = 60 * 60; // 1 hour

const ALLOWED_COVER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Check real file type from magic bytes instead of trusting file.type
async function sniffImageType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  const ascii = String.fromCharCode(...bytes);
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

// ============================================================
// Status
// ============================================================

const STATUS_OPTIONS: { value: BookStatus; label: string; active: string; dot: string }[] = [
  { value: "want_to_read", label: "Want to read", active: "bg-[#d8d0e3] text-[#0f172a]", dot: "bg-[#9a86b9]" },
  { value: "reading", label: "Reading", active: "bg-[#7a947c] text-white", dot: "bg-[#7a947c]" },
  { value: "finished", label: "Finished", active: "bg-[#0f172a] text-[#fdfaf3]", dot: "bg-[#0f172a]" },
  { value: "did_not_finish", label: "Did not finish", active: "bg-[#e9d6cf] text-[#7a3f33]", dot: "bg-[#b07a6a]" },
];

const STATUS_TOAST: Record<BookStatus, string> = {
  want_to_read: "Moved to Want to read.",
  reading: "Marked as currently reading. Enjoy!",
  finished: "Marked as finished. Nice one.",
  did_not_finish: "Marked as did not finish. Not every book is for everyone.",
};

// ============================================================
// Shared helpers
// ============================================================

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const EARLIEST_YEAR = 1920;

const DATE_FORMATS: Record<"long" | "short", Intl.DateTimeFormatOptions> = {
  long: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  short: { month: "short", day: "numeric", year: "numeric" },
};

function formatEntryDate(date: string, style: "long" | "short" = "long") {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", DATE_FORMATS[style]);
}

// "March 2024" or "2019"
function formatFinished(year: number | null | undefined, month: number | null | undefined) {
  if (!year) return "";
  return month ? `${MONTHS[month - 1]} ${year}` : String(year);
}

// Local date (not UTC) so late-evening entries don't land on tomorrow/yesterday
function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

function sortByRecent(entries: JournalEntry[]) {
  return [...entries].sort((a, b) => {
    const dateDiff =
      new Date(`${b.entry_date}T00:00:00`).getTime() - new Date(`${a.entry_date}T00:00:00`).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

const chapterCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// Page ascending; entries without a page go last, ordered by chapter then date
function sortByPage(entries: JournalEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.page_number != null && b.page_number != null && a.page_number !== b.page_number) {
      return a.page_number - b.page_number;
    }
    if (a.page_number != null && b.page_number == null) return -1;
    if (a.page_number == null && b.page_number != null) return 1;

    if (a.chapter && b.chapter) {
      const byChapter = chapterCollator.compare(a.chapter, b.chapter);
      if (byChapter !== 0) return byChapter;
    }
    if (a.chapter && !b.chapter) return -1;
    if (!a.chapter && b.chapter) return 1;

    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

// "12" -> "Chapter 12"; "Prologue" stays "Prologue"
function chapterLabel(chapter: string) {
  return /^\d+$/.test(chapter.trim()) ? `Chapter ${chapter.trim()}` : chapter.trim();
}

// "Chapter 12, page 143"
function locationLabel(chapter: string | null, page: number | null) {
  const hasChapter = !!chapter?.trim();
  if (hasChapter && page != null) return `${chapterLabel(chapter!)}, page ${page}`;
  if (hasChapter) return chapterLabel(chapter!);
  if (page != null) return `Page ${page}`;
  return "";
}

// Returns a number, null (empty), or "invalid"
function parsePage(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const n = Number(trimmed);
  return n < 1 || n > 100000 ? "invalid" : n;
}

const digitsOnly = (value: string) => value.replace(/[^\d]/g, "");

const RATING_LABEL: Record<number, string> = {
  1: "It wasn't for me",
  2: "It was okay",
  3: "I liked it",
  4: "I really liked it",
  5: "A new favourite",
};

// Ratings go up in quarter stars: 0.25, 0.5, 0.75 … 5
const RATING_STEP = 0.25;
const RATING_MAX = 5;

function clampRating(value: number) {
  const snapped = Math.round(value / RATING_STEP) * RATING_STEP;
  return Math.min(RATING_MAX, Math.max(0, snapped));
}

// 4 -> "4", 4.5 -> "4.5", 4.25 -> "4.25"
function formatRating(value: number) {
  return String(Number(value.toFixed(2)));
}

// 3.75 reads as "I liked it"; anything under 1 as "It wasn't for me"
function ratingLabel(value: number) {
  return RATING_LABEL[Math.min(5, Math.max(1, Math.floor(value)))];
}

// "¾" style hint for the part after the whole number
function fractionHint(value: number) {
  const part = Math.round((value % 1) * 4);
  return ["", "and a quarter", "and a half", "and three quarters"][part];
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfaf3]";

// 16px text on phones stops iOS zooming in when a field is focused
const fieldClass =
  "w-full min-w-0 h-12 sm:h-11 px-3.5 bg-white border border-[#0f172a]/10 rounded-xl text-base sm:text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all";

const selectClass = `${fieldClass} appearance-none pr-10 bg-[url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>")] bg-no-repeat bg-[right_0.9rem_center] disabled:bg-slate-50 disabled:text-slate-300`;

const labelClass = "block text-xs font-medium text-slate-500 mb-1.5";

// Pill buttons used across the site
const btnPrimary = `inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] shadow-[0_8px_20px_rgba(122,148,124,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`;
const btnDark = `inline-flex items-center justify-center gap-2 h-12 px-7 rounded-full bg-[#0f172a] text-[#fdfaf3] text-sm font-medium hover:bg-[#1e293b] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`;
const btnOutline = `inline-flex items-center justify-center gap-2 h-12 px-6 rounded-full bg-white/70 text-slate-700 border border-[#0f172a]/10 text-sm font-medium hover:bg-white hover:text-[#0f172a] hover:border-[#0f172a]/25 transition-all disabled:opacity-40 ${focusRing}`;
const btnGhost = `inline-flex items-center justify-center h-10 px-4 rounded-full text-sm text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`;

// ============================================================
// Small components
// ============================================================

// Tries each source in order, then shows the placeholder
function CoverImage({ sources, title, author }: { sources: string[]; title: string; author: string | null }) {
  const [index, setIndex] = useState(0);
  const key = sources.join("|");

  useEffect(() => {
    setIndex(0);
  }, [key]);

  const src = sources[index];

  if (src) {
    return (
      <img
        src={src}
        alt={`Cover of ${title}`}
        onError={() => setIndex((i) => i + 1)}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
      />
    );
  }

  return (
    <div className="w-full h-full bg-[#0f172a] text-[#fdfaf3] p-5 sm:p-7 flex flex-col justify-between">
      <span className="text-[10px] tracking-[0.2em] opacity-50">The Archive</span>
      <div>
        <p className="font-classical text-xl sm:text-2xl leading-tight line-clamp-5">{title}</p>
        {author && <p className="text-sm opacity-60 mt-3 line-clamp-2">{author}</p>}
      </div>
      <span className="font-classical text-3xl opacity-30">A</span>
    </div>
  );
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-4 h-4 border-2 rounded-full animate-spin ${
        dark ? "border-[#0f172a]/20 border-t-[#0f172a]" : "border-white/30 border-t-white"
      }`}
    />
  );
}

// Tap-to-add starters for the review box
const REVIEW_PROMPTS = [
  "What stayed with me:",
  "Favourite character:",
  "A line I loved:",
  "What didn't work for me:",
  "I'd recommend it to:",
];

// One numbered step of the review form
function ReviewStep({
  step,
  id,
  title,
  hint,
  done,
  optional = false,
  children,
}: {
  step: number;
  id: string;
  title: string;
  hint?: ReactNode;
  done: boolean;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="px-5 sm:px-8 py-6 sm:py-7 border-b border-[#0f172a]/[0.06]">
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className={`mt-0.5 w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
            done ? "bg-[#7a947c] text-white" : "bg-[#0f172a]/[0.06] text-slate-500"
          }`}
        >
          {done ? "✓" : step}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id={id} className="font-classical text-xl sm:text-[1.35rem] font-semibold text-[#0f172a] leading-snug">
              {title}
            </h3>
            {optional && <span className="text-xs text-slate-400 shrink-0">Optional</span>}
          </div>
          {hint && <p className="mt-1 text-sm text-slate-500 font-light leading-6">{hint}</p>}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

// One star, filled from 0 (empty) to 1 (full), clipped left to right
function StarIcon({ fill, className = "w-4 h-4" }: { fill: number; className?: string }) {
  const clipId = useId();
  const width = 24 * Math.max(0, Math.min(1, fill));
  const path = "M12 1.6l3.1 6.6 7.2.9-5.3 5 1.4 7.2L12 17.8l-6.4 3.5 1.4-7.2-5.3-5 7.2-.9z";

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={width} height="24" />
        </clipPath>
      </defs>
      <path d={path} fill="#e2e8f0" />
      <path d={path} fill="#c5a24a" clipPath={`url(#${clipId})`} />
    </svg>
  );
}

// Read-only stars that show quarter ratings
function Stars({ value, size = "w-4 h-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex gap-0.5 align-middle" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon key={star} fill={value - (star - 1)} className={size} />
      ))}
    </span>
  );
}

// ============================================================
// Page
// ============================================================

export default function BookReviewPage() {
  const router = useRouter();
  const params = useParams();
  const bookId = params.bookId as string;

  // Data
  const [userId, setUserId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Status
  const [savingStatus, setSavingStatus] = useState<BookStatus | null>(null);
  const statusButtonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Custom cover
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverFileType, setCoverFileType] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState("");
  const [savingCover, setSavingCover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [readingClipboard, setReadingClipboard] = useState(false);
  const coverUploadRef = useRef<HTMLInputElement | null>(null);
  const coverCameraRef = useRef<HTMLInputElement | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>("journal");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ journal: null, review: null });

  // Review
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [finishedYear, setFinishedYear] = useState("");
  const [finishedMonth, setFinishedMonth] = useState("");
  const [initialRating, setInitialRating] = useState(0);
  const [initialReviewText, setInitialReviewText] = useState("");
  const [initialFinishedYear, setInitialFinishedYear] = useState("");
  const [initialFinishedMonth, setInitialFinishedMonth] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [hoveredRating, setHoveredRating] = useState(0);
  const reviewTextRef = useRef<HTMLTextAreaElement | null>(null);
  const ratingBarRef = useRef<HTMLDivElement | null>(null);
  const ratingDragRef = useRef<{ start: number; moved: boolean } | null>(null);

  // Journal composer
  const [journalDate, setJournalDate] = useState(todayLocal());
  const [journalChapter, setJournalChapter] = useState("");
  const [journalPage, setJournalPage] = useState("");
  const [journalText, setJournalText] = useState("");
  const [savingJournal, setSavingJournal] = useState(false);
  const [journalError, setJournalError] = useState("");
  const journalTextRef = useRef<HTMLTextAreaElement | null>(null);

  // Journal list
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editChapter, setEditChapter] = useState("");
  const [editPage, setEditPage] = useState("");
  const [editDate, setEditDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // UI
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // Device hints: decided after mount so server and client HTML match
  const [saveShortcut, setSaveShortcut] = useState("Ctrl Enter");
  const [pasteShortcut, setPasteShortcut] = useState("Ctrl V");
  const [canReadClipboard, setCanReadClipboard] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) {
      setSaveShortcut("⌘ Enter");
      setPasteShortcut("⌘ V");
    }
    setCanReadClipboard(typeof navigator.clipboard?.read === "function");
    setIsTouchDevice(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // ============================================================
  // Signed URL for the private custom cover
  // ============================================================

  async function signCustomCover(path: string | null) {
    if (!path) {
      setCustomCoverUrl(null);
      return;
    }

    const { data, error: signError } = await supabase.storage.from(COVER_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);

    if (signError || !data?.signedUrl) {
      console.error("Error signing custom cover:", signError?.message);
      setCustomCoverUrl(null);
      return;
    }

    setCustomCoverUrl(data.signedUrl);
  }

  // ============================================================
  // Load
  // ============================================================

  function applySavedReview(saved: Review | null) {
    const year = saved?.finished_year ? String(saved.finished_year) : "";
    const month = saved?.finished_month ? String(saved.finished_month) : "";

    setReview(saved);
    const savedRating = saved?.rating != null ? Number(saved.rating) : 0;
    setRating(savedRating);
    setReviewText(saved?.review_text || "");
    setFinishedYear(year);
    setFinishedMonth(month);
    setInitialRating(savedRating);
    setInitialReviewText(saved?.review_text || "");
    setInitialFinishedYear(year);
    setInitialFinishedMonth(month);
  }

  useEffect(() => {
    if (!bookId) return;
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  async function loadPage() {
    setLoading(true);
    setLoadError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.user) {
        router.push("/login");
        return;
      }

      const currentUserId = session.user.id;
      setUserId(currentUserId);

      const [bookResult, reviewResult, journalResult] = await Promise.all([
        supabase
          .from("books")
          .select("id, user_id, title, author, cover_url, custom_cover_path, status")
          .eq("id", bookId)
          .eq("user_id", currentUserId)
          .single(),
        supabase
          .from("book_reviews")
          .select("id, rating, review_text, finished_year, finished_month, created_at, updated_at")
          .eq("book_id", bookId)
          .eq("user_id", currentUserId)
          .maybeSingle(),
        supabase
          .from("book_journal_entries")
          .select("id, entry_date, content, chapter, page_number, created_at, updated_at")
          .eq("book_id", bookId)
          .eq("user_id", currentUserId)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (bookResult.error || !bookResult.data) {
        console.error("Error loading book:", bookResult.error?.message);
        setLoadError("We couldn't find this book in your library.");
        return;
      }

      const loadedBook = bookResult.data as Book;
      setBook(loadedBook);
      signCustomCover(loadedBook.custom_cover_path); // don't hold the page for the cover

      if (reviewResult.error) console.error("Error loading review:", reviewResult.error.message);
      applySavedReview((reviewResult.data as Review | null) ?? null);

      if (journalResult.error) console.error("Error loading journal:", journalResult.error.message);

      const entries = (journalResult.data || []) as JournalEntry[];
      setJournalEntries(entries);

      // Pick up where you left off: prefill chapter + page from your latest note
      const latest = [...entries].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      if (latest) {
        setJournalChapter(latest.chapter || "");
        setJournalPage(latest.page_number != null ? String(latest.page_number) : "");
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      setLoadError("Something went wrong while loading this page.");
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // Derived
  // ============================================================

  // Your own photo first, catalogue cover as the fallback
  const coverSources = useMemo(() => {
    const sources: string[] = [];
    if (customCoverUrl) sources.push(customCoverUrl);
    if (book?.cover_url) sources.push(book.cover_url);
    return sources;
  }, [book?.cover_url, customCoverUrl]);

  const reviewHasChanges =
    rating !== initialRating ||
    reviewText !== initialReviewText ||
    finishedYear !== initialFinishedYear ||
    finishedMonth !== initialFinishedMonth;
  const journalHasDraft = journalText.trim().length > 0;
  const hasUnsaved = reviewHasChanges || journalHasDraft || editingId !== null;

  const sortedEntries = useMemo(
    () => (sortMode === "page" ? sortByPage(journalEntries) : sortByRecent(journalEntries)),
    [journalEntries, sortMode]
  );

  const furthestPage = useMemo(() => {
    const pages = journalEntries.map((e) => e.page_number).filter((p): p is number => p != null);
    return pages.length ? Math.max(...pages) : null;
  }, [journalEntries]);

  const displayRating = hoveredRating || rating;

  const composerPage = parsePage(journalPage);
  const composerLocation = locationLabel(journalChapter.trim() || null, composerPage === "invalid" ? null : composerPage);

  // Finished-date picker
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const yearOptions = useMemo(
    () => Array.from({ length: currentYear - EARLIEST_YEAR + 1 }, (_, i) => currentYear - i),
    [currentYear]
  );

  // What "left empty" turns into: the month and year the review was written
  const defaultFinished = useMemo(() => {
    const written = review ? new Date(review.created_at) : new Date();
    return formatFinished(written.getFullYear(), written.getMonth() + 1);
  }, [review]);

  const savedFinishedLabel = formatFinished(review?.finished_year, review?.finished_month);

  // ============================================================
  // Browser close / refresh warning
  // ============================================================

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsaved) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsaved]);

  // ============================================================
  // Toast
  // ============================================================

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
  }, []);

  // ============================================================
  // Status (optimistic, rolls back on failure)
  // ============================================================

  async function updateStatus(next: BookStatus) {
    if (!book || !userId || savingStatus || book.status === next) return;

    const previous = book.status;
    setBook({ ...book, status: next });
    setSavingStatus(next);

    const { error: statusError } = await supabase.from("books").update({ status: next }).eq("id", book.id).eq("user_id", userId);

    setSavingStatus(null);

    if (statusError) {
      console.error(
        "Status update failed:",
        statusError.code === "23514" ? "The books_status_check constraint rejected this value. Run book-status.sql." : statusError.message
      );
      setBook((current) => (current ? { ...current, status: previous } : current));
      showToast("error", "The status couldn't be changed. Try again.");
      return;
    }

    showToast("success", STATUS_TOAST[next]);
  }

  function onStatusKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const last = STATUS_OPTIONS.length - 1;
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = index === last ? 0 : index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = index === 0 ? last : index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = last;

    statusButtonsRef.current[nextIndex]?.focus();
    updateStatus(STATUS_OPTIONS[nextIndex].value);
  }

  // ============================================================
  // Cover modal
  // ============================================================

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  useEffect(() => {
    if (!showCoverModal) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingCover) closeCoverModal();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCoverModal, savingCover]);

  function resetCoverSelection() {
    setCoverFile(null);
    setCoverFileType(null);
    setCoverPreview(null);
    setCoverError("");
    setDragOver(false);
    if (coverUploadRef.current) coverUploadRef.current.value = "";
    if (coverCameraRef.current) coverCameraRef.current.value = "";
  }

  function openCoverModal() {
    resetCoverSelection();
    setShowCoverModal(true);
  }

  function closeCoverModal() {
    if (savingCover) return;
    resetCoverSelection();
    setShowCoverModal(false);
  }

  async function handleCoverFile(file: File | null | undefined) {
    setCoverError("");
    if (!file) return;

    if (file.size > MAX_COVER_BYTES) {
      setCoverError("That image is over 5 MB. Choose a smaller file.");
      return;
    }

    const realType = await sniffImageType(file);

    if (!realType || !ALLOWED_COVER_TYPES[realType]) {
      setCoverError("Use a JPG, PNG or WebP image.");
      return;
    }

    setCoverFile(file);
    setCoverFileType(realType);
    setCoverPreview(URL.createObjectURL(file));
  }

  function fileFromBlob(blob: Blob) {
    const ext = ALLOWED_COVER_TYPES[blob.type] || "png";
    return new File([blob], `pasted-cover.${ext}`, { type: blob.type || "image/png" });
  }

  function imageFromPaste(event: ClipboardEvent): File | null {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();
    return file ? (file.name ? file : fileFromBlob(file)) : null;
  }

  function isTypingTarget(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
  }

  // Paste an image anywhere (when not typing) to use it as the cover
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (savingCover) return;

      const file = imageFromPaste(event);

      if (!file) {
        if (showCoverModal) {
          const text = event.clipboardData?.getData("text") ?? "";
          if (/^https?:\/\//i.test(text.trim())) {
            event.preventDefault();
            setCoverError("That's a link, not an image. Right-click the picture and choose Copy image, then paste again.");
          }
        }
        return;
      }

      if (!showCoverModal && isTypingTarget(event.target)) return;

      event.preventDefault();

      if (!showCoverModal) {
        resetCoverSelection();
        setShowCoverModal(true);
      }

      handleCoverFile(file);
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCoverModal, savingCover]);

  async function pasteFromClipboard() {
    if (!navigator.clipboard?.read) return;

    setCoverError("");
    setReadingClipboard(true);

    try {
      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          await handleCoverFile(fileFromBlob(blob));
          return;
        }
      }

      setCoverError("There's no image on your clipboard. Copy a picture first, then try again.");
    } catch (err) {
      const name = (err as Error)?.name;
      setCoverError(
        name === "NotAllowedError"
          ? `Clipboard access was blocked. Press ${pasteShortcut} to paste instead.`
          : "The image couldn't be pasted. Try choosing a file instead."
      );
    } finally {
      setReadingClipboard(false);
    }
  }

  async function saveCustomCover() {
    if (!book || !userId || !coverFile || !coverFileType) return;

    setSavingCover(true);
    setCoverError("");

    const previousPath = book.custom_cover_path;
    const newPath = `${userId}/${crypto.randomUUID()}.${ALLOWED_COVER_TYPES[coverFileType]}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(COVER_BUCKET)
        .upload(newPath, coverFile, { contentType: coverFileType, cacheControl: "31536000", upsert: false });

      if (uploadError) {
        console.error("Cover upload failed:", uploadError.message);
        setCoverError("The cover didn't upload. Try again.");
        return;
      }

      const { data, error: updateError } = await supabase
        .from("books")
        .update({ custom_cover_path: newPath })
        .eq("id", book.id)
        .eq("user_id", userId)
        .select("id, user_id, title, author, cover_url, custom_cover_path, status")
        .single();

      if (updateError || !data) {
        console.error("Cover update failed:", updateError?.message);
        await supabase.storage.from(COVER_BUCKET).remove([newPath]);
        setCoverError("The cover couldn't be saved to this book. Try again.");
        return;
      }

      if (previousPath && previousPath !== newPath) {
        const { error: removeError } = await supabase.storage.from(COVER_BUCKET).remove([previousPath]);
        if (removeError) console.error("Old cover cleanup failed:", removeError.message);
      }

      setBook(data as Book);
      await signCustomCover(newPath);

      resetCoverSelection();
      setShowCoverModal(false);
      showToast("success", "Cover photo saved.");
    } catch (err) {
      console.error("Unexpected cover save error:", err);
      await supabase.storage.from(COVER_BUCKET).remove([newPath]);
      setCoverError("The cover couldn't be saved. Try again.");
    } finally {
      setSavingCover(false);
    }
  }

  async function removeCustomCover() {
    if (!book || !userId || !book.custom_cover_path) return;
    if (!window.confirm("Remove your cover photo from this book?")) return;

    setSavingCover(true);
    setCoverError("");

    const pathToRemove = book.custom_cover_path;

    try {
      const { data, error: updateError } = await supabase
        .from("books")
        .update({ custom_cover_path: null })
        .eq("id", book.id)
        .eq("user_id", userId)
        .select("id, user_id, title, author, cover_url, custom_cover_path, status")
        .single();

      if (updateError || !data) {
        console.error("Cover removal failed:", updateError?.message);
        setCoverError("The cover photo couldn't be removed. Try again.");
        return;
      }

      const { error: removeError } = await supabase.storage.from(COVER_BUCKET).remove([pathToRemove]);
      if (removeError) console.error("Cover file cleanup failed:", removeError.message);

      setBook(data as Book);
      setCustomCoverUrl(null);

      resetCoverSelection();
      setShowCoverModal(false);
      showToast("success", "Cover photo removed.");
    } finally {
      setSavingCover(false);
    }
  }

  // ============================================================
  // Navigation
  // ============================================================

  const attemptToLeave = useCallback(
    (destination: string) => {
      if (hasUnsaved) {
        setPendingDestination(destination);
        setShowLeaveModal(true);
        return;
      }
      router.push(destination);
    },
    [hasUnsaved, router]
  );

  function discardAndLeave() {
    const destination = pendingDestination || "/library";
    setShowLeaveModal(false);
    setPendingDestination(null);
    router.push(destination);
  }

  function goToComposer() {
    setActiveTab("journal");
    requestAnimationFrame(() => {
      document.getElementById("journal-composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
      journalTextRef.current?.focus({ preventScroll: true });
    });
  }

  function goToReview() {
    setActiveTab("review");
    requestAnimationFrame(() => {
      document.getElementById("panel-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Left/right arrows switch tabs, like native tabs
  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = activeTab === "journal" ? "review" : "journal";
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  }

  function onSaveShortcut(event: ReactKeyboardEvent, save: () => void) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  }

  // ============================================================
  // Review
  // ============================================================

  async function saveReview() {
    if (!userId || !book || savingReview) return;
    setReviewError("");

    if (rating === 0) {
      setReviewError("Choose a star rating before saving.");
      return;
    }

    const year = finishedYear ? Number(finishedYear) : null;
    const month = year && finishedMonth ? Number(finishedMonth) : null;

    if (year && month && (year > currentYear || (year === currentYear && month > currentMonth))) {
      setReviewError("That date is in the future. Choose this month or earlier.");
      return;
    }

    if (!reviewHasChanges) return;

    setSavingReview(true);

    try {
      const cleanReview = reviewText.trim();

      // Year left empty: the database fills in the month and year of the review
      const { data, error: saveError } = await supabase
        .from("book_reviews")
        .upsert(
          {
            user_id: userId,
            book_id: book.id,
            rating,
            review_text: cleanReview || null,
            finished_year: year,
            finished_month: month,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,book_id" }
        )
        .select("id, rating, review_text, finished_year, finished_month, created_at, updated_at")
        .single();

      if (saveError || !data) {
        console.error("Error saving review:", saveError?.message);
        setReviewError(
          saveError?.code === "23514"
            ? saveError.message.includes("rating")
              ? "Quarter-star ratings need a database update. Run book-reviews-quarter-stars.sql."
              : "That finishing date isn't allowed. Check the year and month."
            : saveError?.code === "22P02"
              ? "Quarter-star ratings need a database update. Run book-reviews-quarter-stars.sql."
              : "Your review couldn't be saved. Try again."
        );
        return;
      }

      const saved = data as Review;
      applySavedReview(saved);

      const when = formatFinished(saved.finished_year, saved.finished_month);
      showToast("success", `${review ? "Review updated" : "Review saved"}. Finished ${when}.`);
    } catch (err) {
      console.error("Unexpected review save error:", err);
      setReviewError("Something went wrong while saving your review.");
    } finally {
      setSavingReview(false);
    }
  }

  function discardReviewChanges() {
    setRating(initialRating);
    setReviewText(initialReviewText);
    setFinishedYear(initialFinishedYear);
    setFinishedMonth(initialFinishedMonth);
    setReviewError("");
  }

  // Where on the stars the pointer is, as a quarter-star value (0.25 to 5)
  function ratingFromPointer(clientX: number) {
    const rect = ratingBarRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return rating;
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const raw = (x / rect.width) * RATING_MAX;
    return Math.min(RATING_MAX, Math.max(RATING_STEP, Math.ceil(raw / RATING_STEP) * RATING_STEP));
  }

  // Tap or click to set; drag along the stars to fine-tune (touch and mouse)
  function onRatingPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    ratingDragRef.current = { start: rating, moved: false };
    setHoveredRating(ratingFromPointer(event.clientX));
  }

  function onRatingPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const value = ratingFromPointer(event.clientX);
    if (ratingDragRef.current) {
      ratingDragRef.current.moved = true;
      setHoveredRating(value);
    } else if (event.pointerType === "mouse") {
      setHoveredRating(value);
    }
  }

  function onRatingPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = ratingDragRef.current;
    ratingDragRef.current = null;
    if (!drag) return;

    const value = ratingFromPointer(event.clientX);
    // Tapping the exact current value again clears the rating
    setRating(!drag.moved && value === drag.start ? 0 : value);
    if (event.pointerType !== "mouse") setHoveredRating(0);
  }

  function onRatingPointerCancel() {
    ratingDragRef.current = null;
    setHoveredRating(0);
  }

  // Arrows move a quarter star; Page Up/Down a whole star
  function onRatingKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = {
      ArrowRight: RATING_STEP,
      ArrowUp: RATING_STEP,
      ArrowLeft: -RATING_STEP,
      ArrowDown: -RATING_STEP,
      PageUp: 1,
      PageDown: -1,
    };

    let next: number;
    if (event.key in steps) next = clampRating(rating + steps[event.key]);
    else if (event.key === "Home") next = RATING_STEP;
    else if (event.key === "End") next = RATING_MAX;
    else if (event.key === "Delete" || event.key === "Backspace") next = 0;
    else return;

    event.preventDefault();
    setRating(next);
  }

  function nudgeRating(delta: number) {
    setRating((current) => {
      const next = clampRating((current || (delta > 0 ? 0 : RATING_STEP)) + delta);
      return next === 0 && delta < 0 ? RATING_STEP : next;
    });
  }

  function chooseYear(year: string) {
    setFinishedYear(year);
    if (!year) setFinishedMonth("");
    else if (Number(year) === currentYear && Number(finishedMonth) > currentMonth) setFinishedMonth("");
  }

  // Adds a starter line to the review and puts the cursor after it
  function insertPrompt(prompt: string) {
    setReviewText((current) => {
      const trimmed = current.replace(/\s+$/, "");
      return `${trimmed ? `${trimmed}\n\n` : ""}${prompt} `;
    });

    requestAnimationFrame(() => {
      const el = reviewTextRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
  }

  // ============================================================
  // Journal
  // ============================================================

  async function saveJournalEntry(event?: FormEvent) {
    event?.preventDefault();
    if (!userId || !book || savingJournal) return;

    setJournalError("");

    if (!journalText.trim()) {
      setJournalError("Write something before saving your note.");
      return;
    }

    if (!journalDate) {
      setJournalError("Choose a date for this note.");
      return;
    }

    const page = parsePage(journalPage);
    if (page === "invalid") {
      setJournalError("Page must be a whole number, like 143.");
      return;
    }

    const chapter = journalChapter.trim() || null;

    setSavingJournal(true);

    try {
      const { data, error: journalInsertError } = await supabase
        .from("book_journal_entries")
        .insert({ user_id: userId, book_id: book.id, entry_date: journalDate, content: journalText.trim(), chapter, page_number: page })
        .select("id, entry_date, content, chapter, page_number, created_at, updated_at")
        .single();

      if (journalInsertError) {
        console.error("Error saving journal entry:", journalInsertError.message);
        setJournalError("Your note couldn't be saved. Try again.");
        return;
      }

      setJournalEntries((current) => [data as JournalEntry, ...current]);
      setJournalText("");
      journalTextRef.current?.focus();

      const where = locationLabel(chapter, page);
      showToast("success", where ? `Note saved at ${where.charAt(0).toLowerCase()}${where.slice(1)}.` : "Note saved.");
    } catch (err) {
      console.error("Unexpected journal save error:", err);
      setJournalError("Something went wrong while saving your note.");
    } finally {
      setSavingJournal(false);
    }
  }

  function startEdit(entry: JournalEntry) {
    setConfirmDeleteId(null);
    setEditingId(entry.id);
    setEditText(entry.content);
    setEditChapter(entry.chapter || "");
    setEditPage(entry.page_number != null ? String(entry.page_number) : "");
    setEditDate(entry.entry_date);
    setEditError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError("");
  }

  async function saveEdit() {
    if (!userId || !editingId || savingEdit) return;
    setEditError("");

    if (!editText.trim()) {
      setEditError("A note can't be empty. Delete it instead if you no longer need it.");
      return;
    }

    const page = parsePage(editPage);
    if (page === "invalid") {
      setEditError("Page must be a whole number, like 143.");
      return;
    }

    setSavingEdit(true);

    const { data, error: updateError } = await supabase
      .from("book_journal_entries")
      .update({
        content: editText.trim(),
        chapter: editChapter.trim() || null,
        page_number: page,
        entry_date: editDate || todayLocal(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingId)
      .eq("user_id", userId)
      .select("id, entry_date, content, chapter, page_number, created_at, updated_at")
      .single();

    setSavingEdit(false);

    if (updateError || !data) {
      console.error("Error updating journal entry:", updateError?.message);
      setEditError("Your changes couldn't be saved. Try again.");
      return;
    }

    setJournalEntries((current) => current.map((e) => (e.id === editingId ? (data as JournalEntry) : e)));
    setEditingId(null);
    showToast("success", "Note updated.");
  }

  async function deleteJournalEntry(id: string) {
    if (!userId) return;

    setConfirmDeleteId(null);
    const previous = journalEntries;
    setJournalEntries((current) => current.filter((entry) => entry.id !== id));

    const { error: deleteError } = await supabase.from("book_journal_entries").delete().eq("id", id).eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting journal entry:", deleteError.message);
      setJournalEntries(previous);
      showToast("error", "The note couldn't be deleted. Try again.");
      return;
    }

    showToast("success", "Note deleted.");
  }

  // ============================================================
  // Loading
  // ============================================================

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a]">
        <Navbar isLoggedIn={!!userId || undefined} />
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 sm:py-12" aria-busy="true" aria-label="Loading book">
          <div className="animate-pulse">
            <div className="h-4 w-28 bg-slate-900/10 rounded-full mb-10" />
            <div className="grid lg:grid-cols-[250px_1fr] gap-8 lg:gap-10">
              <div className="w-40 sm:w-48 lg:w-full mx-auto lg:mx-0 aspect-[2/3] rounded-[1.4rem] bg-slate-900/10" />
              <div className="pt-2 lg:pt-5">
                <div className="h-9 w-72 max-w-full bg-slate-900/10 rounded-full mb-6" />
                <div className="h-12 w-3/4 bg-slate-900/10 rounded-xl mb-5" />
                <div className="h-5 w-48 bg-slate-900/10 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ============================================================
  // Book not found
  // ============================================================

  if (!book) {
    return (
      <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a]">
        <Navbar isLoggedIn={!!userId || undefined} />
        <section className="max-w-4xl mx-auto px-5 sm:px-8 py-20 sm:py-24 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-7">
            <span className="font-classical text-3xl text-[#9a86b9]">A</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-classical font-semibold mt-3">Book not found</h1>
          <p className="text-slate-600 mt-4 max-w-md mx-auto leading-7 font-light">{loadError || "We couldn't find this book in your library."}</p>
          <button type="button" onClick={() => router.push("/library")} className={`mt-8 ${btnDark}`}>
            Back to My Library
          </button>
        </section>
      </main>
    );
  }

  const hasCustomCover = !!book.custom_cover_path;
  const modalPreviewSources = coverPreview ? [coverPreview] : customCoverUrl ? [customCoverUrl] : [];
  const currentStatusIndex = STATUS_OPTIONS.findIndex((o) => o.value === book.status);
  const isDnf = book.status === "did_not_finish";
  const isDone = book.status === "finished" || isDnf;
  const showReviewNudge = isDone && !review;

  // ============================================================
  // Render
  // ============================================================

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] overflow-x-clip">
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[120px]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[120px]" />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }

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
              background-repeat: repeat;
              background-attachment: local;
            }
            .journal-paper--lg { --pad: 20px; }

            .soft-surface { background: rgba(255, 255, 255, 0.65); backdrop-filter: blur(12px); }
            .soft-border { border-color: rgba(15, 23, 42, 0.08); }

            @keyframes sheet-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .animate-sheet-in { animation: sheet-in 300ms cubic-bezier(.2,.8,.2,1) both; }
            @media (prefers-reduced-motion: reduce) { .animate-sheet-in { animation: none; } }
          `,
        }}
      />

      <Navbar isLoggedIn={!!userId || undefined} />

      {/* ================= Toast (top on phones so it never covers the save bar) ================= */}
      {toast && (
        <div
          className="fixed top-20 sm:top-auto sm:bottom-6 inset-x-4 sm:inset-x-auto sm:right-6 z-[70] sm:max-w-sm"
          role="status"
          aria-live="polite"
        >
          <div
            className={`flex items-center gap-3 rounded-2xl px-4 sm:px-5 py-3.5 sm:py-4 shadow-[0_15px_45px_rgba(15,23,42,0.15)] border ${
              toast.type === "success" ? "bg-white border-[#7a947c]/25" : "bg-[#fbefed] border-red-200/70"
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-7 h-7 rounded-full flex items-center justify-center text-sm text-white shrink-0 ${
                toast.type === "success" ? "bg-[#7a947c]" : "bg-[#c0675b]"
              }`}
            >
              {toast.type === "success" ? "✓" : "!"}
            </span>
            <p className={`flex-1 text-sm font-medium ${toast.type === "success" ? "text-[#4a5c4b]" : "text-[#a14e43]"}`}>{toast.message}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className={`w-8 h-8 shrink-0 flex items-center justify-center text-slate-400 hover:text-[#0f172a] text-lg leading-none rounded-full ${focusRing}`}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <section className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 pt-6 md:pt-10 pb-24 relative z-10">
        <button
          type="button"
          onClick={() => attemptToLeave("/library")}
          className={`group inline-flex items-center gap-2 min-h-11 text-sm text-slate-500 hover:text-[#0f172a] transition-colors mb-5 md:mb-8 rounded ${focusRing}`}
        >
          <span aria-hidden="true" className="text-lg transition-transform group-hover:-translate-x-1">←</span>
          <span>Back to My Library</span>
        </button>

        {/* ================= Hero ================= */}
        <div className="grid lg:grid-cols-[235px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)] gap-7 lg:gap-12 xl:gap-16 items-start">
          {/* Cover */}
          <div className="w-40 sm:w-48 lg:w-full mx-auto lg:mx-0">
            <div className="relative group">
              <div className="absolute -inset-4 bg-[#0f172a]/8 rounded-[2rem] blur-2xl opacity-60" />
              <div className="relative aspect-[2/3] rounded-[1.35rem] overflow-hidden shadow-[0_24px_55px_rgba(15,23,42,0.18)] bg-slate-200 ring-1 ring-[#0f172a]/10">
                <CoverImage sources={coverSources} title={book.title} author={book.author} />

                {/* Always visible on touch screens, on hover for mouse */}
                <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3 bg-gradient-to-t from-[#0f172a]/70 to-transparent lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={openCoverModal}
                    className="w-full inline-flex items-center justify-center gap-2 min-h-10 bg-[#fdfaf3]/95 text-[#0f172a] text-xs font-semibold py-2.5 rounded-full hover:bg-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c]"
                  >
                    <CameraIcon />
                    {hasCustomCover ? "Change photo" : "Add cover photo"}
                  </button>
                </div>
              </div>
            </div>
            {!isTouchDevice && (
              <p className="hidden lg:block mt-3 text-[11px] text-slate-400 text-center">
                Tip: copy any image and press {pasteShortcut} to use it as the cover.
              </p>
            )}
          </div>

          {/* Details */}
          <div className="lg:pt-1 min-w-0">
            <h1 className="text-[2.1rem] leading-[1.08] sm:text-5xl md:text-6xl xl:text-[4.2rem] sm:leading-[1.03] font-classical font-semibold max-w-4xl break-words text-center lg:text-left">
              {book.title}
            </h1>

            {book.author && (
              <p className="text-base sm:text-xl text-slate-500 mt-3 sm:mt-4 font-light text-center lg:text-left">
                by <span className="text-slate-700">{book.author}</span>
              </p>
            )}

            {savedFinishedLabel && (
              <p className="mt-3 text-sm text-slate-500 text-center lg:text-left">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                  {isDnf ? "Put down" : "Finished"} {savedFinishedLabel}
                </span>
              </p>
            )}

            {/* Status: 2x2 grid on phones, one row from tablet up */}
            <div className="mt-6">
              <p id="status-label" className="text-xs text-slate-400 mb-2 text-center lg:text-left">Reading status</p>
              <div
                role="radiogroup"
                aria-labelledby="status-label"
                className="grid grid-cols-2 sm:inline-flex sm:flex-wrap gap-1 p-1 w-full sm:w-auto rounded-2xl sm:rounded-full bg-white/70 border border-[#0f172a]/8 shadow-sm"
              >
                {STATUS_OPTIONS.map((option, index) => {
                  const checked = book.status === option.value;
                  const pending = savingStatus === option.value;
                  const tabbable = checked || (currentStatusIndex === -1 && index === 0);

                  return (
                    <button
                      key={option.value}
                      ref={(el) => {
                        statusButtonsRef.current[index] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => updateStatus(option.value)}
                      onKeyDown={(e) => onStatusKeyDown(e, index)}
                      disabled={!!savingStatus && !pending}
                      className={`h-10 sm:h-9 px-3.5 rounded-xl sm:rounded-full text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all disabled:opacity-60 ${focusRing} ${
                        checked ? `${option.active} shadow-sm` : "text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5"
                      }`}
                    >
                      {pending ? (
                        <Spinner dark={option.value === "want_to_read" || option.value === "did_not_finish"} />
                      ) : (
                        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${checked ? "bg-current opacity-70" : option.dot}`} />
                      )}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* At a glance */}
            <dl className="mt-5 grid grid-cols-3 w-full sm:max-w-lg rounded-2xl border border-[#0f172a]/8 bg-white/60 divide-x divide-[#0f172a]/8">
              <div className="px-3 sm:px-4 py-3 sm:py-3.5 text-center sm:text-left">
                <dt className="text-[11px] sm:text-xs text-slate-400">Notes</dt>
                <dd className="font-classical text-xl sm:text-2xl mt-0.5">{journalEntries.length}</dd>
              </div>
              <div className="px-3 sm:px-4 py-3 sm:py-3.5 text-center sm:text-left">
                <dt className="text-[11px] sm:text-xs text-slate-400">{isDnf ? "Stopped at" : "Furthest page"}</dt>
                <dd className="font-classical text-xl sm:text-2xl mt-0.5">{furthestPage ?? "—"}</dd>
              </div>
              <div className="px-3 sm:px-4 py-3 sm:py-3.5 text-center sm:text-left">
                <dt className="text-[11px] sm:text-xs text-slate-400">Rating</dt>
                <dd className="mt-1.5" aria-label={review?.rating ? `${formatRating(Number(review.rating))} out of 5` : "Not rated"}>
                  {review?.rating ? (
                    <span className="flex flex-col sm:flex-row items-center sm:items-baseline gap-1 sm:gap-2">
                      <Stars value={Number(review.rating)} size="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      <span className="text-xs text-slate-500 tabular-nums">{formatRating(Number(review.rating))}</span>
                    </span>
                  ) : (
                    <span className="font-classical text-xl sm:text-2xl leading-none">—</span>
                  )}
                </dd>
              </div>
            </dl>

            {showReviewNudge && (
              <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-2xl bg-[#f7f5fa] border border-[#9a86b9]/20 px-4 py-3">
                <p className="text-sm text-[#6c5c85] flex-1">
                  {isDnf ? "Want to note why it wasn't for you?" : "You've finished it. How was it?"}
                </p>
                <button type="button" onClick={goToReview} className={`text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] self-start sm:self-auto rounded ${focusRing}`}>
                  Write your review
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 sm:flex gap-3 mt-6">
              <button type="button" onClick={goToComposer} className={btnPrimary}>
                <span aria-hidden="true">✎</span>
                Add a note
              </button>
              <button type="button" onClick={goToReview} className={btnOutline}>
                <span aria-hidden="true" className="text-[#c5a24a]">★</span>
                {review ? "Your review" : "Write review"}
              </button>
            </div>
          </div>
        </div>

        {/* ================= Tabs ================= */}
        <div className="mt-12 md:mt-16 mb-6 sm:mb-8 border-b border-[#0f172a]/8">
          <div role="tablist" aria-label="Journal and review" className="grid grid-cols-2 sm:flex sm:gap-8">
            {(
              [
                { id: "journal", label: "Reading journal", short: "Journal", badge: journalEntries.length ? String(journalEntries.length) : null, dirty: journalHasDraft || editingId !== null },
                { id: "review", label: "Final review", short: "Review", badge: review ? "✓" : null, dirty: reviewHasChanges },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  id={`tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={onTabKeyDown}
                  className={`relative -mb-px pb-3.5 pt-2 inline-flex items-center justify-center sm:justify-start gap-2 font-classical text-lg sm:text-2xl transition-colors rounded-t ${focusRing} ${
                    active ? "text-[#0f172a]" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  <span className="sm:hidden">{tab.short}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tab.badge && (
                    <span
                      className={`font-sans text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center ${
                        active ? "bg-[#0f172a] text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                  {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-[#c69a3d]" aria-label="Unsaved changes" />}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 right-0 bottom-0 h-0.5 rounded-full bg-[#7a947c] transition-transform origin-left ${active ? "scale-x-100" : "scale-x-0"}`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* ================= Journal ================= */}
        {activeTab === "journal" && (
          <div
            id="panel-journal"
            role="tabpanel"
            aria-labelledby="tab-journal"
            className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-6 sm:gap-8 lg:gap-10 items-start scroll-mt-24"
          >
            {/* Composer */}
            <form
              id="journal-composer"
              onSubmit={saveJournalEntry}
              className="lg:sticky lg:top-24 scroll-mt-24 soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)] p-5 sm:p-6"
              noValidate
            >
              <h2 className="font-classical text-2xl font-semibold">New note</h2>
              <p className="text-sm text-slate-500 mt-1 font-light">Jot down a moment, a quote or a theory.</p>

              <div className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(5.5rem,7rem)] gap-3">
                <div className="min-w-0">
                  <label htmlFor="journal-chapter" className={labelClass}>Chapter</label>
                  <input
                    id="journal-chapter"
                    type="text"
                    maxLength={100}
                    autoComplete="off"
                    value={journalChapter}
                    onChange={(e) => setJournalChapter(e.target.value)}
                    placeholder="12 or Prologue"
                    className={fieldClass}
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="journal-page" className={labelClass}>Page</label>
                  <input
                    id="journal-page"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    value={journalPage}
                    onChange={(e) => setJournalPage(digitsOnly(e.target.value))}
                    placeholder="143"
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor="journal" className="sr-only">Your note</label>
                <textarea
                  id="journal"
                  ref={journalTextRef}
                  value={journalText}
                  onChange={(e) => setJournalText(e.target.value)}
                  onKeyDown={(e) => onSaveShortcut(e, () => saveJournalEntry())}
                  placeholder="What's on your mind at this point in the book?"
                  rows={6}
                  className="journal-paper w-full px-4 border border-[#0f172a]/10 rounded-xl resize-y min-h-[170px] sm:min-h-[200px] text-base sm:text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label htmlFor="journal-date" className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Date</span>
                  <input
                    id="journal-date"
                    type="date"
                    value={journalDate}
                    max={todayLocal()}
                    onChange={(e) => setJournalDate(e.target.value)}
                    className="h-10 sm:h-8 px-2 bg-white border border-[#0f172a]/10 rounded-lg text-base sm:text-xs text-slate-600 focus:outline-none focus:border-[#7a947c]"
                  />
                </label>
                <span className="text-[11px] text-slate-400 hidden sm:inline">{saveShortcut} to save</span>
              </div>

              {journalError && <p role="alert" className="mt-3 text-sm text-[#a14e43]">{journalError}</p>}

              <button type="submit" disabled={savingJournal || !journalText.trim()} className={`w-full mt-4 ${btnPrimary}`}>
                {savingJournal && <Spinner />}
                <span className="truncate">
                  {savingJournal ? "Saving…" : composerLocation ? `Save note at ${composerLocation.charAt(0).toLowerCase()}${composerLocation.slice(1)}` : "Save note"}
                </span>
              </button>

              <p className="text-[11px] text-slate-400 mt-3 text-center">Private to you. Chapter and page carry over to your next note.</p>
            </form>

            {/* Entries */}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <p className="text-sm text-slate-500">
                  {journalEntries.length} {journalEntries.length === 1 ? "note" : "notes"}
                </p>

                {journalEntries.length > 1 && (
                  <div role="group" aria-label="Sort notes" className="inline-flex p-1 rounded-full bg-[#0f172a]/5 text-xs">
                    {(["recent", "page"] as SortMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSortMode(mode)}
                        aria-pressed={sortMode === mode}
                        className={`h-9 sm:h-8 px-3.5 rounded-full font-medium transition-all ${focusRing} ${
                          sortMode === mode ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
                        }`}
                      >
                        {mode === "recent" ? "Newest first" : "Book order"}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {journalEntries.length === 0 ? (
                <div className="soft-surface border border-dashed border-[#0f172a]/12 rounded-[1.6rem] p-8 sm:p-14 text-center">
                  <div className="w-16 h-16 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-5">
                    <span className="font-classical text-2xl text-[#9a86b9]">A</span>
                  </div>
                  <h3 className="font-classical text-2xl font-semibold">No notes yet</h3>
                  <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto leading-6 font-light">
                    Add the chapter or page with each note, and you&apos;ll be able to read your thoughts back in book order.
                  </p>
                  <button
                    type="button"
                    onClick={goToComposer}
                    className={`mt-6 text-sm font-semibold text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
                  >
                    Write your first note
                  </button>
                </div>
              ) : (
                <ol className="relative space-y-4 sm:space-y-5">
                  <span aria-hidden="true" className="absolute left-[17px] top-4 bottom-4 w-px bg-[#0f172a]/10 hidden sm:block" />

                  {sortedEntries.map((entry) => {
                    const location = locationLabel(entry.chapter, entry.page_number);
                    const isEditing = editingId === entry.id;
                    const confirmingDelete = confirmDeleteId === entry.id;

                    return (
                      <li key={entry.id} className="relative sm:pl-12">
                        <span
                          aria-hidden="true"
                          className="hidden sm:flex absolute left-0 top-5 w-9 h-9 rounded-full bg-[#fdfaf3] border border-[#0f172a]/10 items-center justify-center text-[10px] font-semibold text-[#4a5c4b]"
                        >
                          {entry.page_number != null ? (entry.page_number > 999 ? "p." : entry.page_number) : <span className="w-2 h-2 rounded-full bg-[#7a947c]" />}
                        </span>

                        <article className="soft-surface border soft-border rounded-[1.4rem] shadow-[0_8px_30px_rgba(15,23,42,0.04)] overflow-hidden">
                          {isEditing ? (
                            <div className="p-4 sm:p-6">
                              {/* Chapter + page share a row; the date gets its own on phones */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                <div className="min-w-0">
                                  <label htmlFor={`edit-chapter-${entry.id}`} className={labelClass}>Chapter</label>
                                  <input id={`edit-chapter-${entry.id}`} type="text" maxLength={100} value={editChapter} onChange={(e) => setEditChapter(e.target.value)} className={fieldClass} />
                                </div>
                                <div className="min-w-0">
                                  <label htmlFor={`edit-page-${entry.id}`} className={labelClass}>Page</label>
                                  <input
                                    id={`edit-page-${entry.id}`}
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={editPage}
                                    onChange={(e) => setEditPage(digitsOnly(e.target.value))}
                                    className={fieldClass}
                                  />
                                </div>
                                <div className="min-w-0 col-span-2 sm:col-span-1">
                                  <label htmlFor={`edit-date-${entry.id}`} className={labelClass}>Date</label>
                                  <input id={`edit-date-${entry.id}`} type="date" max={todayLocal()} value={editDate} onChange={(e) => setEditDate(e.target.value)} className={fieldClass} />
                                </div>
                              </div>

                              <label htmlFor={`edit-text-${entry.id}`} className="sr-only">Note</label>
                              <textarea
                                id={`edit-text-${entry.id}`}
                                value={editText}
                                autoFocus
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => {
                                  onSaveShortcut(e, saveEdit);
                                  if (e.key === "Escape") cancelEdit();
                                }}
                                rows={6}
                                className="journal-paper mt-3 w-full px-4 border border-[#0f172a]/10 rounded-xl resize-y text-base sm:text-[15px] text-slate-700 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                              />

                              {editError && <p role="alert" className="mt-2 text-sm text-[#a14e43]">{editError}</p>}

                              <div className="mt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                                <button type="button" onClick={cancelEdit} disabled={savingEdit} className={btnGhost}>
                                  Cancel
                                </button>
                                <button type="button" onClick={saveEdit} disabled={savingEdit} className={`${btnDark} h-11 sm:h-10 px-5`}>
                                  {savingEdit && <Spinner />}
                                  Save changes
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 sm:p-6">
                              <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                {location && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">{location}</span>
                                )}
                                <time dateTime={entry.entry_date} className="text-xs text-slate-400" title={formatEntryDate(entry.entry_date, "long")}>
                                  {formatEntryDate(entry.entry_date, "short")}
                                </time>

                                <div className="ml-auto flex items-center gap-1">
                                  {confirmingDelete ? (
                                    <>
                                      <span className="text-xs text-slate-500 mr-1">Delete?</span>
                                      <button
                                        type="button"
                                        onClick={() => deleteJournalEntry(entry.id)}
                                        className={`text-xs font-medium text-white bg-[#c0675b] hover:bg-[#a14e43] px-3 py-2 rounded-lg transition-colors ${focusRing}`}
                                      >
                                        Delete
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        className={`text-xs text-slate-500 hover:text-[#0f172a] px-3 py-2 rounded-lg hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
                                      >
                                        Keep
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => startEdit(entry)}
                                        aria-label={`Edit note${location ? ` at ${location}` : ""}`}
                                        className={`text-xs text-slate-400 hover:text-[#0f172a] px-3 py-2 rounded-lg hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingId(null);
                                          setConfirmDeleteId(entry.id);
                                        }}
                                        aria-label={`Delete note${location ? ` at ${location}` : ""}`}
                                        className={`text-xs text-slate-400 hover:text-[#a34d43] px-3 py-2 rounded-lg hover:bg-[#f7e9e6] transition-colors ${focusRing}`}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </header>

                              <p className="mt-3 text-slate-700 leading-7 sm:leading-8 whitespace-pre-wrap break-words text-[15px] font-light">{entry.content}</p>
                            </div>
                          )}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}

        {/* ================= Review ================= */}
        {activeTab === "review" && (
          <div id="panel-review" role="tabpanel" aria-labelledby="tab-review" className="scroll-mt-24">
            {/* Not marked finished yet */}
            {!isDone && (
              <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl bg-[#f7f5fa] border border-[#9a86b9]/20 px-4 sm:px-5 py-3.5">
                <p className="flex-1 text-sm text-[#6c5c85] leading-6">
                  This book is on your <span className="font-medium">{STATUS_OPTIONS.find((o) => o.value === book.status)?.label ?? "Want to read"}</span> shelf.
                  Reviewing it because you&apos;ve finished?
                </p>
                <button
                  type="button"
                  onClick={() => updateStatus("finished")}
                  disabled={!!savingStatus}
                  className={`${btnOutline} h-10 px-4 w-full sm:w-auto`}
                >
                  {savingStatus === "finished" && <Spinner dark />}
                  Mark as finished
                </button>
              </div>
            )}

            <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-10 items-start">
              {/* ---------- Form ---------- */}
              <div className="min-w-0 soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)]">
                {/* 1. Rating */}
                <ReviewStep
                  step={1}
                  id="review-rating-title"
                  title="Your rating"
                  hint="Tap, or drag along the stars for quarter and half stars. Tap the same spot again to clear."
                  done={rating > 0}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                    {/* Stars: one continuous strip so every quarter is the same width */}
                    <div
                      ref={ratingBarRef}
                      role="slider"
                      tabIndex={0}
                      aria-labelledby="review-rating-title"
                      aria-valuemin={0}
                      aria-valuemax={RATING_MAX}
                      aria-valuenow={rating}
                      aria-valuetext={rating > 0 ? `${formatRating(rating)} out of 5 stars, ${ratingLabel(rating)}` : "Not rated"}
                      onPointerDown={onRatingPointerDown}
                      onPointerMove={onRatingPointerMove}
                      onPointerUp={onRatingPointerUp}
                      onPointerCancel={onRatingPointerCancel}
                      onPointerLeave={() => {
                        if (!ratingDragRef.current) setHoveredRating(0);
                      }}
                      onKeyDown={onRatingKeyDown}
                      className={`relative inline-flex w-fit select-none cursor-pointer rounded-2xl p-1.5 -m-1.5 touch-pan-y ${focusRing}`}
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <span key={star} className="w-12 h-12 sm:w-[3.25rem] sm:h-[3.25rem] flex items-center justify-center">
                          <StarIcon
                            fill={displayRating - (star - 1)}
                            className={`w-full h-full transition-transform duration-150 ${star <= Math.ceil(displayRating) ? "scale-100" : "scale-95"}`}
                          />
                        </span>
                      ))}
                    </div>

                    {/* Value + fine-tune */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center rounded-full border border-[#0f172a]/10 bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => nudgeRating(-RATING_STEP)}
                          disabled={rating <= RATING_STEP}
                          aria-label="Quarter star less"
                          className={`w-10 h-10 flex items-center justify-center text-lg text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${focusRing}`}
                        >
                          −
                        </button>
                        <span className="min-w-[3.5rem] px-1 text-center font-classical text-xl text-[#0f172a] tabular-nums" aria-hidden="true">
                          {displayRating > 0 ? formatRating(displayRating) : "–"}
                        </span>
                        <button
                          type="button"
                          onClick={() => nudgeRating(RATING_STEP)}
                          disabled={rating >= RATING_MAX}
                          aria-label="Quarter star more"
                          className={`w-10 h-10 flex items-center justify-center text-lg text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${focusRing}`}
                        >
                          +
                        </button>
                      </div>
                      {rating > 0 && (
                        <button
                          type="button"
                          onClick={() => setRating(0)}
                          className={`text-xs font-medium text-slate-400 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] rounded ${focusRing}`}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 min-h-8 flex flex-wrap items-center gap-2" aria-live="polite">
                    {displayRating > 0 ? (
                      <>
                        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#fbf3e2] text-[#8a6a22] text-sm font-medium border border-[#c69a3d]/20">
                          {ratingLabel(displayRating)}
                        </span>
                        <span className="text-sm text-slate-400">
                          {formatRating(displayRating)} of 5{fractionHint(displayRating) && `, ${Math.floor(displayRating)} ${fractionHint(displayRating)}`}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-slate-400">Not rated yet</span>
                    )}
                  </div>
                </ReviewStep>

                {/* 2. When you finished */}
                <ReviewStep
                  step={2}
                  id="review-finished-title"
                  title={isDnf ? "When did you put it down?" : "When did you finish?"}
                  hint={
                    finishedYear ? undefined : (
                      <>
                        Leave it empty and we&apos;ll use <span className="font-medium text-slate-700">{defaultFinished}</span>.
                      </>
                    )
                  }
                  done={!!finishedYear}
                >
                  {/* Year: recent years as one tap, any other year from the list */}
                  <p id="finished-year-label" className={labelClass}>Year</p>
                  <div role="group" aria-labelledby="finished-year-label" className="flex flex-wrap items-center gap-2">
                    {yearOptions.slice(0, 3).map((year) => {
                      const selected = finishedYear === String(year);
                      return (
                        <button
                          key={year}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => chooseYear(selected ? "" : String(year))}
                          className={`h-11 sm:h-10 px-4 rounded-full border text-sm font-medium transition-all ${focusRing} ${
                            selected
                              ? "bg-[#0f172a] border-[#0f172a] text-[#fdfaf3]"
                              : "bg-white border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c] hover:text-[#4a5c4b]"
                          }`}
                        >
                          {year}
                        </button>
                      );
                    })}

                    <label htmlFor="finished-year-other" className="sr-only">Another year</label>
                    <select
                      id="finished-year-other"
                      value={yearOptions.slice(0, 3).some((y) => String(y) === finishedYear) ? "" : finishedYear}
                      onChange={(e) => chooseYear(e.target.value)}
                      className={`${selectClass} !w-auto !h-11 sm:!h-10 !rounded-full pl-4 ${
                        finishedYear && !yearOptions.slice(0, 3).some((y) => String(y) === finishedYear)
                          ? "!border-[#0f172a] !text-[#0f172a] font-medium"
                          : "text-slate-600"
                      }`}
                    >
                      <option value="">Earlier year</option>
                      {yearOptions.slice(3).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  {/* Month: optional, only once a year is chosen */}
                  <div className={`mt-5 transition-opacity ${finishedYear ? "" : "opacity-50"}`}>
                    <div className="flex items-baseline justify-between gap-3 mb-1.5">
                      <p id="finished-month-label" className="text-xs font-medium text-slate-500">Month</p>
                      <span className="text-[11px] text-slate-400">{finishedYear ? "Optional" : "Choose a year first"}</span>
                    </div>
                    <div role="group" aria-labelledby="finished-month-label" className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                      {MONTHS.map((name, i) => {
                        const value = String(i + 1);
                        const selected = finishedMonth === value;
                        const future = Number(finishedYear) === currentYear && i + 1 > currentMonth;
                        return (
                          <button
                            key={name}
                            type="button"
                            aria-pressed={selected}
                            aria-label={name}
                            disabled={!finishedYear || future}
                            onClick={() => setFinishedMonth(selected ? "" : value)}
                            className={`h-10 rounded-xl border text-sm transition-all disabled:cursor-not-allowed ${focusRing} ${
                              selected
                                ? "bg-[#eef3ee] border-[#7a947c] text-[#4a5c4b] font-semibold"
                                : future
                                  ? "border-dashed border-[#0f172a]/10 text-slate-300"
                                  : "bg-white border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c]/60"
                            }`}
                          >
                            {name.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* What will be saved */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0f172a]/[0.03] px-3.5 py-2.5">
                    <p className="text-sm text-slate-600">
                      {finishedYear ? (
                        <>
                          Saving as <span className="font-medium text-[#0f172a]">{formatFinished(Number(finishedYear), finishedMonth ? Number(finishedMonth) : null)}</span>
                          {!finishedMonth && <span className="text-slate-400"> (month not set)</span>}
                        </>
                      ) : (
                        <>
                          Saving as <span className="font-medium text-[#0f172a]">{defaultFinished}</span>
                          <span className="text-slate-400"> (when you wrote it)</span>
                        </>
                      )}
                    </p>
                    {finishedYear && (
                      <button
                        type="button"
                        onClick={() => chooseYear("")}
                        className={`text-xs font-medium text-slate-500 underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a] rounded ${focusRing}`}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </ReviewStep>

                {/* 3. Thoughts */}
                <ReviewStep
                  step={3}
                  id="review-text-title"
                  title={isDnf ? "Why you stopped" : "Your thoughts"}
                  hint="A few lines or a few pages. Tap a starter if you're not sure where to begin."
                  done={!!reviewText.trim()}
                  optional
                >
                  <div className="-mx-1 px-1 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible [scrollbar-width:none]">
                    {REVIEW_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => insertPrompt(prompt)}
                        className={`shrink-0 h-9 px-3.5 rounded-full border border-dashed border-[#9a86b9]/40 bg-[#f7f5fa]/70 text-[13px] text-[#6c5c85] hover:bg-[#f7f5fa] hover:border-[#9a86b9] transition-colors ${focusRing}`}
                      >
                        + {prompt.replace(/:$/, "")}
                      </button>
                    ))}
                  </div>

                  <textarea
                    id="review"
                    ref={reviewTextRef}
                    aria-labelledby="review-text-title"
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    onKeyDown={(e) => onSaveShortcut(e, saveReview)}
                    placeholder={
                      isDnf
                        ? "What made you put it down? Was there anything you liked?"
                        : "What stayed with you? The characters, the writing, the ending…"
                    }
                    rows={9}
                    className="journal-paper journal-paper--lg mt-3 w-full px-4 sm:px-5 border border-[#0f172a]/10 rounded-2xl resize-y min-h-[220px] sm:min-h-[280px] text-base text-slate-700 placeholder:text-slate-400 placeholder:font-light focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                  />

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>{reviewText.trim() ? `${reviewText.trim().split(/\s+/).length} words` : "Private to you"}</span>
                    {journalEntries.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab("journal")}
                        className={`text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
                      >
                        Look back at your {journalEntries.length} {journalEntries.length === 1 ? "note" : "notes"}
                      </button>
                    )}
                  </div>
                </ReviewStep>

                {/* Save bar: stays on screen while you write */}
                <div className="sticky bottom-0 z-10 rounded-b-[1.6rem] px-5 sm:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-4 bg-[#fdfaf3]/95 backdrop-blur border-t border-[#0f172a]/[0.06]">
                  {reviewError && (
                    <p role="alert" className="mb-3 text-sm text-[#a14e43]">
                      {reviewError}
                    </p>
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <p className="text-xs flex-1 min-h-4" aria-live="polite">
                      {reviewHasChanges ? (
                        <span className="inline-flex items-center gap-1.5 text-[#a47a25]">
                          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#c69a3d]" />
                          Unsaved changes
                          <span className="hidden sm:inline text-slate-400">, {saveShortcut} to save</span>
                        </span>
                      ) : review ? (
                        <span className="text-slate-400">
                          Saved {new Date(review.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      ) : rating === 0 ? (
                        <span className="text-slate-400">Choose a rating to save</span>
                      ) : null}
                    </p>

                    <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
                      {reviewHasChanges && review ? (
                        <button type="button" onClick={discardReviewChanges} className={`${btnOutline} h-11 px-5`}>
                          Discard
                        </button>
                      ) : (
                        <span className="sm:hidden" />
                      )}
                      <button
                        type="button"
                        onClick={saveReview}
                        disabled={savingReview || !reviewHasChanges || rating === 0}
                        className={`${btnDark} h-11 ${reviewHasChanges && review ? "" : "col-span-2"}`}
                      >
                        {savingReview && <Spinner />}
                        {savingReview ? "Saving…" : review ? "Update review" : "Save review"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ---------- Summary (desktop) ---------- */}
              <aside className="hidden lg:block sticky top-24" aria-label="Review summary">
                <div className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)] p-5">
                  <div className="flex gap-4">
                    <div className="w-16 shrink-0">
                      <div className="aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-slate-200 ring-1 ring-[#0f172a]/10">
                        <CoverImage sources={coverSources} title={book.title} author={book.author} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="font-classical text-lg font-semibold leading-snug text-[#0f172a] line-clamp-3">{book.title}</p>
                      {book.author && <p className="text-sm text-slate-500 font-light truncate">{book.author}</p>}
                    </div>
                  </div>

                  <dl className="mt-5 space-y-3.5 text-sm">
                    <div>
                      <dt className="text-xs text-slate-400">Rating</dt>
                      <dd className="mt-1 flex items-center gap-2">
                        {rating > 0 ? (
                          <>
                            <Stars value={rating} />
                            <span className="text-slate-600 tabular-nums">{formatRating(rating)}</span>
                          </>
                        ) : (
                          <span className="text-slate-400">Not rated yet</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">{isDnf ? "Put down" : "Finished"}</dt>
                      <dd className="mt-1 text-slate-700">
                        {finishedYear ? formatFinished(Number(finishedYear), finishedMonth ? Number(finishedMonth) : null) : defaultFinished}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Your thoughts</dt>
                      <dd className="mt-1 text-slate-700">
                        {reviewText.trim() ? `${reviewText.trim().split(/\s+/).length} words` : <span className="text-slate-400">None yet</span>}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-5 pt-4 border-t border-[#0f172a]/[0.06] text-xs text-slate-400 leading-5">
                    Only you can see this review.
                  </p>
                </div>
              </aside>
            </div>
          </div>
        )}
      </section>

      {/* ================= Cover photo modal ================= */}
      {showCoverModal && (
        <div
          className="fixed inset-0 z-[60] bg-[#0f172a]/55 backdrop-blur-sm flex items-end sm:items-center justify-center sm:px-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCoverModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cover-modal-title"
            className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto overscroll-contain bg-[#fdfaf3] border border-[#0f172a]/10 rounded-t-[1.6rem] sm:rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] animate-sheet-in"
          >
            <div className="px-5 sm:px-8 pt-3 sm:pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-8">
              <div aria-hidden="true" className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="cover-modal-title" className="text-2xl sm:text-3xl font-classical font-semibold">
                    {hasCustomCover ? "Change cover photo" : "Add a cover photo"}
                  </h2>
                  <p className="text-sm text-slate-500 mt-2 leading-6 font-light">
                    Your photo replaces the catalogue cover. Take one, upload one, or paste one you&apos;ve copied.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCoverModal}
                  disabled={savingCover}
                  aria-label="Close"
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">×</span>
                </button>
              </div>

              {/* Preview above the options on phones, beside them from tablet up */}
              <div className="mt-6 sm:mt-7 flex flex-col sm:flex-row gap-5 items-center sm:items-start">
                <div className="w-28 sm:w-32 shrink-0">
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-md bg-[#e9e4d9] ring-1 ring-[#0f172a]/10">
                    <CoverImage sources={modalPreviewSources} title={book.title} author={book.author} />
                    {coverPreview && <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-[#7a947c] text-white shadow">New</span>}
                  </div>
                </div>

                <div className="flex-1 min-w-0 w-full">
                  <input
                    ref={coverUploadRef}
                    id="cover-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(event) => handleCoverFile(event.target.files?.[0])}
                  />
                  <input
                    ref={coverCameraRef}
                    id="cover-camera"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(event) => handleCoverFile(event.target.files?.[0])}
                  />

                  {/* Drop zone only where there's a mouse to drag with */}
                  {!isTouchDevice && (
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragOver(false);
                        const file = Array.from(event.dataTransfer.files ?? []).find((f) => f.type.startsWith("image/"));
                        if (file) handleCoverFile(file);
                        else setCoverError("Drop an image file (JPG, PNG or WebP).");
                      }}
                      className={`mb-3 flex flex-col items-center justify-center gap-1.5 text-center min-h-[120px] p-4 rounded-2xl border-2 border-dashed transition-all ${
                        dragOver ? "border-[#7a947c] bg-[#7a947c]/10" : "border-[#0f172a]/15 bg-white"
                      }`}
                    >
                      <span className="w-10 h-10 rounded-full bg-[#7a947c]/15 text-[#7a947c] flex items-center justify-center" aria-hidden="true">
                        <ImageIcon />
                      </span>
                      <span className="text-sm font-medium">
                        {dragOver ? "Drop to use this image" : coverFile ? "Looks good. Want a different one?" : "Drop an image here"}
                      </span>
                      <span className="text-xs text-slate-400">
                        or paste one with <kbd className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-sans">{pasteShortcut}</kbd>
                      </span>
                    </div>
                  )}

                  <div className="grid gap-2">
                    {isTouchDevice && (
                      <button type="button" onClick={() => coverCameraRef.current?.click()} disabled={savingCover} className={`${btnOutline} w-full`}>
                        <CameraIcon size={16} />
                        Take a photo
                      </button>
                    )}
                    <button type="button" onClick={() => coverUploadRef.current?.click()} disabled={savingCover} className={`${btnOutline} w-full`}>
                      <UploadIcon />
                      {isTouchDevice ? "Choose from photos" : "Upload a file"}
                    </button>
                    {canReadClipboard && (
                      <button type="button" onClick={pasteFromClipboard} disabled={savingCover || readingClipboard} className={`${btnOutline} w-full`}>
                        {readingClipboard ? <Spinner dark /> : <ClipboardIcon />}
                        Paste image
                      </button>
                    )}
                  </div>

                  <p className="mt-2.5 text-[11px] text-slate-400 text-center">JPG, PNG or WebP, up to 5 MB</p>
                  {coverFile && (
                    <p className="mt-1 text-xs text-slate-500 truncate text-center">
                      {coverFile.name}, {(coverFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
                </div>
              </div>

              {coverError && (
                <div role="alert" className="mt-5 px-4 py-3 rounded-xl bg-[#f8e9e5]/90 border border-[#e8cbc4] text-[#a14e43] text-sm">
                  {coverError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2.5 sm:gap-3 mt-7">
                {hasCustomCover && !coverFile && (
                  <button
                    type="button"
                    onClick={removeCustomCover}
                    disabled={savingCover}
                    className={`sm:mr-auto min-h-11 text-sm text-slate-400 hover:text-[#a34d43] px-3 py-2 rounded-full hover:bg-[#f7e9e6] transition-all disabled:opacity-40 ${focusRing}`}
                  >
                    Remove my photo
                  </button>
                )}
                <button type="button" onClick={closeCoverModal} disabled={savingCover} className={`${btnOutline} ${hasCustomCover && !coverFile ? "" : "sm:ml-auto"}`}>
                  Cancel
                </button>
                <button type="button" onClick={saveCustomCover} disabled={!coverFile || savingCover} className={btnPrimary}>
                  {savingCover && <Spinner />}
                  {savingCover ? "Saving…" : "Save cover"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= Unsaved changes modal ================= */}
      {showLeaveModal && (
        <div
          className="fixed inset-0 z-[60] bg-[#0f172a]/55 backdrop-blur-sm flex items-end sm:items-center justify-center sm:px-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowLeaveModal(false);
              setPendingDestination(null);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-title"
            className="w-full sm:max-w-md bg-[#fdfaf3] border border-[#0f172a]/10 rounded-t-[1.6rem] sm:rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] px-6 sm:px-8 pt-7 sm:pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-8 animate-sheet-in"
          >
            <h2 id="leave-title" className="text-2xl sm:text-3xl font-classical font-semibold">Leave without saving?</h2>
            <p className="text-slate-600 mt-4 leading-7 text-sm font-light">
              {[journalHasDraft && "an unsaved note", editingId !== null && "a note you're editing", reviewHasChanges && "review changes"]
                .filter(Boolean)
                .join(", ")
                .replace(/^./, (c) => c.toUpperCase())}{" "}
              will be lost if you leave now.
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 mt-7">
              <button
                type="button"
                onClick={() => {
                  setShowLeaveModal(false);
                  setPendingDestination(null);
                }}
                className={`flex-1 ${btnOutline}`}
              >
                Keep editing
              </button>
              <button type="button" onClick={discardAndLeave} className={`flex-1 ${btnDark}`}>
                Discard and leave
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ============================================================
// Icons
// ============================================================

function CameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-8 9" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
    </svg>
  );
}