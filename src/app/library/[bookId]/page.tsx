"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Navbar from "../../components/Navbar";
import { supabase } from "../../../lib/supabase";

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
  created_at: string;
  updated_at: string;
}

type Tab = "journal" | "review";

type Toast = {
  type: "success" | "error";
  message: string;
} | null;

// --------------------------------------------------
// Cover storage config (keep in sync with the library page)
// --------------------------------------------------

const COVER_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
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

// --------------------------------------------------
// Shared helpers (module scope: created once, not per render)
// --------------------------------------------------

const DATE_FORMATS: Record<
  "long" | "short" | "month" | "day",
  Intl.DateTimeFormatOptions
> = {
  long: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  short: { month: "short", day: "numeric" },
  month: { month: "short" },
  day: { day: "numeric" },
};

function formatEntryDate(
  date: string,
  style: "long" | "short" | "month" | "day" = "long"
) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(
    "en-US",
    DATE_FORMATS[style]
  );
}

function sortJournalEntries(entries: JournalEntry[]) {
  return [...entries].sort((a, b) => {
    const dateDiff =
      new Date(`${b.entry_date}T00:00:00`).getTime() -
      new Date(`${a.entry_date}T00:00:00`).getTime();

    if (dateDiff !== 0) return dateDiff;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

const STATUS_LABEL: Record<string, string> = {
  reading: "Currently Reading",
  finished: "Finished",
  want_to_read: "Want to Read",
};

const STATUS_DESCRIPTION: Record<string, string> = {
  reading: "You're currently reading this book.",
  finished: "You've finished reading this book.",
  want_to_read: "This book is waiting on your shelf.",
};

const RATING_LABEL: Record<number, string> = {
  1: "It wasn't for me",
  2: "It was okay",
  3: "I liked it",
  4: "I really liked it",
  5: "A new favourite",
};

// --------------------------------------------------
// Cover image: tries each source in order, then shows the placeholder
// --------------------------------------------------

function CoverImage({
  sources,
  title,
  author,
}: {
  sources: string[];
  title: string;
  author: string | null;
}) {
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

export default function BookReviewPage() {
  const router = useRouter();
  const params = useParams();
  const bookId = params.bookId as string;

  // --------------------------------------------------
  // Authentication + book data
  // --------------------------------------------------

  const [userId, setUserId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // --------------------------------------------------
  // Custom cover
  // --------------------------------------------------

  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverFileType, setCoverFileType] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState("");
  const [savingCover, setSavingCover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // --------------------------------------------------
  // Tabs
  // --------------------------------------------------

  const [activeTab, setActiveTab] = useState<Tab>("journal");

  // --------------------------------------------------
  // Review
  // --------------------------------------------------

  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [initialRating, setInitialRating] = useState(0);
  const [initialReviewText, setInitialReviewText] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  // --------------------------------------------------
  // Journal
  // --------------------------------------------------

  const [journalDate, setJournalDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [journalText, setJournalText] = useState("");
  const [savingJournal, setSavingJournal] = useState(false);

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [pendingDestination, setPendingDestination] = useState<string | null>(
    null
  );
  const [toast, setToast] = useState<Toast>(null);
  const [hoveredRating, setHoveredRating] = useState(0);

  // --------------------------------------------------
  // Signed URL for the private custom cover
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Load page. Book, review and journal entries are fetched in parallel.
  // --------------------------------------------------

  useEffect(() => {
    if (!bookId) return;
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  async function loadPage() {
    setLoading(true);
    setError("");

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
          .select("*")
          .eq("book_id", bookId)
          .eq("user_id", currentUserId)
          .maybeSingle(),
        supabase
          .from("book_journal_entries")
          .select("*")
          .eq("book_id", bookId)
          .eq("user_id", currentUserId)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false }),
      ]);

      if (bookResult.error || !bookResult.data) {
        console.error("Error loading book:", bookResult.error);
        setError("We couldn't find this book in your library.");
        return;
      }

      const loadedBook = bookResult.data as Book;
      setBook(loadedBook);
      await signCustomCover(loadedBook.custom_cover_path);

      if (reviewResult.error) {
        console.error("Error loading review:", reviewResult.error);
      }

      const savedReview = reviewResult.data;
      setReview(savedReview);
      setRating(savedReview?.rating || 0);
      setReviewText(savedReview?.review_text || "");
      setInitialRating(savedReview?.rating || 0);
      setInitialReviewText(savedReview?.review_text || "");

      if (journalResult.error) {
        console.error("Error loading journal:", journalResult.error);
      }

      setJournalEntries(journalResult.data || []);
    } catch (err) {
      console.error("Unexpected error:", err);
      setError("Something went wrong while loading this page.");
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // Cover sources: catalogue URL first, custom cover as fallback
  // --------------------------------------------------

  const coverSources = useMemo(() => {
    const sources: string[] = [];
    if (book?.cover_url) sources.push(book.cover_url);
    if (customCoverUrl) sources.push(customCoverUrl);
    return sources;
  }, [book?.cover_url, customCoverUrl]);

  // --------------------------------------------------
  // Unsaved review changes
  // --------------------------------------------------

  const reviewHasChanges = useMemo(() => {
    return rating !== initialRating || reviewText !== initialReviewText;
  }, [rating, initialRating, reviewText, initialReviewText]);

  // --------------------------------------------------
  // Browser close / refresh warning
  // --------------------------------------------------

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!reviewHasChanges) return;

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [reviewHasChanges]);

  // --------------------------------------------------
  // Toast
  // --------------------------------------------------

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
  }, []);

  // --------------------------------------------------
  // Cover modal: preview cleanup, Escape, scroll lock
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Cover selection
  // --------------------------------------------------

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

  // --------------------------------------------------
  // Save custom cover: upload new → update row → remove old file
  // --------------------------------------------------

  async function saveCustomCover() {
    if (!book || !userId || !coverFile || !coverFileType) return;

    setSavingCover(true);
    setCoverError("");

    const previousPath = book.custom_cover_path;
    const newPath = `${userId}/${crypto.randomUUID()}.${ALLOWED_COVER_TYPES[coverFileType]}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(COVER_BUCKET)
        .upload(newPath, coverFile, {
          contentType: coverFileType,
          cacheControl: "3600",
          upsert: false,
        });

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

      // Clean up the file being replaced
      if (previousPath && previousPath !== newPath) {
        const { error: removeError } = await supabase.storage
          .from(COVER_BUCKET)
          .remove([previousPath]);
        if (removeError) console.error("Old cover cleanup failed:", removeError.message);
      }

      setBook(data as Book);
      await signCustomCover(newPath);

      resetCoverSelection();
      setShowCoverModal(false);
      showToast(
        "success",
        book.cover_url
          ? "Cover photo saved. It shows if the catalogue cover is unavailable."
          : "Cover photo saved."
      );
    } catch (err) {
      console.error("Unexpected cover save error:", err);
      await supabase.storage.from(COVER_BUCKET).remove([newPath]);
      setCoverError("The cover couldn't be saved. Try again.");
    } finally {
      setSavingCover(false);
    }
  }

  // --------------------------------------------------
  // Remove custom cover
  // --------------------------------------------------

  async function removeCustomCover() {
    if (!book || !userId || !book.custom_cover_path) return;

    const confirmed = window.confirm("Remove your cover photo from this book?");
    if (!confirmed) return;

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

      const { error: removeError } = await supabase.storage
        .from(COVER_BUCKET)
        .remove([pathToRemove]);
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

  // --------------------------------------------------
  // Navigation
  // --------------------------------------------------

  const attemptToLeave = useCallback(
    (destination: string) => {
      if (reviewHasChanges) {
        setPendingDestination(destination);
        setShowLeaveModal(true);
        return;
      }

      router.push(destination);
    },
    [reviewHasChanges, router]
  );

  function discardAndLeave() {
    const destination = pendingDestination || "/library";

    setShowLeaveModal(false);
    setPendingDestination(null);

    router.push(destination);
  }

  // --------------------------------------------------
  // Save review
  // --------------------------------------------------

  async function saveReview() {
    if (!userId || !book) return;

    if (rating === 0) {
      setError("Please select a rating before saving your review.");
      return;
    }

    if (!reviewText.trim()) {
      setError("Please write something before saving your review.");
      return;
    }

    setSavingReview(true);
    setError("");

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
        console.error("Error saving review:", saveError);
        setError("Your review couldn't be saved. Try again.");
        return;
      }

      setReview(data);
      setReviewText(cleanReview);
      setInitialRating(rating);
      setInitialReviewText(cleanReview);

      showToast(
        "success",
        review ? "Your review has been updated." : "Your review has been saved."
      );
    } catch (err) {
      console.error("Unexpected review save error:", err);
      setError("Something went wrong while saving your review.");
    } finally {
      setSavingReview(false);
    }
  }

  // --------------------------------------------------
  // Save journal entry
  // --------------------------------------------------

  async function saveJournalEntry() {
    if (!userId || !book) return;

    if (!journalText.trim()) {
      setError("Write something before saving your entry.");
      return;
    }

    if (!journalDate) {
      setError("Please select a date.");
      return;
    }

    setSavingJournal(true);
    setError("");

    try {
      const { data, error: journalError } = await supabase
        .from("book_journal_entries")
        .insert({
          user_id: userId,
          book_id: book.id,
          entry_date: journalDate,
          content: journalText.trim(),
        })
        .select()
        .single();

      if (journalError) {
        console.error("Error saving journal entry:", journalError);
        setError("Your journal entry couldn't be saved. Try again.");
        return;
      }

      setJournalEntries((current) => sortJournalEntries([data, ...current]));
      setJournalText("");

      showToast("success", "Your journal entry has been saved.");
    } catch (err) {
      console.error("Unexpected journal save error:", err);
      setError("Something went wrong while saving your journal entry.");
    } finally {
      setSavingJournal(false);
    }
  }

  // --------------------------------------------------
  // Delete journal entry
  // --------------------------------------------------

  async function deleteJournalEntry(id: string) {
    if (!userId) return;

    const confirmed = window.confirm(
      "Are you sure you want to delete this journal entry?"
    );

    if (!confirmed) return;

    const previous = journalEntries;
    setJournalEntries((current) => current.filter((entry) => entry.id !== id));

    const { error: deleteError } = await supabase
      .from("book_journal_entries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Error deleting journal entry:", deleteError);
      setJournalEntries(previous);
      setError("Could not delete the journal entry.");
      return;
    }

    showToast("success", "Journal entry deleted.");
  }

  const displayRating = hoveredRating || rating;

  // --------------------------------------------------
  // Loading
  // --------------------------------------------------

  if (loading) {
    return (
      <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a]">
        <Navbar isLoggedIn={!!userId} />

        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
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

  // --------------------------------------------------
  // Book not found
  // --------------------------------------------------

  if (!book) {
    return (
      <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a]">
        <Navbar isLoggedIn={!!userId} />

        <section className="max-w-4xl mx-auto px-5 sm:px-8 py-24 text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-7">
            <span className="font-classical text-3xl text-[#9a86b9]">A</span>
          </div>

          <h1 className="text-4xl md:text-5xl font-classical font-semibold text-[#0f172a] mt-3">
            Book not found
          </h1>

          <p className="text-slate-600 mt-4 max-w-md mx-auto leading-7 font-light">
            {error || "We couldn't find this book in your library."}
          </p>

          <button
            type="button"
            onClick={() => router.push("/library")}
            className="mt-8 bg-[#0f172a] text-[#fdfaf3] px-7 py-3.5 rounded-full hover:bg-[#1e293b] transition-all"
          >
            Back to My Library
          </button>
        </section>
      </main>
    );
  }

  const hasCustomCover = !!book.custom_cover_path;
  const modalPreviewSources = coverPreview
    ? [coverPreview]
    : customCoverUrl
    ? [customCoverUrl]
    : [];

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a]">
      {/* ==================================================
          PAGE ATMOSPHERE
      ================================================== */}

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
              background-color: #fefcf6;
              background-image: linear-gradient(to bottom, rgba(15, 23, 42, 0.035) 1px, transparent 1px);
              background-size: 100% 32px;
            }

            .soft-surface { background: rgba(255, 255, 255, 0.6); backdrop-filter: blur(12px); }
            .soft-border { border-color: rgba(15, 23, 42, 0.08); }

            @keyframes sheet-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .animate-sheet-in { animation: sheet-in 300ms cubic-bezier(.2,.8,.2,1) both; }
            @media (prefers-reduced-motion: reduce) { .animate-sheet-in { animation: none; } }
          `,
        }}
      />

      <Navbar isLoggedIn={!!userId} />

      {/* ==================================================
          TOAST
      ================================================== */}

      {toast && (
        <div className="fixed top-24 right-5 z-[70] w-[calc(100%-40px)] sm:w-auto sm:min-w-[320px] sm:max-w-sm" role="status">
          <div
            className={`flex items-start gap-3 rounded-2xl px-5 py-4 shadow-[0_15px_45px_rgba(15,23,42,0.12)] border backdrop-blur-xl ${
              toast.type === "success"
                ? "bg-white/95 border-[#7a947c]/25"
                : "bg-[#fbefed]/95 border-red-200/70"
            }`}
          >
            <div
              className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${
                toast.type === "success" ? "bg-[#7a947c] text-white" : "bg-red-500 text-white"
              }`}
            >
              {toast.type === "success" ? "✓" : "!"}
            </div>

            <p
              className={`flex-1 text-sm font-medium ${
                toast.type === "success" ? "text-[#4a5c4b]" : "text-red-700"
              }`}
            >
              {toast.message}
            </p>

            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-[#0f172a] text-lg leading-none"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ==================================================
          MAIN CONTENT
      ================================================== */}

      <section className="max-w-6xl mx-auto px-5 sm:px-8 lg:px-10 pt-7 md:pt-10 pb-24 relative z-10">
        <button
          type="button"
          onClick={() => attemptToLeave("/library")}
          className="group inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#0f172a] transition-colors mb-8 md:mb-10"
        >
          <span className="text-lg transition-transform group-hover:-translate-x-1">←</span>
          <span>Back to My Library</span>
        </button>

        {/* ==================================================
            BOOK HERO
        ================================================== */}

        <div className="grid lg:grid-cols-[235px_minmax(0,1fr)] xl:grid-cols-[270px_minmax(0,1fr)] gap-8 lg:gap-12 xl:gap-16 items-start">
          <div className="w-48 sm:w-56 lg:w-full mx-auto lg:mx-0">
            <div className="relative group">
              <div className="absolute -inset-4 bg-[#0f172a]/8 rounded-[2rem] blur-2xl opacity-60" />

              <div className="relative aspect-[2/3] rounded-[1.35rem] overflow-hidden shadow-[0_24px_55px_rgba(15,23,42,0.18)] bg-slate-200 ring-1 ring-[#0f172a]/10">
                <CoverImage sources={coverSources} title={book.title} author={book.author} />

                {/* Change cover control: always visible on touch, reveals on hover for desktop */}
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
            <div className="flex flex-wrap items-center gap-2.5 mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#f7f5fa] text-[#6c5c85] text-xs font-medium border border-[#9a86b9]/20">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9a86b9]" />
                {STATUS_LABEL[book.status ?? ""] ?? "Want to Read"}
              </span>

              <span className="text-xs text-slate-400">
                {journalEntries.length} {journalEntries.length === 1 ? "journal entry" : "journal entries"}
              </span>

              {review && (
                <>
                  <span className="w-1 h-1 rounded-full bg-slate-300" />
                  <span className="text-xs text-[#7a947c]">Review saved</span>
                </>
              )}
            </div>

            <h1 className="text-[2.7rem] sm:text-5xl md:text-6xl xl:text-[4.4rem] font-classical font-semibold text-[#0f172a] leading-[1.03] max-w-4xl break-words">
              {book.title}
            </h1>

            {book.author && (
              <p className="text-lg sm:text-xl text-slate-500 mt-5 font-light">
                by <span className="text-slate-700">{book.author}</span>
              </p>
            )}

            <p className="text-slate-600 mt-5 max-w-2xl leading-7 text-[15px] font-light">
              {STATUS_DESCRIPTION[book.status ?? ""] ?? "Part of your personal collection."}{" "}
              Keep your thoughts, favourite moments, theories and final impressions together in one place.
            </p>

            {review && review.rating && (
              <div className="mt-6 inline-flex flex-wrap items-center gap-3 bg-white/70 border border-[#0f172a]/8 rounded-2xl px-4 py-3">
                <div className="flex gap-0.5" aria-label={`Rated ${review.rating} out of 5`}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      className={`text-lg ${star <= (review.rating || 0) ? "text-[#c5a24a]" : "text-slate-200"}`}
                    >
                      ★
                    </span>
                  ))}
                </div>

                <span className="text-sm font-semibold text-slate-700">{review.rating}/5</span>
                <span className="w-px h-4 bg-slate-200" />

                <button
                  type="button"
                  onClick={() => setActiveTab("review")}
                  className="text-xs font-semibold text-[#7a947c] hover:text-[#0f172a] transition-colors"
                >
                  View review
                </button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 mt-7">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("journal");
                  setTimeout(() => {
                    document
                      .getElementById("journal-composer")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 50);
                }}
                className="inline-flex items-center justify-center gap-2.5 bg-[#7a947c] text-white px-6 py-3.5 rounded-full text-sm font-medium hover:bg-[#6b826c] transition-all shadow-[0_8px_20px_rgba(122,148,124,0.25)]"
              >
                <span className="text-base">✎</span>
                Write a journal entry
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab("review");
                  setTimeout(() => {
                    document
                      .getElementById("review-editor")
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }, 50);
                }}
                className="inline-flex items-center justify-center gap-2.5 bg-white/70 text-slate-700 border border-[#0f172a]/10 px-6 py-3.5 rounded-full text-sm font-medium hover:bg-white hover:text-[#0f172a] transition-all"
              >
                <span className="text-[#c5a24a]">★</span>
                {review ? "Edit your review" : "Write final review"}
              </button>
            </div>
          </div>
        </div>

        <div className="my-12 md:my-16 flex items-center gap-5">
          <div className="h-px flex-1 bg-[#0f172a]/8" />
          <div className="font-classical text-[#9a86b9] text-lg">✦</div>
          <div className="h-px flex-1 bg-[#0f172a]/8" />
        </div>

        {/* ==================================================
            WORKSPACE HEADER
        ================================================== */}

        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
            <div>
              <h2 className="text-3xl sm:text-4xl font-classical font-semibold text-[#0f172a]">
                {activeTab === "journal" ? "Reading Journal" : "Final Review"}
              </h2>

              <p className="text-sm text-slate-500 mt-2 max-w-xl font-light">
                {activeTab === "journal"
                  ? "Capture thoughts as they come to you while you read."
                  : "Bring everything you thought and felt about the book together."}
              </p>
            </div>

            <div className="inline-flex self-start sm:self-auto p-1.5 rounded-[1.15rem] bg-white/70 border border-[#0f172a]/8 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveTab("journal")}
                className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-[0.85rem] text-sm font-semibold transition-all ${
                  activeTab === "journal" ? "bg-[#0f172a] text-[#fdfaf3] shadow-md" : "text-slate-500 hover:text-[#0f172a]"
                }`}
              >
                <span>Journal</span>
                <span
                  className={`min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] ${
                    activeTab === "journal" ? "bg-white/10 text-white/70" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {journalEntries.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("review")}
                className={`flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-[0.85rem] text-sm font-semibold transition-all ${
                  activeTab === "review" ? "bg-[#0f172a] text-[#fdfaf3] shadow-md" : "text-slate-500 hover:text-[#0f172a]"
                }`}
              >
                <span>Review</span>
                {review && (
                  <span
                    className={`min-w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      activeTab === "review" ? "bg-[#7a947c] text-white" : "bg-[#eaf0ea] text-[#5c7a5e]"
                    }`}
                  >
                    ✓
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-8 flex items-start gap-3 px-5 py-4 rounded-2xl bg-[#f8e9e5]/90 border border-[#e8cbc4] text-[#a14e43] text-sm">
            <span className="w-6 h-6 rounded-full bg-[#efd5d0] flex items-center justify-center flex-shrink-0 font-semibold">
              !
            </span>
            <p className="leading-6 flex-1">{error}</p>
            <button
              type="button"
              onClick={() => setError("")}
              className="text-[#bb7c72] hover:text-[#8d3e35] text-lg leading-none"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* ==================================================
            JOURNAL
        ================================================== */}

        {activeTab === "journal" && (
          <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[365px_minmax(0,1fr)] gap-8 lg:gap-10 items-start">
            <div id="journal-composer" className="lg:sticky lg:top-24 scroll-mt-24">
              <div className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_15px_45px_rgba(15,23,42,0.06)] overflow-hidden">
                <div className="p-6 sm:p-7">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div>
                      <h2 className="text-2xl sm:text-[1.7rem] font-classical font-semibold text-[#0f172a]">
                        What are you thinking?
                      </h2>
                    </div>

                    <div className="w-10 h-10 rounded-full bg-[#f0f4f1] flex items-center justify-center flex-shrink-0">
                      <span className="text-lg text-[#7a947c]">✎</span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-500 leading-6 mb-7 font-light">
                    Capture the little things you don&apos;t want to forget while you&apos;re reading.
                  </p>

                  <label htmlFor="journal-date" className="block text-sm font-medium text-slate-600 mb-2.5">
                    Entry date
                  </label>

                  <input
                    id="journal-date"
                    type="date"
                    value={journalDate}
                    onChange={(event) => setJournalDate(event.target.value)}
                    className="w-full h-12 px-4 bg-white border border-[#0f172a]/10 rounded-xl text-sm text-slate-700 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                  />

                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2.5">
                      <label htmlFor="journal" className="text-sm font-medium text-slate-600">
                        Your thoughts
                      </label>
                      <span className="text-xs text-slate-400">{journalText.length}</span>
                    </div>

                    <textarea
                      id="journal"
                      value={journalText}
                      onChange={(event) => setJournalText(event.target.value)}
                      placeholder="A favourite moment, a theory, something that surprised you..."
                      rows={9}
                      className="journal-paper w-full px-4 py-4 border border-[#0f172a]/10 rounded-xl resize-none text-sm leading-8 text-slate-600 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={saveJournalEntry}
                    disabled={savingJournal || !journalText.trim()}
                    className="w-full mt-5 bg-[#7a947c] text-white py-3.5 rounded-full font-semibold text-sm hover:bg-[#6b826c] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_8px_20px_rgba(122,148,124,0.2)]"
                  >
                    {savingJournal ? "Saving entry..." : "Save Journal Entry"}
                  </button>
                </div>

                <div className="px-6 sm:px-7 py-4 bg-[#f7f5fa]/70 border-t border-[#0f172a]/6">
                  <p className="text-xs text-slate-400 leading-5">
                    Your journal is private to your account and tied to this book.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-end justify-between gap-5 mb-6">
                <h2 className="text-3xl sm:text-4xl font-classical font-semibold text-[#0f172a]">
                  Your entries
                </h2>
                <span className="text-xs text-slate-400 pb-1">
                  {journalEntries.length} {journalEntries.length === 1 ? "entry" : "entries"}
                </span>
              </div>

              {journalEntries.length === 0 ? (
                <div className="soft-surface border border-dashed border-[#0f172a]/12 rounded-[1.6rem] p-10 sm:p-14 text-center">
                  <div className="w-16 h-16 mx-auto rounded-full bg-[#f7f5fa] flex items-center justify-center mb-5">
                    <span className="font-classical text-2xl text-[#9a86b9]">A</span>
                  </div>

                  <h3 className="font-classical text-2xl font-semibold text-[#0f172a]">
                    Your story starts here.
                  </h3>

                  <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto leading-6 font-light">
                    Your reading thoughts will appear here as you add them.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      document.getElementById("journal")?.scrollIntoView({ behavior: "smooth", block: "center" })
                    }
                    className="mt-6 text-sm font-semibold text-[#7a947c] hover:text-[#0f172a] transition-colors"
                  >
                    Start writing →
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="absolute left-[18px] top-5 bottom-5 w-px bg-[#0f172a]/10 hidden sm:block" />

                  <div className="space-y-7">
                    {journalEntries.map((entry) => (
                      <article key={entry.id} className="relative sm:pl-12">
                        <div className="hidden sm:flex absolute left-0 top-5 w-9 h-9 rounded-full bg-[#fdfaf3] border border-[#0f172a]/10 items-center justify-center z-10">
                          <div className="w-2.5 h-2.5 rounded-full bg-[#7a947c]" />
                        </div>

                        <div className="soft-surface border soft-border rounded-[1.5rem] shadow-[0_8px_30px_rgba(15,23,42,0.04)] hover:shadow-[0_12px_35px_rgba(15,23,42,0.07)] transition-shadow overflow-hidden">
                          <div className="px-6 sm:px-7 pt-6 pb-4 flex items-start justify-between gap-5">
                            <div className="flex items-center gap-3">
                              <div className="sm:hidden w-10 h-10 rounded-xl bg-[#f7f5fa] flex flex-col items-center justify-center flex-shrink-0">
                                <span className="text-[9px] uppercase tracking-wider text-[#9a86b9] font-bold">
                                  {formatEntryDate(entry.entry_date, "month")}
                                </span>
                                <span className="text-sm font-classical text-[#0f172a] leading-none">
                                  {formatEntryDate(entry.entry_date, "day")}
                                </span>
                              </div>

                              <div>
                                <p className="text-sm font-semibold text-[#7a947c]">
                                  {formatEntryDate(entry.entry_date, "short")}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                  {formatEntryDate(entry.entry_date, "long")}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => deleteJournalEntry(entry.id)}
                              className="text-xs text-slate-400 hover:text-[#a34d43] px-2.5 py-1.5 rounded-lg hover:bg-[#f7e9e6] transition-all"
                            >
                              Delete
                            </button>
                          </div>

                          <div className="px-6 sm:px-7 pb-7">
                            <div className="h-px bg-[#0f172a]/6 mb-5" />
                            <p className="text-slate-600 leading-8 whitespace-pre-wrap text-[15px] font-light">
                              {entry.content}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================
            FINAL REVIEW
        ================================================== */}

        {activeTab === "review" && (
          <div id="review-editor" className="max-w-4xl scroll-mt-24">
            <div className="mb-8">
              {reviewHasChanges && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#a47a25] bg-[#f6ecd4]/70 px-2.5 py-1 rounded-full mb-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c69a3d]" />
                  Unsaved changes
                </span>
              )}

              <h2 className="text-4xl sm:text-5xl font-classical font-semibold text-[#0f172a] leading-tight">
                {review ? "Your thoughts on the book" : "What did you think?"}
              </h2>

              <p className="text-slate-600 mt-4 leading-7 max-w-2xl text-[15px] font-light">
                Bring together everything you felt, noticed and thought about while reading.
              </p>
            </div>

            <div className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_10px_35px_rgba(15,23,42,0.05)] p-6 sm:p-8 mb-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-600">Your rating</p>
                  <p className="text-sm text-slate-400 mt-1 font-light">How would you rate this book?</p>
                </div>

                <div className="sm:text-right">
                  {displayRating > 0 ? (
                    <>
                      <p className="text-sm font-semibold text-slate-700">{displayRating}/5</p>
                      <p className="text-xs text-[#7a947c] mt-0.5">{RATING_LABEL[displayRating]}</p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-300">Choose a rating below</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 mt-6" onMouseLeave={() => setHoveredRating(0)}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoveredRating(star)}
                    aria-label={`Rate ${star} out of 5`}
                    className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center text-3xl sm:text-4xl transition-all ${
                      star <= displayRating
                        ? "text-[#c5a24a] bg-[#c5a24a]/10 scale-105"
                        : "text-slate-200 hover:text-[#c5a24a]/60 hover:bg-[#f7f5fa]"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div className="soft-surface rounded-[1.6rem] border soft-border shadow-[0_10px_35px_rgba(15,23,42,0.05)] overflow-hidden">
              <div className="p-6 sm:p-8">
                <div className="flex items-center justify-between mb-4">
                  <label htmlFor="review" className="text-sm font-medium text-slate-600">
                    Your review
                  </label>
                  <span className="text-xs text-slate-400">{reviewText.length} characters</span>
                </div>

                <textarea
                  id="review"
                  value={reviewText}
                  onChange={(event) => setReviewText(event.target.value)}
                  placeholder="Write about the story, characters, writing, themes, favourite moments, or anything else that stayed with you..."
                  rows={14}
                  className="journal-paper w-full px-5 py-5 border border-[#0f172a]/10 rounded-2xl resize-y min-h-[300px] text-[15px] leading-8 text-slate-600 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
                />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-5">
                  <p className="text-xs text-slate-400 font-light">
                    {review
                      ? "You can edit your review at any time."
                      : "Your review will be saved privately to your account."}
                  </p>

                  <button
                    type="button"
                    onClick={saveReview}
                    disabled={savingReview || rating === 0 || !reviewText.trim() || !reviewHasChanges}
                    className="w-full sm:w-auto bg-[#0f172a] text-[#fdfaf3] px-8 py-3.5 rounded-full font-semibold text-sm hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_8px_20px_rgba(15,23,42,0.12)]"
                  >
                    {savingReview ? "Saving review..." : review ? "Update Review" : "Save Review"}
                  </button>
                </div>
              </div>

              <div className="px-6 sm:px-8 py-4 bg-[#f7f5fa]/70 border-t border-[#0f172a]/6">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7a947c]" />
                  <p className="text-xs text-slate-400 leading-5">
                    Your review is private and only visible in your personal library.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ==================================================
          COVER PHOTO MODAL
      ================================================== */}

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
                  <h2 id="cover-modal-title" className="text-3xl font-classical font-semibold text-[#0f172a]">
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
                  className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40"
                >
                  <span aria-hidden="true" className="text-2xl leading-none">×</span>
                </button>
              </div>

              <div className="mt-7 flex gap-5 items-start">
                {/* Preview */}
                <div className="w-28 sm:w-32 shrink-0">
                  <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-md bg-[#e9e4d9] ring-1 ring-[#0f172a]/10">
                    <CoverImage sources={modalPreviewSources} title={book.title} author={book.author} />
                    {coverPreview && (
                      <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-[#7a947c] text-white shadow">
                        New
                      </span>
                    )}
                  </div>
                </div>

                {/* Picker */}
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
                      dragOver
                        ? "border-[#7a947c] bg-[#7a947c]/10"
                        : "border-[#0f172a]/15 bg-white hover:border-[#7a947c] hover:bg-[#7a947c]/5"
                    }`}
                  >
                    <span className="w-10 h-10 rounded-full bg-[#7a947c]/15 text-[#7a947c] flex items-center justify-center" aria-hidden="true">
                      <CameraIcon size={18} />
                    </span>
                    <span className="text-sm font-medium text-[#0f172a]">
                      {coverFile ? "Choose a different image" : "Take a photo or choose an image"}
                    </span>
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
                    className="sm:mr-auto text-sm text-slate-400 hover:text-[#a34d43] px-3 py-2 rounded-lg hover:bg-[#f7e9e6] transition-all disabled:opacity-40"
                  >
                    Remove my photo
                  </button>
                )}

                <button
                  type="button"
                  onClick={closeCoverModal}
                  disabled={savingCover}
                  className={`${hasCustomCover && !coverFile ? "" : "sm:ml-auto"} border border-[#0f172a]/12 bg-white/70 text-slate-600 px-6 py-3 rounded-full hover:border-[#0f172a]/30 hover:text-[#0f172a] transition-all text-sm font-semibold disabled:opacity-40`}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveCustomCover}
                  disabled={!coverFile || savingCover}
                  className="bg-[#7a947c] text-white px-7 py-3 rounded-full hover:bg-[#6b826c] transition-all text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {savingCover && (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {savingCover ? "Saving…" : "Save cover"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================
          UNSAVED CHANGES MODAL
      ================================================== */}

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
          <div className="w-full max-w-md bg-[#fdfaf3] border border-[#0f172a]/10 rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] overflow-hidden">
            <div className="p-7 sm:p-8">
              <div className="w-12 h-12 rounded-full bg-[#f7f5fa] flex items-center justify-center mb-5">
                <span className="text-xl text-[#9a86b9]">✎</span>
              </div>

              <h2 className="text-3xl font-classical font-semibold text-[#0f172a] mt-2">
                Leave without saving?
              </h2>

              <p className="text-slate-600 mt-4 leading-7 text-sm font-light">
                You have made changes to your review that haven&apos;t been saved yet. If you leave this
                page, those changes will be lost.
              </p>

              <div className="flex flex-col-reverse sm:flex-row gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => {
                    setShowLeaveModal(false);
                    setPendingDestination(null);
                  }}
                  className="flex-1 border border-[#0f172a]/12 bg-white/70 text-slate-600 py-3.5 rounded-full hover:border-[#0f172a]/30 hover:text-[#0f172a] transition-all text-sm font-semibold"
                >
                  Continue Editing
                </button>

                <button
                  type="button"
                  onClick={discardAndLeave}
                  className="flex-1 bg-[#0f172a] text-[#fdfaf3] py-3.5 rounded-full hover:bg-[#1e293b] transition-all text-sm font-semibold"
                >
                  Discard & Leave
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CameraIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}