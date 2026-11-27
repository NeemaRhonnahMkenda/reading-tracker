"use client";

// src/app/library/[bookId]/_components/StoryCardSheet.tsx
// Make the Instagram-story image for a book, in the "Book Twelve · 2026" style:
//   - "What it's about" card (when you start it) or "My review" card (when you finish)
//   - book number and year filled in for you, genre labels with arrows
//   - your star rating added automatically
//   - your private review and journal notes beside the editor to write from,
//     the publisher's blurb on request, and an optional AI first draft
// What you write is saved per book, so you can come back to it.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { CARD_H, CARD_W, cardBlob, cardFileName, drawStoryCard, loadCardFonts, loadCover, numberWords, type CardKind } from "../_lib/storyCard";

export interface StoryNote {
  id: string;
  content: string;
  chapter: string | null;
  page_number: number | null;
  entry_date: string;
}

interface CardRow {
  book_number: number | null;
  card_year: number | null;
  tag_left: string | null;
  tag_right: string | null;
  about_text: string | null;
  review_text: string | null;
  show_rating: boolean;
}

const GENRES = [
  "Romance",
  "Fantasy",
  "Romantasy",
  "Thriller",
  "Mystery",
  "Psychological Fiction",
  "Literary Fiction",
  "Historical Fiction",
  "Comedy",
  "Sci-Fi",
  "Horror",
  "Contemporary",
  "Young Adult",
  "Memoir",
  "Non-fiction",
  "Self-help",
  "Enemies-to-lovers",
  "Slow burn",
  "Found family",
  "Small town",
];

const REVIEW_STARTERS = [
  "I have THOUGHTS about this one.",
  "What I loved most was",
  "I really enjoyed",
  "Unfortunately,",
  "The characters",
  "I'd recommend it to anyone who",
  "Overall,",
];

const ABOUT_STARTERS = ["When", "Meet", "Set in", "But when", "Now,"];

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfaf3]";
const fieldClass =
  "w-full min-w-0 h-11 px-3.5 bg-white border border-[#0f172a]/10 rounded-xl text-base sm:text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all";
const labelClass = "block text-xs font-medium text-slate-500 mb-1.5";
const btnPrimary = `inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`;
const btnDark = `inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-[#0f172a] text-[#fdfaf3] text-sm font-medium hover:bg-[#1e293b] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${focusRing}`;
const btnOutline = `inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-white/70 text-slate-700 border border-[#0f172a]/10 text-sm font-medium hover:bg-white hover:border-[#0f172a]/25 transition-all disabled:opacity-40 ${focusRing}`;
const chipClass = `shrink-0 h-8 px-3 rounded-full border text-xs transition-colors ${focusRing}`;

function locationLabel(chapter: string | null, page: number | null) {
  const c = chapter?.trim();
  const ch = c ? (/^\d+$/.test(c) ? `Chapter ${c}` : c) : "";
  if (ch && page != null) return `${ch}, p. ${page}`;
  return ch || (page != null ? `Page ${page}` : "");
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function plainText(html: string) {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n"), "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return <span aria-hidden="true" className={`w-4 h-4 border-2 rounded-full animate-spin ${dark ? "border-[#0f172a]/20 border-t-[#0f172a]" : "border-white/30 border-t-white"}`} />;
}

export default function StoryCardSheet({
  open,
  onClose,
  userId,
  book,
  coverSources,
  rating,
  privateReview,
  finishedYear,
  notes,
  initialKind,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  book: { id: string; title: string; author: string | null };
  coverSources: string[];
  rating: number;
  privateReview: string;
  finishedYear: number | null;
  notes: StoryNote[];
  initialKind: CardKind;
  onToast: (type: "success" | "error", message: string) => void;
}) {
  const ids = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const coverFileRef = useRef<HTMLInputElement | null>(null);

  // Card
  const [kind, setKind] = useState<CardKind>(initialKind);
  const [bookNumber, setBookNumber] = useState("");
  const [year, setYear] = useState(String(finishedYear ?? new Date().getFullYear()));
  const [tagLeft, setTagLeft] = useState("");
  const [tagRight, setTagRight] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [showRating, setShowRating] = useState(true);

  // Cover
  const [cover, setCover] = useState<HTMLImageElement | null>(null);
  const [coverOverride, setCoverOverride] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(true);

  // State
  const [loaded, setLoaded] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [fits, setFits] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [exporting, setExporting] = useState<"" | "download" | "share" | "copy">("");
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [canCopyImage, setCanCopyImage] = useState(false);

  // Writing help
  const [helpTab, setHelpTab] = useState<"mine" | "notes" | "blurb">("mine");
  const [blurb, setBlurb] = useState<{ text: string; categories: string[] } | null>(null);
  const [blurbState, setBlurbState] = useState<"idle" | "loading" | "none" | "error">("idle");
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [tone, setTone] = useState<"warm" | "honest" | "fun">("warm");
  const [previousText, setPreviousText] = useState<string | null>(null); // for "Undo draft"

  const text = kind === "about" ? aboutText : reviewText;
  const setText = kind === "about" ? setAboutText : setReviewText;
  const number = /^\d{1,3}$/.test(bookNumber) && Number(bookNumber) > 0 ? Number(bookNumber) : null;
  const yearNum = /^\d{4}$/.test(year) ? Number(year) : null;
  const ratingShown = kind === "review" && showRating && rating > 0 ? rating : null;

  // ---------- Open: fonts, saved card, defaults ----------
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setKind(initialKind);
    setView("edit");
    setDraftError("");
    setPreviousText(null);

    loadCardFonts().then(() => alive && setFontsLoaded(true));
    setCanCopyImage(typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function" && !window.matchMedia("(pointer: coarse)").matches);
    try {
      const probe = new File([new Blob(["x"], { type: "image/png" })], "probe.png", { type: "image/png" });
      setCanShareFiles(!!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
    fetch("/api/story/draft", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => alive && setDraftEnabled(!!d.enabled))
      .catch(() => undefined);

    (async () => {
      const [{ data: row, error }, countResult] = await Promise.all([
        supabase
          .from("book_story_cards")
          .select("book_number, card_year, tag_left, tag_right, about_text, review_text, show_rating")
          .eq("user_id", userId)
          .eq("book_id", book.id)
          .maybeSingle(),
        // "Book N": one more than the other books you finished that year
        supabase
          .from("book_reviews")
          .select("book_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("finished_year", finishedYear ?? new Date().getFullYear())
          .neq("book_id", book.id),
      ]);
      if (!alive) return;
      if (error) {
        console.error("Story card load failed:", error.message);
        setSaveError(error.code === "42P01" ? "Story cards need a database update. Run book-story-cards.sql in Supabase." : "Your saved card couldn't be loaded.");
      }
      const saved = row as CardRow | null;
      setBookNumber(saved?.book_number ? String(saved.book_number) : countResult.count != null ? String(countResult.count + 1) : "");
      setYear(String(saved?.card_year ?? finishedYear ?? new Date().getFullYear()));
      setTagLeft(saved?.tag_left ?? "");
      setTagRight(saved?.tag_right ?? "");
      setAboutText(saved?.about_text ?? "");
      setReviewText(saved?.review_text ?? privateReview.trim());
      setShowRating(saved?.show_rating ?? true);
      setLoaded(true);
    })();

    return () => {
      alive = false;
      setLoaded(false);
      setSaveState("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, book.id, userId]);

  // ---------- Cover ----------
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCoverLoading(true);
    loadCover(coverOverride ? [coverOverride] : coverSources).then((img) => {
      if (!alive) return;
      setCover(img);
      setCoverLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, coverOverride, coverSources]);

  useEffect(() => {
    return () => {
      if (coverOverride) URL.revokeObjectURL(coverOverride);
    };
  }, [coverOverride]);

  // ---------- Draw ----------
  useEffect(() => {
    if (!open || !fontsLoaded || !canvasRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      const layout = drawStoryCard(canvasRef.current, {
        kind,
        bookNumber: number,
        year: yearNum,
        tagLeft,
        tagRight,
        text,
        rating: ratingShown,
        cover,
        title: book.title,
        author: book.author,
      });
      setFits(layout.fits);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, loaded, fontsLoaded, kind, number, yearNum, tagLeft, tagRight, text, ratingShown, cover, book.title, book.author, view]);

  // ---------- Save (automatically, a moment after you stop typing) ----------
  const save = useCallback(async () => {
    setSaveState("saving");
    const { error } = await supabase.from("book_story_cards").upsert(
      {
        user_id: userId,
        book_id: book.id,
        book_number: number,
        card_year: yearNum,
        tag_left: tagLeft.trim().slice(0, 40) || null,
        tag_right: tagRight.trim().slice(0, 40) || null,
        about_text: aboutText.trim().slice(0, 2000) || null,
        review_text: reviewText.trim().slice(0, 2000) || null,
        show_rating: showRating,
      },
      { onConflict: "user_id,book_id" }
    );
    if (error) {
      console.error("Story card save failed:", error.message);
      setSaveState("error");
      setSaveError(error.code === "42P01" ? "Story cards need a database update. Run book-story-cards.sql in Supabase." : "Your card couldn't be saved. It'll try again when you next edit.");
      return false;
    }
    setSaveState("saved");
    setSaveError("");
    return true;
  }, [userId, book.id, number, yearNum, tagLeft, tagRight, aboutText, reviewText, showRating]);

  useEffect(() => {
    if (!open || !loaded) return;
    const timer = window.setTimeout(save, 1200);
    return () => window.clearTimeout(timer);
  }, [open, loaded, save]);

  // ---------- Close with Escape, lock page scroll ----------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !exporting && onClose();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, exporting, onClose]);

  // ---------- Writing help ----------
  function insertText(snippet: string, asParagraph = true) {
    const el = textRef.current;
    const current = text;
    const at = el && document.activeElement === el ? el.selectionEnd : current.length;
    const before = current.slice(0, at).replace(/\s+$/, "");
    const after = current.slice(at).replace(/^\s+/, "");
    const join = before ? (asParagraph ? "\n" : " ") : "";
    const next = `${before}${join}${snippet}${after ? ` ${after}` : ""}`;
    setText(next.slice(0, 2000));
    requestAnimationFrame(() => {
      const t = textRef.current;
      if (!t) return;
      const pos = (before + join + snippet).length;
      t.focus();
      t.setSelectionRange(pos, pos);
    });
  }

  async function fetchBlurb() {
    setBlurbState("loading");
    try {
      const q = [`intitle:${book.title}`, book.author ? `inauthor:${book.author}` : ""].filter(Boolean).join("+");
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5&printType=books&langRestrict=en`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items?: { volumeInfo?: { description?: string; categories?: string[] } }[] };
      const withText = (data.items ?? []).map((i) => i.volumeInfo).filter((v) => v?.description);
      // The longest description is usually the full publisher's blurb
      const best = withText.sort((a, b) => (b!.description!.length ?? 0) - (a!.description!.length ?? 0))[0];
      if (!best?.description) {
        setBlurbState("none");
        return;
      }
      const categories = [...new Set(withText.flatMap((v) => v!.categories ?? []).flatMap((c) => c.split("/").map((s) => s.trim())))]
        .filter((c) => c && !/^fiction$/i.test(c) && c.length <= 30)
        .slice(0, 6);
      setBlurb({ text: plainText(best.description), categories });
      setBlurbState("idle");
    } catch {
      setBlurbState("error");
    }
  }

  async function draftWithAI() {
    setDrafting(true);
    setDraftError("");
    try {
      const res = await fetch("/api/story/draft", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: book.title,
          author: book.author,
          rating: rating || null,
          review: privateReview,
          notes: notes.slice(0, 40).map((n) => ({ where: locationLabel(n.chapter, n.page_number), text: n.content })),
          blurb: kind === "about" ? blurb?.text ?? null : null,
          current: text,
          tone,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error ?? "The draft couldn't be written right now. Try again.");
      setPreviousText(text);
      setText(data.text);
    } catch (e) {
      setDraftError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  function addTag(tag: string) {
    if (!tagLeft.trim()) setTagLeft(tag);
    else if (!tagRight.trim()) setTagRight(tag);
    else setTagRight(tag);
  }

  // ---------- Export ----------
  async function exportCard(how: "download" | "share" | "copy") {
    if (!canvasRef.current) return;
    setExporting(how);
    try {
      await save();
      const blob = await cardBlob(canvasRef.current);
      const name = cardFileName(book.title, kind, number);
      if (how === "share") {
        const file = new File([blob], name, { type: "image/png" });
        await navigator.share({ files: [file], title: book.title });
      } else if (how === "copy") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        onToast("success", "Image copied. Paste it wherever you post.");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        onToast("success", "Story image saved.");
      }
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") return; // closed the share sheet
      console.error("Story export failed:", err);
      onToast(
        "error",
        err.name === "SecurityError" ? "The cover blocked saving. Upload the cover photo on this card and try again." : "The image couldn't be made. Try again."
      );
    } finally {
      setExporting("");
    }
  }

  // ---------- Derived ----------
  const noteList = useMemo(
    () =>
      [...notes].sort((a, b) => {
        if (a.page_number != null && b.page_number != null) return a.page_number - b.page_number;
        return a.entry_date.localeCompare(b.entry_date);
      }),
    [notes]
  );

  if (!open) return null;

  const words = wordCount(text);
  const headingPreview = number ? `Book ${numberWords(number)}` : "Currently reading";

  // ============================================================
  // Pieces
  // ============================================================

  const preview = (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-full max-w-[300px] lg:max-w-[320px] aspect-[9/16] rounded-[1.4rem] overflow-hidden shadow-[0_24px_60px_rgba(15,23,42,0.22)] ring-1 ring-[#0f172a]/10 bg-[#f1efea]">
        <canvas ref={canvasRef} width={CARD_W} height={CARD_H} className="absolute inset-0 w-full h-full" aria-label={`Preview of your ${kind === "about" ? "about the book" : "review"} story card`} role="img" />
        {(!fontsLoaded || coverLoading) && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#f1efea]/70">
            <Spinner dark />
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 text-center">1080 × 1920, sized for Instagram and WhatsApp stories</p>
    </div>
  );

  const exportBar = (
    <div className="grid gap-2 w-full max-w-[320px] mx-auto">
      {canShareFiles && (
        <button type="button" onClick={() => exportCard("share")} disabled={!!exporting || !fontsLoaded} className={`${btnPrimary} w-full`}>
          {exporting === "share" ? <Spinner /> : <ShareIcon />}
          Share to stories
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => exportCard("download")}
          disabled={!!exporting || !fontsLoaded}
          className={`${canShareFiles ? btnOutline : btnDark} w-full ${canCopyImage ? "" : "col-span-2"}`}
        >
          {exporting === "download" ? <Spinner dark={canShareFiles} /> : <DownloadIcon />}
          Save image
        </button>
        {canCopyImage && (
          <button type="button" onClick={() => exportCard("copy")} disabled={!!exporting || !fontsLoaded} className={`${btnOutline} w-full`}>
            {exporting === "copy" ? <Spinner dark /> : <CopyIcon />}
            Copy
          </button>
        )}
      </div>
    </div>
  );

  const helper = (
    <aside aria-label="Writing help" className="rounded-[1.4rem] bg-white/70 border border-[#0f172a]/[0.08] overflow-hidden">
      <div role="tablist" aria-label="Writing help" className="flex border-b border-[#0f172a]/[0.06] text-sm">
        {(
          [
            ["mine", kind === "review" ? "Your review" : "Your words"],
            ["notes", `Notes${notes.length ? ` (${notes.length})` : ""}`],
            ["blurb", "Blurb"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={helpTab === id}
            onClick={() => setHelpTab(id)}
            className={`flex-1 h-11 font-medium transition-colors ${focusRing} ${helpTab === id ? "text-[#0f172a] bg-white shadow-[inset_0_-2px_0_#7a947c]" : "text-slate-400 hover:text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-4 max-h-[46vh] lg:max-h-[52vh] overflow-y-auto overscroll-contain">
        {helpTab === "mine" && (
          <div className="space-y-4">
            {kind === "review" && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="text-xs text-slate-400">Your rating</span>
                {rating > 0 ? (
                  <span className="font-medium text-[#8a6a22]">
                    {"★".repeat(Math.floor(rating))}
                    <span className="text-slate-300">{"★".repeat(5 - Math.ceil(rating))}</span> {Number(rating.toFixed(2))} of 5
                  </span>
                ) : (
                  <span className="text-slate-400">Not rated yet. Rate it in Final review.</span>
                )}
              </div>
            )}
            {privateReview.trim() ? (
              <>
                <blockquote className="rounded-xl bg-[#fefcf6] border border-[#0f172a]/[0.06] px-4 py-3 text-sm text-slate-700 leading-6 whitespace-pre-wrap">{privateReview.trim()}</blockquote>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => insertText(privateReview.trim())} className={`${chipClass} border-[#7a947c]/40 text-[#4a5c4b] hover:bg-[#eef3ee]`}>
                    + Add to card
                  </button>
                  {text.trim() !== privateReview.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviousText(text);
                        setText(privateReview.trim().slice(0, 2000));
                      }}
                      className={`${chipClass} border-[#0f172a]/10 text-slate-500 hover:text-[#0f172a]`}
                    >
                      Replace card text with it
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400 leading-6">
                You haven&apos;t written a private review yet. Your journal notes are in the Notes tab.
              </p>
            )}
            <div>
              <p className="text-xs text-slate-400 mb-2">Starters</p>
              <div className="flex flex-wrap gap-1.5">
                {(kind === "review" ? REVIEW_STARTERS : ABOUT_STARTERS).map((s) => (
                  <button key={s} type="button" onClick={() => insertText(s, s !== "Overall," && s !== "Unfortunately,")} className={`${chipClass} border-dashed border-[#9a86b9]/40 bg-[#f7f5fa]/70 text-[#6c5c85] hover:bg-[#f7f5fa]`}>
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {helpTab === "notes" &&
          (noteList.length === 0 ? (
            <p className="text-sm text-slate-400 leading-6">No journal notes for this book yet. Notes you add while reading show up here to help you write.</p>
          ) : (
            <ol className="space-y-2.5">
              {noteList.map((n) => {
                const where = locationLabel(n.chapter, n.page_number);
                return (
                  <li key={n.id} className="rounded-xl bg-[#fefcf6] border border-[#0f172a]/[0.06] p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      {where && <span className="px-2 py-0.5 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-[11px] font-semibold">{where}</span>}
                      <button
                        type="button"
                        onClick={() => insertText(n.content.trim())}
                        aria-label={`Add this note${where ? ` from ${where}` : ""} to the card`}
                        className={`ml-auto text-xs font-medium text-[#4a5c4b] hover:text-[#0f172a] px-2 py-1 rounded-lg hover:bg-[#eef3ee] ${focusRing}`}
                      >
                        + Add
                      </button>
                    </div>
                    <p className="text-sm text-slate-600 leading-6 whitespace-pre-wrap break-words">{n.content}</p>
                  </li>
                );
              })}
            </ol>
          ))}

        {helpTab === "blurb" && (
          <div className="space-y-3">
            {!blurb && (
              <>
                <p className="text-sm text-slate-500 leading-6">Get the publisher&apos;s description from Google Books to use for &quot;what it&apos;s about&quot;, and genre ideas for the labels.</p>
                <button type="button" onClick={fetchBlurb} disabled={blurbState === "loading"} className={`${btnOutline} h-10`}>
                  {blurbState === "loading" && <Spinner dark />}
                  Find the blurb
                </button>
                {blurbState === "none" && <p className="text-sm text-slate-400">Google Books doesn&apos;t have a description for this one. Copy it from the back cover instead.</p>}
                {blurbState === "error" && <p className="text-sm text-[#a14e43]">Google Books didn&apos;t respond. Try again in a moment.</p>}
              </>
            )}
            {blurb && (
              <>
                <blockquote className="rounded-xl bg-[#fefcf6] border border-[#0f172a]/[0.06] px-4 py-3 text-sm text-slate-700 leading-6 whitespace-pre-wrap">{blurb.text}</blockquote>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setKind("about");
                      setPreviousText(aboutText);
                      setAboutText(blurb.text.slice(0, 2000));
                    }}
                    className={`${chipClass} border-[#7a947c]/40 text-[#4a5c4b] hover:bg-[#eef3ee]`}
                  >
                    Use as &quot;what it&apos;s about&quot;
                  </button>
                </div>
                {blurb.categories.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1.5">Genres from Google Books</p>
                    <div className="flex flex-wrap gap-1.5">
                      {blurb.categories.map((c) => (
                        <button key={c} type="button" onClick={() => addTag(c)} className={`${chipClass} border-[#0f172a]/10 text-slate-600 hover:border-[#7a947c]`}>
                          + {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">From Google Books. Check it, and trim spoilers.</p>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );

  const form = (
    <div className="space-y-6">
      {/* Which card */}
      <div role="radiogroup" aria-label="Which card" className="grid grid-cols-2 p-1 rounded-2xl bg-[#0f172a]/[0.05] gap-1">
        {(
          [
            ["about", "What it's about", "When you start it"],
            ["review", "My review", "When you finish"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={kind === value}
            onClick={() => {
              setKind(value);
              setPreviousText(null);
            }}
            className={`rounded-xl py-2.5 px-3 text-left transition-all ${focusRing} ${kind === value ? "bg-white shadow-sm" : "hover:bg-white/50"}`}
          >
            <span className={`block text-sm font-semibold ${kind === value ? "text-[#0f172a]" : "text-slate-500"}`}>{label}</span>
            <span className="block text-[11px] text-slate-400">{hint}</span>
          </button>
        ))}
      </div>

      {/* Heading */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div>
          <label htmlFor={`${ids}-num`} className={labelClass}>
            Book number
          </label>
          <input
            id={`${ids}-num`}
            inputMode="numeric"
            value={bookNumber}
            onChange={(e) => setBookNumber(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="12"
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-year`} className={labelClass}>
            Year
          </label>
          <input
            id={`${ids}-year`}
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder={String(new Date().getFullYear())}
            className={fieldClass}
          />
        </div>
        <p className="col-span-2 -mt-1 text-xs text-slate-400">
          Shows as <span className="font-medium text-slate-600">&ldquo;{headingPreview}&rdquo;</span>
          {yearNum ? <> over {yearNum}</> : null}. Leave the number empty for &ldquo;Currently reading&rdquo;.
        </p>
      </div>

      {/* Labels */}
      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${ids}-tl`} className={labelClass}>
              Left label
            </label>
            <input id={`${ids}-tl`} value={tagLeft} maxLength={40} onChange={(e) => setTagLeft(e.target.value)} placeholder="Romance" className={fieldClass} />
          </div>
          <div>
            <label htmlFor={`${ids}-tr`} className={labelClass}>
              Right label
            </label>
            <input id={`${ids}-tr`} value={tagRight} maxLength={40} onChange={(e) => setTagRight(e.target.value)} placeholder="Enemies-to-lovers" className={fieldClass} />
          </div>
        </div>
        <div className="mt-2 -mx-1 px-1 flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible [scrollbar-width:none]">
          {GENRES.filter((g) => g !== tagLeft && g !== tagRight).map((g) => (
            <button key={g} type="button" onClick={() => addTag(g)} className={`${chipClass} border-[#0f172a]/10 bg-white text-slate-600 hover:border-[#7a947c] hover:text-[#4a5c4b]`}>
              + {g}
            </button>
          ))}
        </div>
      </div>

      {/* Rating */}
      {kind === "review" && (
        <label className={`flex items-center gap-3 rounded-2xl border border-[#0f172a]/[0.08] bg-white/70 px-4 py-3 ${rating > 0 ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" checked={showRating && rating > 0} disabled={rating === 0} onChange={(e) => setShowRating(e.target.checked)} className="w-4 h-4 accent-[#7a947c]" />
          <span className="flex-1 text-sm text-slate-700">
            {rating > 0 ? (
              <>
                Show my rating <span className="text-[#c69a3d]">★</span> <span className="tabular-nums">{Number(rating.toFixed(2))}</span>
              </>
            ) : (
              "Rate the book in Final review to add your stars"
            )}
          </span>
        </label>
      )}

      {/* Words */}
      <div>
        <div className="flex items-end justify-between gap-3 mb-1.5">
          <label htmlFor={`${ids}-text`} className="text-xs font-medium text-slate-500">
            {kind === "about" ? "What it's about" : "Your review for the post"}
          </label>
          <span className={`text-[11px] ${fits ? "text-slate-400" : "text-[#a14e43] font-medium"}`} aria-live="polite">
            {words} words · {fits ? "fits on the card" : "too long, trim it a little"}
          </span>
        </div>
        <textarea
          id={`${ids}-text`}
          ref={textRef}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={
            kind === "about"
              ? "What's it about? A few lines, no spoilers. Tap Blurb to start from the publisher's description."
              : "How was it? Start from your review or notes on the right, then make it sound like a post."
          }
          className="w-full px-4 py-3 bg-[#fefcf6] border border-[#0f172a]/10 rounded-2xl resize-y min-h-[200px] text-base sm:text-[15px] leading-7 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
        />

        {/* AI draft (only when the server has a key) */}
        {draftEnabled && (
          <div className="mt-3 rounded-2xl border border-[#c69a3d]/25 bg-[#fbf6ea] p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={draftWithAI} disabled={drafting} className={`${btnDark} h-10 px-4`}>
                {drafting ? <Spinner /> : <span aria-hidden="true">✦</span>}
                {drafting ? "Writing…" : text.trim() ? "Polish it for me" : "Draft it for me"}
              </button>
              {kind === "review" && (
                <select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} aria-label="Tone" className="h-10 px-3 rounded-full border border-[#0f172a]/10 bg-white text-sm text-slate-600">
                  <option value="warm">Warm</option>
                  <option value="honest">Brutally honest</option>
                  <option value="fun">Chatty</option>
                </select>
              )}
              {previousText !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setText(previousText);
                    setPreviousText(null);
                  }}
                  className={`text-xs font-medium text-slate-500 underline underline-offset-4 hover:text-[#0f172a] rounded ${focusRing}`}
                >
                  Undo
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-[#7a5a14] leading-5">
              {kind === "review"
                ? "Uses your rating, private review and journal notes, and keeps your opinions. Always read it before posting."
                : blurb
                  ? "Shortens the blurb into a spoiler-free summary."
                  : "Find the blurb first (Blurb tab), or write a few lines, so the summary is accurate."}
            </p>
            {draftError && (
              <p role="alert" className="mt-2 text-sm text-[#a14e43]">
                {draftError}
              </p>
            )}
          </div>
        )}
        {!draftEnabled && previousText !== null && (
          <button
            type="button"
            onClick={() => {
              setText(previousText);
              setPreviousText(null);
            }}
            className={`mt-2 text-xs font-medium text-slate-500 underline underline-offset-4 hover:text-[#0f172a] rounded ${focusRing}`}
          >
            Undo
          </button>
        )}
      </div>

      {/* Cover */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs text-slate-400">Cover</span>
        <button type="button" onClick={() => coverFileRef.current?.click()} className={`text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}>
          Use a different image
        </button>
        {coverOverride && (
          <button type="button" onClick={() => setCoverOverride(null)} className={`text-xs text-slate-400 hover:text-[#0f172a] rounded ${focusRing}`}>
            Back to the book cover
          </button>
        )}
        {!coverLoading && !cover && <span className="text-xs text-slate-400">No cover found, so the card shows the title instead.</span>}
        <input
          ref={coverFileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 15 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(f.type)) {
              onToast("error", "Use a JPG, PNG or WebP image under 15 MB.");
              return;
            }
            setCoverOverride(URL.createObjectURL(f));
          }}
        />
      </div>
    </div>
  );

  // ============================================================
  // Layout
  // ============================================================

  return (
    <div className="fixed inset-0 z-[65] bg-[#0f172a]/55 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-5" onMouseDown={(e) => e.target === e.currentTarget && !exporting && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        className="w-full sm:max-w-6xl h-[96dvh] sm:h-auto sm:max-h-[94dvh] flex flex-col bg-[#fdfaf3] border border-[#0f172a]/10 rounded-t-[1.6rem] sm:rounded-[1.6rem] shadow-[0_25px_80px_rgba(15,23,42,0.22)] animate-sheet-in"
      >
        {/* Header */}
        <div className="shrink-0 px-5 sm:px-8 pt-3 sm:pt-6 pb-3 sm:pb-4 border-b border-[#0f172a]/[0.06]">
          <div aria-hidden="true" className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-[#0f172a]/15" />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={`${ids}-title`} className="font-classical text-2xl sm:text-3xl font-semibold truncate">
                Story card
              </h2>
              <p className="text-sm text-slate-500 font-light truncate">
                {book.title}
                <span className="ml-2 text-xs" aria-live="polite">
                  {saveState === "saving" ? "· Saving…" : saveState === "saved" ? "· Saved" : saveState === "error" ? "· Not saved" : ""}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={!!exporting}
              aria-label="Close"
              className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
            >
              <span aria-hidden="true" className="text-2xl leading-none">
                ×
              </span>
            </button>
          </div>

          {/* Phones: switch between writing and seeing it */}
          <div role="tablist" aria-label="Edit or preview" className="lg:hidden mt-3 grid grid-cols-2 p-1 rounded-full bg-[#0f172a]/[0.05]">
            {(["edit", "preview"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`h-9 rounded-full text-sm font-medium transition-all ${focusRing} ${view === v ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500"}`}
              >
                {v === "edit" ? "Write" : "Preview & share"}
              </button>
            ))}
          </div>
        </div>

        {saveError && (
          <p role="alert" className="mx-5 sm:mx-8 mt-4 rounded-xl bg-[#fbefed] border border-red-200/70 px-4 py-2.5 text-sm text-[#8f3b31]">
            {saveError}
          </p>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-5 sm:py-6">
          {!loaded ? (
            <div className="py-20 flex justify-center">
              <Spinner dark />
            </div>
          ) : (
            <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_320px] gap-6 lg:gap-8 items-start">
              {/* Preview: always on desktop, its own tab on phones */}
              <div className={`${view === "preview" ? "" : "hidden"} lg:block lg:sticky lg:top-0 space-y-4`}>
                {preview}
                {exportBar}
              </div>
              <div className={`${view === "edit" ? "" : "hidden"} lg:block min-w-0 space-y-6`}>
                {form}
                <div className="xl:hidden">{helper}</div>
              </div>
              <div className="hidden xl:block xl:sticky xl:top-0">{helper}</div>
            </div>
          )}
        </div>

        {/* Phones: share without switching tabs */}
        {loaded && view === "edit" && (
          <div className="lg:hidden shrink-0 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[#0f172a]/[0.06] bg-[#fdfaf3]">
            <button type="button" onClick={() => setView("preview")} className={`${btnDark} w-full`}>
              Preview & share
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Icons
// ------------------------------------------------------------

function ShareIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}
