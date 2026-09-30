"use client";

// src/app/library/[bookId]/page.tsx

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DATE_FORMATS: Record<"long" | "short" | "month" | "day", Intl.DateTimeFormatOptions> = {
  long: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  short: { month: "short", day: "numeric", year: "numeric" },
  month: { month: "short" },
  day: { day: "numeric" },
};

function formatEntryDate(date: string, style: "long" | "short" | "month" | "day" = "long") {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", DATE_FORMATS[style]);
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

function locationLabel(chapter: string | null, page: number | null) {
  const parts: string[] = [];
  if (chapter) parts.push(chapterLabel(chapter));
  if (page != null) parts.push(`Page ${page}`);
  return parts.join(" · ");
}

// Returns a number, null (empty), or "invalid"
function parsePage(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 100000) return "invalid";
  return n;
}

const RATING_LABEL: Record<number, string> = {
  1: "It wasn't for me",
  2: "It was okay",
  3: "I liked it",
  4: "I really liked it",
  5: "A new favourite",
};

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfaf3]";

const fieldClass =
  "w-full h-11 px-3.5 bg-white border border-[#0f172a]/10 rounded-xl text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all";

// ============================================================
// Cover image: tries each source in order, then shows the placeholder
// ============================================================

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
    <div className="w-full h-full bg-[#0f172a] text-[#fdfaf3] p-7 flex flex-col justify-between">
      <span className="text-[10px] tracking-[0.2em] opacity-50">The Archive</span>
      <div>
        <p className="font-classical text-2xl leading-tight">{title}</p>
        {author && <p className="text-sm opacity-60 mt-3">{author}</p>}
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
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>("journal");

  // Review
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [initialRating, setInitialRating] = useState(0);
  const [initialReviewText, setInitialReviewText] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [hoveredRating, setHoveredRating] = useState(0);

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

  // Keyboard hint: decided after mount so server and client HTML match
  const [saveShortcut, setSaveShortcut] = useState("Ctrl Enter");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setSaveShortcut("⌘ Enter");
  }, []);

  // ============================================================
  // Signed URL for the private custom cover
  // ============================================================

  async function signCustomCover(path: string | null) {
    if (!path) {
      setCustomCoverUrl(null);
      return;
    }

    const { data, error: signError } = await supabase.storage
      .from(COVER_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);

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
        supabase.from("book_reviews").select("*").eq("book_id", bookId).eq("user_id", currentUserId).maybeSingle(),
        supabase
          .from("book_journal_entries")
          .select("*")
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
      await signCustomCover(loadedBook.custom_cover_path);

      if (reviewResult.error) console.error("Error loading review:", reviewResult.error.message);

      const savedReview = reviewResult.data as Review | null;
      setReview(savedReview);
      setRating(savedReview?.rating || 0);
      setReviewText(savedReview?.review_text || "");
      setInitialRating(savedReview?.rating || 0);
      setInitialReviewText(savedReview?.review_text || "");

      if (journalResult.error) console.error("Error loading journal:", journalResult.error.message);

      const entries = (journalResult.data || []) as JournalEntry[];
      setJournalEntries(entries);

      // Pick up where you left off: prefill chapter + page from your latest note
      const latest = [...entries].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
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

  const coverSources = useMemo(() => {
    const sources: string[] = [];
    if (book?.cover_url) sources.push(book.cover_url);
    if (customCoverUrl) sources.push(customCoverUrl);
    return sources;
  }, [book?.cover_url, customCoverUrl]);

  const reviewHasChanges = rating !== initialRating || reviewText !== initialReviewText;
  const journalHasDraft = journalText.trim().length > 0;
  const hasUnsaved = reviewHasChanges || journalHasDraft || editingId !== null;

  const sortedEntries = useMemo(
    () => (sortMode === "page" ? sortByPage(journalEntries) : sortByRecent(journalEntries)),
    [journalEntries, sortMode]
  );

  // Furthest page noted, shown as reading progress in the hero
  const furthestPage = useMemo(() => {
    const pages = journalEntries.map((e) => e.page_number).filter((p): p is number => p != null);
    return pages.length ? Math.max(...pages) : null;
  }, [journalEntries]);

  const displayRating = hoveredRating || rating;

  const composerPage = parsePage(journalPage);
  const composerLocation = locationLabel(
    journalChapter.trim() || null,
    composerPage === "invalid" ? null : composerPage
  );

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
  // Update status (optimistic, rolls back on failure)
  // ============================================================

  async function updateStatus(next: BookStatus) {
    if (!book || !userId || savingStatus || book.status === next) return;

    const previous = book.status;
    setBook({ ...book, status: next });
    setSavingStatus(next);

    const { error: statusError } = await supabase
      .from("books")
      .update({ status: next })
      .eq("id", book.id)
      .eq("user_id", userId);

    setSavingStatus(null);

    if (statusError) {
      console.error(
        "Status update failed:",
        statusError.code === "23514"
          ? "The books_status_check constraint rejected this value. Run book-status.sql."
          : statusError.message
      );
      setBook((current) => (current ? { ...current, status: previous } : current));
      showToast("error", "The status couldn't be changed. Try again.");
      return;
    }

    showToast("success", STATUS_TOAST[next]);
  }

  // Arrow keys move between statuses, like native radio buttons
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
    if (coverInputRef.current) coverInputRef.current.value = "";
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

  async function saveCustomCover() {
    if (!book || !userId || !coverFile || !coverFileType) return;

    setSavingCover(true);
    setCoverError("");

    const previousPath = book.custom_cover_path;
    const newPath = `${userId}/${crypto.randomUUID()}.${ALLOWED_COVER_TYPES[coverFileType]}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(COVER_BUCKET)
        .upload(newPath, coverFile, { contentType: coverFileType, cacheControl: "3600", upsert: false });

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
      showToast(
        "success",
        book.cover_url ? "Cover photo saved. It shows if the catalogue cover is unavailable." : "Cover photo saved."
      );
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

  // Save with Cmd/Ctrl + Enter
  function onSaveShortcut(event: ReactKeyboardEvent, save: () => void) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  }

  // ============================================================
  // Save review
  // ============================================================

  async function saveReview() {
    if (!userId || !book || savingReview) return;
    setReviewError("");

    if (rating === 0) {
      setReviewError("Choose a star rating before saving.");
      return;
    }

    if (!reviewText.trim()) {
      setReviewError("Write a few words before saving your review.");
      return;
    }

    if (!reviewHasChanges) return;

    setSavingReview(true);

    try {
      const cleanReview = reviewText.trim();

      const { data, error: saveError } = await supabase
        .from("book_reviews")
        .upsert(
          {
            user_id: userId,
            book_id: book.id,
            rating,
            review_text: cleanReview,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,book_id" }
        )
        .select()
        .single();

      if (saveError) {
        console.error("Error saving review:", saveError.message);
        setReviewError("Your review couldn't be saved. Try again.");
        return;
      }

      setReview(data as Review);
      setReviewText(cleanReview);
      setInitialRating(rating);
      setInitialReviewText(cleanReview);

      showToast("success", review ? "Review updated." : "Review saved.");
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
    setReviewError("");
  }

  // ============================================================
  // Save journal entry
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
    if (chapter && chapter.length > 100) {
      setJournalError("Keep the chapter under 100 characters.");
      return;
    }

    setSavingJournal(true);

    try {
      const { data, error: journalInsertError } = await supabase
        .from("book_journal_entries")
        .insert({
          user_id: userId,
          book_id: book.id,
          entry_date: journalDate,
          content: journalText.trim(),
          chapter,
          page_number: page,
        })
        .select()
        .single();

      if (journalInsertError) {
        console.error("Error saving journal entry:", journalInsertError.message);
        setJournalError("Your note couldn't be saved. Try again.");
        return;
      }

      setJournalEntries((current) => [data as JournalEntry, ...current]);

      // Keep chapter and page so the next note continues from the same spot
      setJournalText("");
      journalTextRef.current?.focus();

      showToast("success", locationLabel(chapter, page) ? `Note saved at ${locationLabel(chapter, page)}.` : "Note saved.");
    } catch (err) {
      console.error("Unexpected journal save error:", err);
      setJournalError("Something went wrong while saving your note.");
    } finally {
      setSavingJournal(false);
    }
  }

  // ============================================================
  // Edit journal entry
  // ============================================================

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
      .select()
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

  // ============================================================
  // Delete journal entry
  // ============================================================

  async function deleteJournalEntry(id: string) {
    if (!userId) return;

    setConfirmDeleteId(null);
    const previous = journalEntries;
    setJournalEntries((current) => current.filter((entry) => entry.id !== id));

    const { error: deleteError } = await supabase
      .from("book_journal_entries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

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

        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12" aria-busy="true" aria-label="Loading book">
          <div className="animate-pulse">
            <div className="h-4 w-28 bg-slate-900/10 rounded-full mb-12" />
            <div className="grid lg:grid-cols-[250px_1fr] gap-10">
              <div className="aspect-[2/3] rounded-[1.5rem] bg-slate-900/10" />
              <div className="pt-5">
                <div className="h-4 w-36 bg-slate-900/10 rounded-full mb-6" />
                <div className="h-14 w-3/4 bg-slate-900/10 rounded-xl mb-5" />
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

        <section className="max-w-4xl mx-auto px-5 sm:px-8 py-24 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-7">
            <span className="font-classical text-3xl text-[#9a86b9]">A</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-classical font-semibold mt-3">Book not found</h1>

          <p className="text-slate-600 mt-4 max-w-md mx-auto leading-7 font-light">
            {loadError || "We couldn't find this book in your library."}
          </p>

          <button
            type="button"
            onClick={() => router.push("/library")}
            className={`mt-8 bg-[#0f172a] text-[#fdfaf3] px-7 py-3.5 rounded-full hover:bg-[#1e293b] transition-all ${focusRing}`}
          >
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
  const showReviewNudge = (book.status === "finished" || isDnf) && !review;

  // ============================================================
  // Render
  // ============================================================

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a]">
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
              background-image: linear-gradient(
                to bottom,
                transparent var(--rule-at),
                var(--rule) var(--rule-at),
                var(--rule) calc(var(--rule-at) + 1px),
                transparent calc(var(--rule-at) + 1px)
              );
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

      {/* ================= Toast ================= */}
      {toast && (
        <div className="fixed bottom-5 inset-x-5 sm:inset-x-auto sm:right-6 sm:bottom-6 z-[70] sm:max-w-sm" role="status" aria-live="polite">
          <div
            className={`flex items-center gap-3 rounded-2xl px-5 py-4 shadow-[0_15px_45px_rgba(15,23,42,0.15)] border ${
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
            <p className={`flex-1 text-sm font-medium ${toast.type === "success" ? "text-[#4a5c4b]" : "text-[#a14e43]"}`}>
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className={`text-slate-400 hover:text-[#0f172a] text-lg leading-none rounded ${focusRing}`}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <section className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 pt-7 md:pt-10 pb-24 relative z-10">
        <button
          type="button"
          onClick={() => attemptToLeave("/library")}
          className={`group inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#0f172a] transition-colors mb-8 md:mb-10 rounded ${focusRing}`}
        >
          <span aria-hidden="true" className="text-lg transition-transform group-hover:-translate-x-1">←</span>
          <span>Back to My Library</span>
        </button>

        {/* ================= Hero ================= */}
        <div className="grid lg:grid-cols-[235px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)] gap-8 lg:gap-12 xl:gap-16 items-start">
          <div className="w-44 sm:w-52 lg:w-full mx-auto lg:mx-0">
            <div className="relative group">
              <div className="absolute -inset-4 bg-[#0f172a]/8 rounded-[2rem] blur-2xl opacity-60" />

              <div className="relative aspect-[2/3] rounded-[1.35rem] overflow-hidden shadow-[0_24px_55px_rgba(15,23,42,0.18)] bg-slate-200 ring-1 ring-[#0f172a]/10">
                <CoverImage sources={coverSources} title={book.title} author={book.author} />

                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-[#0f172a]/70 to-transparent lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={openCoverModal}
                    className="w-full inline-flex items-center justify-center gap-2 bg-[#fdfaf3]/95 text-[#0f172a] text-xs font-semibold py-2.5 rounded-full hover:bg-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c]"
                  >
                    <CameraIcon />
                    {hasCustomCover ? "Change cover photo" : "Add cover photo"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:pt-2 min-w-0">
            {/* ---------- Status picker ---------- */}
            <div>
              <p id="status-label" className="text-xs text-slate-400 mb-2">
                Reading status
              </p>
              <div
                role="radiogroup"
                aria-labelledby="status-label"
                className="inline-flex flex-wrap gap-1 p-1 rounded-2xl sm:rounded-full bg-white/70 border border-[#0f172a]/8 shadow-sm"
              >
                {STATUS_OPTIONS.map((option, index) => {
                  const checked = book.status === option.value;
                  const pending = savingStatus === option.value;
                  // Roving tabindex: only the selected option (or the first) is tabbable
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
                      className={`h-9 px-3.5 rounded-full text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-all disabled:opacity-60 ${focusRing} ${
                        checked ? `${option.active} shadow-sm` : "text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5"
                      }`}
                    >
                      {pending ? (
                        <Spinner dark={option.value === "want_to_read" || option.value === "did_not_finish"} />
                      ) : (
                        <span
                          aria-hidden="true"
                          className={`w-1.5 h-1.5 rounded-full ${checked ? "bg-current opacity-70" : option.dot}`}
                        />
                      )}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <h1 className="mt-6 text-[2.6rem] sm:text-5xl md:text-6xl xl:text-[4.2rem] font-classical font-semibold leading-[1.03] max-w-4xl break-words">
              {book.title}
            </h1>

            {book.author && (
              <p className="text-lg sm:text-xl text-slate-500 mt-4 font-light">
                by <span className="text-slate-700">{book.author}</span>
              </p>
            )}

            {/* At-a-glance: notes, progress, rating */}
            <dl className="mt-7 grid grid-cols-3 max-w-lg rounded-2xl border border-[#0f172a]/8 bg-white/60 divide-x divide-[#0f172a]/8">
              <div className="px-4 py-3.5">
                <dt className="text-xs text-slate-400">Notes</dt>
                <dd className="font-classical text-2xl mt-0.5">{journalEntries.length}</dd>
              </div>
              <div className="px-4 py-3.5">
                <dt className="text-xs text-slate-400">{isDnf ? "Stopped at page" : "Furthest page"}</dt>
                <dd className="font-classical text-2xl mt-0.5">{furthestPage ?? "—"}</dd>
              </div>
              <div className="px-4 py-3.5">
                <dt className="text-xs text-slate-400">Your rating</dt>
                <dd className="mt-1.5 flex items-center gap-0.5" aria-label={review?.rating ? `${review.rating} out of 5` : "Not rated"}>
                  {review?.rating ? (
                    [1, 2, 3, 4, 5].map((star) => (
                      <span key={star} aria-hidden="true" className={star <= (review.rating || 0) ? "text-[#c5a24a]" : "text-slate-200"}>
                        ★
                      </span>
                    ))
                  ) : (
                    <span className="font-classical text-2xl leading-none">—</span>
                  )}
                </dd>
              </div>
            </dl>

            {showReviewNudge && (
              <p className="mt-5 text-sm text-slate-600">
                {isDnf ? "Want to note why it wasn't for you?" : "You've finished it. How was it?"}{" "}
                <button
                  type="button"
                  onClick={goToReview}
                  className={`font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
                >
                  Write your review
                </button>
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mt-7">
              <button
                type="button"
                onClick={goToComposer}
                className={`inline-flex items-center justify-center gap-2.5 bg-[#7a947c] text-white px-6 py-3.5 rounded-full text-sm font-medium hover:bg-[#6b826c] transition-all shadow-[0_8px_20px_rgba(122,148,124,0.25)] ${focusRing}`}
              >
                <span aria-hidden="true">✎</span>
                Add a note
              </button>

              <button
                type="button"
                onClick={goToReview}
                className={`inline-flex items-center justify-center gap-2.5 bg-white/70 text-slate-700 border border-[#0f172a]/10 px-6 py-3.5 rounded-full text-sm font-medium hover:bg-white hover:text-[#0f172a] transition-all ${focusRing}`}
              >
                <span aria-hidden="true" className="text-[#c5a24a]">★</span>
                {review ? "Edit your review" : "Write your review"}
              </button>
            </div>
          </div>
        </div>

        {/* ================= Tabs ================= */}
        <div className="mt-14 md:mt-16 mb-8 border-b border-[#0f172a]/8">
          <div role="tablist" aria-label="Journal and review" className="flex gap-6 sm:gap-8">
            {(
              [
                { id: "journal", label: "Reading journal", badge: journalEntries.length ? String(journalEntries.length) : null, dirty: journalHasDraft || editingId !== null },
                { id: "review", label: "Final review", badge: review ? "✓" : null, dirty: reviewHasChanges },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative -mb-px pb-3.5 pt-1 inline-flex items-center gap-2 font-classical text-xl sm:text-2xl transition-colors rounded-t ${focusRing} ${
                    active ? "text-[#0f172a]" : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {tab.label}
                  {tab.badge && (
                    <span
                      className={`font-sans text-[11px] min-w-5 h-5 px-1.5 rounded-full inline-flex items-center justify-center ${
                        active ? "bg-[#0f172a] text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                  {tab.dirty && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#c69a3d]" aria-label="Unsaved changes" />
                  )}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 right-0 bottom-0 h-0.5 rounded-full bg-[#7a947c] transition-transform origin-left ${
                      active ? "scale-x-100" : "scale-x-0"
                    }`}
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
            className="grid lg:grid-cols-[360px_minmax(0,1fr)] gap-8 lg:gap-10 items-start scroll-mt-28"
          >
            {/* Composer */}
            <form
              id="journal-composer"
              onSubmit={saveJournalEntry}
              className="lg:sticky lg:top-24 scroll-mt-28 soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)] p-5 sm:p-6"
              noValidate
            >
              <h2 className="font-classical text-2xl font-semibold">New note</h2>
              <p className="text-sm text-slate-500 mt-1 font-light">Jot down a moment, a quote or a theory.</p>

              {/* Where in the book */}
              <div className="mt-5 grid grid-cols-[1fr_1fr] gap-3">
                <div>
                  <label htmlFor="journal-chapter" className="block text-xs font-medium text-slate-500 mb-1.5">
                    Chapter
                  </label>
                  <input
                    id="journal-chapter"
                    type="text"
                    inputMode="text"
                    maxLength={100}
                    value={journalChapter}
                    onChange={(e) => setJournalChapter(e.target.value)}
                    placeholder="12 or Prologue"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label htmlFor="journal-page" className="block text-xs font-medium text-slate-500 mb-1.5">
                    Page
                  </label>
                  <input
                    id="journal-page"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100000}
                    value={journalPage}
                    onChange={(e) => setJournalPage(e.target.value)}
                    placeholder="143"
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor="journal" className="sr-only">
                  Your note
                </label>
                <textarea
                  id="journal"
                  ref={journalTextRef}
                  value={journalText}
                  onChange={(e) => setJournalText(e.target.value)}
                  onKeyDown={(e) => onSaveShortcut(e, () => saveJournalEntry())}
                  placeholder="What's on your mind at this point in the book?"
                  rows={8}
                  className="journal-paper w-full px-4 border border-[#0f172a]/10 rounded-xl resize-y min-h-[200px] text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <label htmlFor="journal-date" className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Date</span>
                  <input
                    id="journal-date"
                    type="date"
                    value={journalDate}
                    max={todayLocal()}
                    onChange={(e) => setJournalDate(e.target.value)}
                    className="h-8 px-2 bg-white border border-[#0f172a]/10 rounded-lg text-xs text-slate-600 focus:outline-none focus:border-[#7a947c]"
                  />
                </label>
                <span className="text-[11px] text-slate-400 hidden sm:inline">{saveShortcut} to save</span>
              </div>

              {journalError && (
                <p role="alert" className="mt-3 text-sm text-[#a14e43]">
                  {journalError}
                </p>
              )}

              <button
                type="submit"
                disabled={savingJournal || !journalText.trim()}
                className={`w-full mt-4 bg-[#7a947c] text-white h-12 rounded-full font-semibold text-sm hover:bg-[#6b826c] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_8px_20px_rgba(122,148,124,0.2)] inline-flex items-center justify-center gap-2 ${focusRing}`}
              >
                {savingJournal && <Spinner />}
                {savingJournal ? "Saving…" : composerLocation ? `Save note at ${composerLocation}` : "Save note"}
              </button>

              <p className="text-[11px] text-slate-400 mt-3 text-center">Private to you. Chapter and page carry over to your next note.</p>
            </form>

            {/* Entries */}
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-4 mb-5">
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
                        className={`h-8 px-3.5 rounded-full font-medium transition-all ${focusRing} ${
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
                <div className="soft-surface border border-dashed border-[#0f172a]/12 rounded-[1.6rem] p-10 sm:p-14 text-center">
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
                <ol className="relative space-y-5">
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
                            // ---------- Edit mode ----------
                            <div className="p-5 sm:p-6">
                              <div className="grid grid-cols-3 gap-3">
                                <div>
                                  <label htmlFor={`edit-chapter-${entry.id}`} className="block text-xs text-slate-500 mb-1.5">Chapter</label>
                                  <input id={`edit-chapter-${entry.id}`} type="text" maxLength={100} value={editChapter} onChange={(e) => setEditChapter(e.target.value)} className={fieldClass} />
                                </div>
                                <div>
                                  <label htmlFor={`edit-page-${entry.id}`} className="block text-xs text-slate-500 mb-1.5">Page</label>
                                  <input id={`edit-page-${entry.id}`} type="number" inputMode="numeric" min={1} max={100000} value={editPage} onChange={(e) => setEditPage(e.target.value)} className={fieldClass} />
                                </div>
                                <div>
                                  <label htmlFor={`edit-date-${entry.id}`} className="block text-xs text-slate-500 mb-1.5">Date</label>
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
                                className="journal-paper mt-3 w-full px-4 border border-[#0f172a]/10 rounded-xl resize-y text-[15px] text-slate-700 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                              />

                              {editError && (
                                <p role="alert" className="mt-2 text-sm text-[#a14e43]">
                                  {editError}
                                </p>
                              )}

                              <div className="mt-3 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  disabled={savingEdit}
                                  className={`h-10 px-4 rounded-full text-sm text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={saveEdit}
                                  disabled={savingEdit}
                                  className={`h-10 px-5 rounded-full bg-[#0f172a] text-[#fdfaf3] text-sm font-medium hover:bg-[#7a947c] disabled:opacity-50 transition-colors inline-flex items-center gap-2 ${focusRing}`}
                                >
                                  {savingEdit && <Spinner />}
                                  Save changes
                                </button>
                              </div>
                            </div>
                          ) : (
                            // ---------- Read mode ----------
                            <div className="p-5 sm:p-6">
                              <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                {location && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                                    {location}
                                  </span>
                                )}
                                <time dateTime={entry.entry_date} className="text-xs text-slate-400" title={formatEntryDate(entry.entry_date, "long")}>
                                  {formatEntryDate(entry.entry_date, "short")}
                                </time>

                                <div className="ml-auto flex items-center gap-1">
                                  {confirmingDelete ? (
                                    <>
                                      <span className="text-xs text-slate-500 mr-1">Delete this note?</span>
                                      <button
                                        type="button"
                                        onClick={() => deleteJournalEntry(entry.id)}
                                        className={`text-xs font-medium text-white bg-[#c0675b] hover:bg-[#a14e43] px-3 py-1.5 rounded-lg transition-colors ${focusRing}`}
                                      >
                                        Delete
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        className={`text-xs text-slate-500 hover:text-[#0f172a] px-2.5 py-1.5 rounded-lg hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
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
                                        className={`text-xs text-slate-400 hover:text-[#0f172a] px-2.5 py-1.5 rounded-lg hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
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
                                        className={`text-xs text-slate-400 hover:text-[#a34d43] px-2.5 py-1.5 rounded-lg hover:bg-[#f7e9e6] transition-colors ${focusRing}`}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </header>

                              <p className="mt-3.5 text-slate-700 leading-8 whitespace-pre-wrap text-[15px] font-light">{entry.content}</p>
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
          <div id="panel-review" role="tabpanel" aria-labelledby="tab-review" className="max-w-3xl scroll-mt-28">
            <div className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_10px_35px_rgba(15,23,42,0.05)] overflow-hidden">
              {/* Rating */}
              <fieldset className="p-6 sm:p-8 border-b border-[#0f172a]/6">
                <legend className="sr-only">Your rating</legend>
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                  <div className="flex items-center gap-1" onMouseLeave={() => setHoveredRating(0)}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star === rating ? 0 : star)}
                        onMouseEnter={() => setHoveredRating(star)}
                        onFocus={() => setHoveredRating(star)}
                        onBlur={() => setHoveredRating(0)}
                        aria-label={`${star} out of 5${RATING_LABEL[star] ? `: ${RATING_LABEL[star]}` : ""}`}
                        aria-pressed={rating === star}
                        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-3xl transition-all ${focusRing} ${
                          star <= displayRating ? "text-[#c5a24a] scale-105" : "text-slate-200 hover:text-[#c5a24a]/60"
                        }`}
                      >
                        <span aria-hidden="true">★</span>
                      </button>
                    ))}
                  </div>

                  <p className="text-sm" aria-live="polite">
                    {displayRating > 0 ? (
                      <>
                        <span className="font-semibold text-slate-700">{RATING_LABEL[displayRating]}</span>
                        <span className="text-slate-400"> · {displayRating}/5</span>
                      </>
                    ) : (
                      <span className="text-slate-400">Tap a star to rate this book</span>
                    )}
                  </p>
                </div>
              </fieldset>

              {/* Review text */}
              <div className="p-6 sm:p-8">
                <label htmlFor="review" className="sr-only">
                  Your review
                </label>
                <textarea
                  id="review"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  onKeyDown={(e) => onSaveShortcut(e, saveReview)}
                  placeholder={
                    isDnf
                      ? "Why did you put it down? What didn't work for you, and was there anything you liked?"
                      : "What stayed with you? The characters, the writing, the ending, a line you keep thinking about…"
                  }
                  rows={12}
                  className="journal-paper journal-paper--lg w-full px-5 border border-[#0f172a]/10 rounded-2xl resize-y min-h-[300px] text-[15px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                />

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {review?.updated_at
                      ? `Last saved ${new Date(review.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                      : "Private to you"}
                  </span>
                  <span>{reviewText.trim() ? `${reviewText.trim().split(/\s+/).length} words` : ""}</span>
                </div>

                {journalEntries.length > 0 && !reviewText.trim() && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("journal")}
                    className={`mt-4 text-sm text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
                  >
                    Look back at your {journalEntries.length} {journalEntries.length === 1 ? "note" : "notes"} first
                  </button>
                )}

                {reviewError && (
                  <p role="alert" className="mt-4 text-sm text-[#a14e43]">
                    {reviewError}
                  </p>
                )}
              </div>

              {/* Save bar */}
              <div className="sticky bottom-0 px-6 sm:px-8 py-4 bg-[#fdfaf3]/95 backdrop-blur border-t border-[#0f172a]/6 flex flex-col-reverse sm:flex-row sm:items-center gap-3">
                <p className="text-xs flex-1" aria-live="polite">
                  {reviewHasChanges ? (
                    <span className="inline-flex items-center gap-1.5 text-[#a47a25]">
                      <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#c69a3d]" />
                      Unsaved changes
                      <span className="hidden sm:inline text-slate-400">· {saveShortcut} to save</span>
                    </span>
                  ) : review ? (
                    <span className="text-slate-400">All changes saved</span>
                  ) : null}
                </p>

                {reviewHasChanges && (initialRating > 0 || initialReviewText) && (
                  <button
                    type="button"
                    onClick={discardReviewChanges}
                    className={`h-11 px-5 rounded-full text-sm text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
                  >
                    Discard changes
                  </button>
                )}

                <button
                  type="button"
                  onClick={saveReview}
                  disabled={savingReview || !reviewHasChanges}
                  className={`h-11 px-7 rounded-full bg-[#0f172a] text-[#fdfaf3] font-semibold text-sm hover:bg-[#7a947c] disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2 ${focusRing}`}
                >
                  {savingReview && <Spinner />}
                  {savingReview ? "Saving…" : review ? "Update review" : "Save review"}
                </button>
              </div>
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
            className="w-full sm:max-w-lg max-h-[94vh] overflow-y-auto bg-[#fdfaf3] border border-[#0f172a]/10 rounded-t-[1.6rem] sm:rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] animate-sheet-in"
          >
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="cover-modal-title" className="text-3xl font-classical font-semibold">
                    {hasCustomCover ? "Change cover photo" : "Add a cover photo"}
                  </h2>
                  <p className="text-sm text-slate-500 mt-2 leading-6 font-light">
                    {book.cover_url
                      ? "Your photo is kept as a backup and shows whenever the catalogue cover can't load."
                      : "Photograph your copy so it stands out on your shelf."}
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

              <div className="mt-7 flex gap-5 items-start">
                <div className="w-28 sm:w-32 shrink-0">
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-md bg-[#e9e4d9] ring-1 ring-[#0f172a]/10">
                    <CoverImage sources={modalPreviewSources} title={book.title} author={book.author} />
                    {coverPreview && (
                      <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-[#7a947c] text-white shadow">New</span>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <input
                    ref={coverInputRef}
                    id="cover-file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => handleCoverFile(event.target.files?.[0])}
                  />

                  <label
                    htmlFor="cover-file"
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOver(false);
                      handleCoverFile(event.dataTransfer.files?.[0]);
                    }}
                    className={`flex flex-col items-center justify-center gap-2 text-center min-h-[140px] p-4 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                      dragOver ? "border-[#7a947c] bg-[#7a947c]/10" : "border-[#0f172a]/15 bg-white hover:border-[#7a947c] hover:bg-[#7a947c]/5"
                    }`}
                  >
                    <span className="w-10 h-10 rounded-full bg-[#7a947c]/15 text-[#7a947c] flex items-center justify-center" aria-hidden="true">
                      <CameraIcon size={18} />
                    </span>
                    <span className="text-sm font-medium">{coverFile ? "Choose a different image" : "Take a photo or choose an image"}</span>
                    <span className="text-xs text-slate-400">JPG, PNG or WebP, up to 5 MB</span>
                  </label>

                  {coverFile && (
                    <p className="mt-2 text-xs text-slate-500 truncate">
                      {coverFile.name} · {(coverFile.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
                </div>
              </div>

              {coverError && (
                <div role="alert" className="mt-5 px-4 py-3 rounded-xl bg-[#f8e9e5]/90 border border-[#e8cbc4] text-[#a14e43] text-sm">
                  {coverError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3 mt-8">
                {hasCustomCover && !coverFile && (
                  <button
                    type="button"
                    onClick={removeCustomCover}
                    disabled={savingCover}
                    className={`sm:mr-auto text-sm text-slate-400 hover:text-[#a34d43] px-3 py-2 rounded-lg hover:bg-[#f7e9e6] transition-all disabled:opacity-40 ${focusRing}`}
                  >
                    Remove my photo
                  </button>
                )}

                <button
                  type="button"
                  onClick={closeCoverModal}
                  disabled={savingCover}
                  className={`${hasCustomCover && !coverFile ? "" : "sm:ml-auto"} border border-[#0f172a]/12 bg-white/70 text-slate-600 px-6 py-3 rounded-full hover:border-[#0f172a]/30 hover:text-[#0f172a] transition-all text-sm font-semibold disabled:opacity-40 ${focusRing}`}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveCustomCover}
                  disabled={!coverFile || savingCover}
                  className={`bg-[#7a947c] text-white px-7 py-3 rounded-full hover:bg-[#6b826c] transition-all text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${focusRing}`}
                >
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
          className="fixed inset-0 z-[60] bg-[#0f172a]/55 backdrop-blur-sm flex items-center justify-center px-5"
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
            className="w-full max-w-md bg-[#fdfaf3] border border-[#0f172a]/10 rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] p-7 sm:p-8"
          >
            <h2 id="leave-title" className="text-3xl font-classical font-semibold">
              Leave without saving?
            </h2>

            <p className="text-slate-600 mt-4 leading-7 text-sm font-light">
              {[
                journalHasDraft && "an unsaved note",
                editingId !== null && "a note you're editing",
                reviewHasChanges && "review changes",
              ]
                .filter(Boolean)
                .join(", ")
                .replace(/^./, (c) => c.toUpperCase())}{" "}
              will be lost if you leave now.
            </p>

            <div className="flex flex-col-reverse sm:flex-row gap-3 mt-8">
              <button
                type="button"
                onClick={() => {
                  setShowLeaveModal(false);
                  setPendingDestination(null);
                }}
                className={`flex-1 border border-[#0f172a]/12 bg-white/70 text-slate-600 py-3.5 rounded-full hover:border-[#0f172a]/30 hover:text-[#0f172a] transition-all text-sm font-semibold ${focusRing}`}
              >
                Keep editing
              </button>

              <button
                type="button"
                onClick={discardAndLeave}
                className={`flex-1 bg-[#0f172a] text-[#fdfaf3] py-3.5 rounded-full hover:bg-[#1e293b] transition-all text-sm font-semibold ${focusRing}`}
              >
                Discard and leave
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}