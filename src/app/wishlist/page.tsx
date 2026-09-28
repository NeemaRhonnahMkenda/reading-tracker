"use client";

// src/app/wishlist/page.tsx

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrowserMultiFormatReader } from "@zxing/browser";

import Navbar from "../components/Navbar";
import ShareWishlistCard from "./ShareWishlistCard";
import { supabase } from "../../lib/supabase";

// ============================================================
// Types
// ============================================================

interface BookResult {
  title: string | null;
  author: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedDate: string | null;
  pages: number | null;
  binding: string | null;
  coverUrl: string | null;
  openLibraryId: string | null;
}

interface WishlistItem {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  isbn_10: string | null;
  isbn_13: string | null;
  publisher: string | null;
  published_date: string | null;
  pages: number | null;
  binding: string | null;
  cover_url: string | null;
  open_library_id: string | null;
  created_at: string;
}

type Toast = { type: "success" | "error"; message: string; href?: string; linkLabel?: string } | null;

type BookKeys = {
  isbn13?: string | null;
  isbn10?: string | null;
  title?: string | null;
  author?: string | null;
};

type MatchKind = "exact" | "edition" | null;

interface BookIndex {
  isbns: Set<string>;
  titles: Map<string, Set<string>[]>; // normalized title -> author token sets
}

// ============================================================
// Config + helpers
// ============================================================

const ISBN_PATTERN = /^(?:\d{10}|\d{9}X|\d{13})$/i;

const STATUS_OPTIONS = [
  { value: "want_to_read", label: "Want to read", hint: "On the shelf" },
  { value: "reading", label: "Reading", hint: "Started it" },
  { value: "finished", label: "Finished", hint: "Already read" },
] as const;

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#Fdfaf3]";

const inputClass =
  "w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm text-[#0f172a] placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/15 transition-all";

function cleanIsbn(value: string) {
  return value.replace(/[-\s]/g, "").toUpperCase();
}

function formatPublishedDate(date: string | null): string | null {
  if (!date) return null;
  if (/^\d{4}$/.test(date)) return `${date}-01-01`;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

function yearOf(date: string | null) {
  return date ? date.slice(0, 4) : null;
}

function resultKey(r: BookResult) {
  return r.isbn13 || r.isbn10 || r.openLibraryId || `${r.title}|${r.author}`;
}

function dedupeResults(list: BookResult[]) {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = resultKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemAsKeys(item: WishlistItem): BookKeys {
  return { isbn13: item.isbn_13, isbn10: item.isbn_10, title: item.title, author: item.author };
}

// ============================================================
// Matching across editions
// ============================================================

function stripAccents(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

// "Things We Left Behind (Knockemout, #3)" -> "things we left behind"
function normalizeTitle(title: string) {
  const base = stripAccents(title).toLowerCase().replace(/&/g, " and ");
  const withoutExtras = base.replace(/\s*[:([].*$/, ""); // drop subtitle, (series), [edition]
  const clean = (text: string) =>
    text
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/^(the|a|an)\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
  return clean(withoutExtras) || clean(base);
}

const AUTHOR_STOPWORDS = new Set(["and", "the", "jr", "sr", "phd", "dr", "mrs", "mr"]);

// "Score, Lucy" and "Lucy Score" both -> { "lucy", "score" }
function authorTokens(author: string | null | undefined) {
  if (!author) return new Set<string>();
  const words = stripAccents(author)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !AUTHOR_STOPWORDS.has(w));
  return new Set(words);
}

// ISBN-10 -> ISBN-13 so the same edition matches in either form
function toIsbn13(isbn: string | null | undefined): string | null {
  if (!isbn) return null;
  const clean = cleanIsbn(isbn);
  if (/^\d{13}$/.test(clean)) return clean;
  if (!/^\d{9}[\dX]$/.test(clean)) return null;

  const core = `978${clean.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

function isbnKeys(book: BookKeys) {
  return [toIsbn13(book.isbn13), toIsbn13(book.isbn10)].filter((k): k is string => !!k);
}

function buildIndex(books: BookKeys[]): BookIndex {
  const index: BookIndex = { isbns: new Set(), titles: new Map() };

  for (const book of books) {
    isbnKeys(book).forEach((k) => index.isbns.add(k));

    if (book.title) {
      const key = normalizeTitle(book.title);
      const list = index.titles.get(key) ?? [];
      list.push(authorTokens(book.author));
      index.titles.set(key, list);
    }
  }

  return index;
}

function matchBook(index: BookIndex, book: BookKeys): MatchKind {
  if (isbnKeys(book).some((k) => index.isbns.has(k))) return "exact";
  if (!book.title) return null;

  const candidates = index.titles.get(normalizeTitle(book.title));
  if (!candidates) return null;

  const tokens = authorTokens(book.author);

  const sameAuthor = candidates.some((candidate) => {
    // Only treat a missing author as a match when both are missing
    if (candidate.size === 0 || tokens.size === 0) return candidate.size === tokens.size;
    return [...tokens].some((t) => candidate.has(t));
  });

  return sameAuthor ? "edition" : null;
}

// ============================================================
// Small components
// ============================================================

function Cover({ src, title, author, className = "" }: { src: string | null; title: string; author?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  return (
    <div className={`relative aspect-[2/3] rounded-lg overflow-hidden bg-[#e9e4d9] ${className}`}>
      {src && !failed ? (
        <img src={src} alt={`Cover of ${title}`} loading="lazy" onError={() => setFailed(true)} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full p-3 flex flex-col justify-between bg-[#0f172a] text-[#Fdfaf3]">
          <span className="text-[8px] tracking-[0.2em] opacity-50">The Archive</span>
          <div>
            <p className="font-classical text-sm leading-tight line-clamp-4">{title}</p>
            {author && <p className="text-[10px] opacity-70 mt-1 line-clamp-2">{author}</p>}
          </div>
          <span className="self-end font-classical text-base opacity-40">A</span>
        </div>
      )}
    </div>
  );
}

function Spinner({ light = true }: { light?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-4 h-4 border-2 rounded-full animate-spin ${
        light ? "border-white/30 border-t-white" : "border-[#0f172a]/20 border-t-[#0f172a]"
      }`}
    />
  );
}

// ============================================================
// Page
// ============================================================

export default function WishlistPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [libraryKeys, setLibraryKeys] = useState<BookKeys[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Search
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [isbnLookup, setIsbnLookup] = useState(false); // last search was a single ISBN
  const [fromScan, setFromScan] = useState(false); // last search came from the camera

  // Barcode scanner (same approach as the library page)
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const hasScannedRef = useRef(false);

  // Wishlist filter
  const [filter, setFilter] = useState("");

  // Transfer
  const [transferItem, setTransferItem] = useState<WishlistItem | null>(null);
  const [tStatus, setTStatus] = useState("want_to_read");
  const [tBoughtFrom, setTBoughtFrom] = useState("");
  const [tTitle, setTTitle] = useState("");
  const [tAuthor, setTAuthor] = useState("");
  const [tPublisher, setTPublisher] = useState("");
  const [tPublished, setTPublished] = useState("");
  const [tPages, setTPages] = useState("");
  const [tBinding, setTBinding] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // ============================================================
  // Load
  // ============================================================

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setLoadError("");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.push("/login");
        return;
      }

      const uid = session.user.id;
      if (!active) return;
      setUserId(uid);

      const [wishlistResult, libraryResult] = await Promise.all([
        supabase.from("wishlist").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
        supabase.from("books").select("isbn_13, isbn_10, title, author").eq("user_id", uid),
      ]);

      if (!active) return;

      if (wishlistResult.error) {
        console.error("Wishlist load failed:", wishlistResult.error.message);
        setLoadError("Your wishlist couldn't be loaded. Refresh to try again.");
      } else {
        setItems((wishlistResult.data || []) as WishlistItem[]);
      }

      if (libraryResult.error) {
        console.error("Library lookup failed:", libraryResult.error.message);
      } else {
        setLibraryKeys(
          (libraryResult.data || []).map((b) => ({
            isbn13: b.isbn_13,
            isbn10: b.isbn_10,
            title: b.title,
            author: b.author,
          }))
        );
      }

      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [router]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Transfer modal: Escape + scroll lock
  useEffect(() => {
    if (!transferItem) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !transferring) setTransferItem(null);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [transferItem, transferring]);

  // ============================================================
  // Match indexes (rebuilt only when library or wishlist changes)
  // ============================================================

  const libraryIndex = useMemo(() => buildIndex(libraryKeys), [libraryKeys]);
  const wishlistIndex = useMemo(() => buildIndex(items.map(itemAsKeys)), [items]);

  const libraryMatch = (book: BookKeys) => matchBook(libraryIndex, book);
  const wishlistMatch = (book: BookKeys) => matchBook(wishlistIndex, book);

  // ============================================================
  // Search
  // ============================================================

  async function searchByIsbn(isbn: string) {
    setSearching(true);
    setSearchError("");
    setResults(null);
    setIsbnLookup(true);

    try {
      const response = await fetch(`/api/books/isbn/${encodeURIComponent(isbn)}`);
      const data = await response.json();

      if (!response.ok) {
        setResults([]);
        setSearchError(data.error || `No book found for ISBN ${isbn}. Try searching by the title instead.`);
        return;
      }

      setResults([data as BookResult]);
    } catch (error) {
      console.error("ISBN lookup failed:", error);
      setResults([]);
      setSearchError("The lookup failed. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  async function searchByText(q: string) {
    setSearching(true);
    setSearchError("");
    setResults(null);
    setIsbnLookup(false);

    try {
      const response = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
      const data = await response.json();

      if (!response.ok) {
        setResults([]);
        setSearchError(data.error || "The search didn't work. Try again.");
        return;
      }

      setResults(dedupeResults((data.results || []) as BookResult[]));
    } catch (error) {
      console.error("Search failed:", error);
      setResults([]);
      setSearchError("The search failed. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();

    const q = query.trim();
    setSearchError("");
    setFromScan(false);
    stopScanner();

    if (q.length < 2) {
      setSearchError("Type a title, an author, or an ISBN.");
      return;
    }

    const isbn = cleanIsbn(q);
    if (ISBN_PATTERN.test(isbn)) {
      await searchByIsbn(isbn);
    } else {
      await searchByText(q);
    }
  }

  function clearSearch() {
    setQuery("");
    setResults(null);
    setSearchError("");
    setIsbnLookup(false);
    setFromScan(false);
  }

  // ============================================================
  // Barcode scanner (mirrors the library page)
  // ============================================================

  function teardownCamera() {
    if (scannerControlsRef.current) {
      try {
        scannerControlsRef.current.stop();
      } catch {
        // ignore
      }
      scannerControlsRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // ignore
      }
      videoRef.current.srcObject = null;
    }
  }

  function stopScanner() {
    teardownCamera();
    hasScannedRef.current = false;
    setScanning(false);
  }

  // Release the camera when the page closes
  useEffect(() => {
    return () => teardownCamera();
  }, []);

  // Release the camera when the tab is hidden (saves battery)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        teardownCamera();
        hasScannedRef.current = false;
        setScanning(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  async function startScanner() {
    setScannerError("");
    setSearchError("");
    setResults(null);
    setIsbnLookup(false);
    setFromScan(false);

    // Make sure a previous session is fully released before starting again
    teardownCamera();
    hasScannedRef.current = false;
    setScanning(true);

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setScannerError(
          window.isSecureContext
            ? "This browser can't use the camera. Type the ISBN instead."
            : "The camera only works over a secure (https) connection. Type the ISBN instead."
        );
        setScanning(false);
        return;
      }

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();

      if (devices.length === 0) {
        setScannerError("No camera found. Type the ISBN instead.");
        setScanning(false);
        return;
      }

      // Prefer the back camera. Labels are empty until permission is granted;
      // passing undefined lets ZXing request the rear ("environment") camera.
      const backCamera = devices.find((device) => {
        const label = device.label.toLowerCase();
        return label.includes("back") || label.includes("rear") || label.includes("environment");
      });

      if (!videoRef.current) {
        setScannerError("The camera couldn't start. Try again.");
        setScanning(false);
        return;
      }

      const codeReader = new BrowserMultiFormatReader();

      const controls = await codeReader.decodeFromVideoDevice(
        backCamera?.deviceId,
        videoRef.current,
        (result) => {
          if (!result || hasScannedRef.current) return;

          const scanned = cleanIsbn(result.getText());

          if (!ISBN_PATTERN.test(scanned)) {
            setScannerError("That barcode isn't an ISBN. Try the barcode on the back cover.");
            return;
          }

          // Mark as handled before anything else so it only fires once
          hasScannedRef.current = true;
          navigator.vibrate?.(60);

          teardownCamera();
          setScanning(false);
          setScannerError("");

          // Populate the search bar, then look the book up
          setQuery(scanned);
          setFromScan(true);
          searchByIsbn(scanned);
        }
      );

      scannerControlsRef.current = controls;

      if (videoRef.current?.srcObject instanceof MediaStream) {
        streamRef.current = videoRef.current.srcObject;
      }

      // If a barcode was read before the controls were ready, stop now
      if (hasScannedRef.current) teardownCamera();
    } catch (error) {
      console.error("Barcode scanner error:", error);
      teardownCamera();
      setScanning(false);

      const name = (error as Error)?.name;
      setScannerError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow it in your browser settings, or type the ISBN."
          : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No camera was found. Type the ISBN instead."
          : "The camera couldn't start. Type the ISBN instead."
      );
    }
  }

  // ============================================================
  // Add to wishlist
  // ============================================================

  async function addToWishlist(result: BookResult) {
    if (!userId || !result.title) return;

    const key = resultKey(result);
    setAddingKey(key);

    try {
      const { data, error } = await supabase
        .from("wishlist")
        .insert({
          user_id: userId,
          title: result.title,
          author: result.author,
          isbn_10: result.isbn10 ? cleanIsbn(result.isbn10) : null,
          isbn_13: result.isbn13 ? cleanIsbn(result.isbn13) : null,
          publisher: result.publisher,
          published_date: formatPublishedDate(result.publishedDate),
          pages: result.pages,
          binding: result.binding,
          cover_url: result.coverUrl?.startsWith("https://") ? result.coverUrl : null,
          open_library_id: result.openLibraryId,
        })
        .select()
        .single();

      if (error) {
        console.error("Wishlist insert failed:", error.message);
        setToast({
          type: "error",
          message:
            error.code === "23505"
              ? "That edition is already on your wishlist."
              : "The book couldn't be added. Try again.",
        });
        return;
      }

      setItems((current) => [data as WishlistItem, ...current]);
      setToast({ type: "success", message: `Added “${result.title}” to your wishlist.` });
    } finally {
      setAddingKey(null);
    }
  }

  // ============================================================
  // Remove
  // ============================================================

  async function removeItem(item: WishlistItem) {
    if (!window.confirm(`Remove “${item.title}” from your wishlist?`)) return;

    setRemovingId(item.id);
    const previous = items;
    setItems((current) => current.filter((i) => i.id !== item.id));

    const { error } = await supabase.from("wishlist").delete().eq("id", item.id).eq("user_id", userId);

    setRemovingId(null);

    if (error) {
      console.error("Wishlist delete failed:", error.message);
      setItems(previous);
      setToast({ type: "error", message: "The book couldn't be removed. Try again." });
      return;
    }

    setToast({ type: "success", message: `Removed “${item.title}”.` });
  }

  // ============================================================
  // Move to library
  // ============================================================

  function openTransfer(item: WishlistItem) {
    stopScanner();
    setTransferItem(item);
    setTransferError("");
    setTStatus("want_to_read");
    setTBoughtFrom("");
    setTTitle(item.title);
    setTAuthor(item.author || "");
    setTPublisher(item.publisher || "");
    setTPublished(item.published_date || "");
    setTPages(item.pages ? String(item.pages) : "");
    setTBinding(item.binding || "");
  }

  async function confirmTransfer(event: FormEvent) {
    event.preventDefault();
    if (!transferItem) return;

    setTransferError("");

    if (!tTitle.trim()) {
      setTransferError("The book needs a title.");
      return;
    }

    const pages = tPages.trim() ? Number(tPages) : null;
    if (pages !== null && (!Number.isInteger(pages) || pages < 1 || pages > 100000)) {
      setTransferError("Pages must be a whole number, like 320.");
      return;
    }

    setTransferring(true);

    try {
      const { data: newBookId, error } = await supabase.rpc("move_wishlist_to_library", {
        p_wishlist_id: transferItem.id,
        p_status: tStatus,
        p_bought_from: tBoughtFrom.trim() || null,
        p_title: tTitle.trim(),
        p_author: tAuthor.trim() || null,
        p_publisher: tPublisher.trim() || null,
        p_published_date: tPublished || null,
        p_pages: pages,
        p_binding: tBinding.trim() || null,
      });

      if (error) {
        console.error("Move to library failed:", error.message);
        setTransferError("The book couldn't be moved to your library. Try again.");
        return;
      }

      const moved = transferItem;
      setItems((current) => current.filter((i) => i.id !== moved.id));
      setLibraryKeys((current) => [
        ...current,
        { isbn13: moved.isbn_13, isbn10: moved.isbn_10, title: tTitle.trim(), author: tAuthor.trim() || null },
      ]);
      setTransferItem(null);
      setToast({
        type: "success",
        message: `“${tTitle.trim()}” is now in your library.`,
        href: newBookId ? `/library/${newBookId}` : "/library",
        linkLabel: "Open it",
      });
    } finally {
      setTransferring(false);
    }
  }

  // ============================================================
  // Derived
  // ============================================================

  const filteredItems = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(term) ||
        (i.author || "").toLowerCase().includes(term) ||
        (i.isbn_13 || "").includes(term) ||
        (i.isbn_10 || "").toLowerCase().includes(term)
    );
  }, [items, filter]);

  // A single ISBN result gets a clear "do I own this?" verdict
  const singleResult = isbnLookup && results?.length === 1 ? results[0] : null;

  // ============================================================
  // Render
  // ============================================================

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a] relative overflow-x-clip">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
            @keyframes sheet-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes scan-line { 0%, 100% { transform: translateY(-44px); } 50% { transform: translateY(44px); } }
            .animate-sheet-in { animation: sheet-in 300ms cubic-bezier(.2,.8,.2,1) both; }
            .animate-scan-line { animation: scan-line 2.2s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) {
              .animate-sheet-in, .animate-scan-line { animation: none; }
            }
          `,
        }}
      />

      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <Navbar isLoggedIn={!!userId || undefined} />

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-6 sm:pt-10 pb-24">
        {/* ---------------- Header ---------------- */}
        <header className="mb-10">
          <h1 className="font-classical text-5xl md:text-6xl font-semibold">Want to Read</h1>
          <p className="mt-4 text-slate-600 font-light text-lg max-w-xl">
            Books you&apos;re hoping to get. When one arrives, move it to your library.
          </p>
        </header>

        {/* ---------------- Search ---------------- */}
        <section
          aria-labelledby="find-heading"
          className="bg-white rounded-3xl border border-[#0f172a]/5 shadow-[0_15px_45px_rgba(15,23,42,0.06)] p-5 sm:p-8 mb-12"
        >
          <h2 id="find-heading" className="font-classical text-2xl font-semibold">
            Find a book
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Search by title, author or ISBN. In a bookshop, scan the barcode to see if you already have it.
          </p>

          <form onSubmit={runSearch} className="mt-5" role="search">
            <label htmlFor="book-search" className="sr-only">
              Title, author or ISBN
            </label>
            <div className="flex items-center gap-2 p-1.5 bg-[#Fdfaf3] border border-slate-200 rounded-2xl focus-within:border-[#7a947c] focus-within:ring-4 focus-within:ring-[#7a947c]/15 transition-all">
              <span aria-hidden="true" className="pl-3 text-slate-400">
                <SearchIcon />
              </span>
              <input
                id="book-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchError("");
                }}
                placeholder="Title, author or ISBN"
                autoComplete="off"
                className="flex-1 min-w-0 h-11 px-2 bg-transparent text-[#0f172a] placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={scanning ? stopScanner : startScanner}
                aria-pressed={scanning}
                aria-label={scanning ? "Stop scanning" : "Scan a barcode"}
                className={`h-11 px-3 sm:px-4 rounded-xl border text-sm font-medium transition-colors inline-flex items-center gap-2 ${focusRing} ${
                  scanning
                    ? "border-[#7a947c] bg-[#7a947c] text-white"
                    : "border-[#7a947c]/50 text-[#4a5c4b] hover:bg-[#7a947c]/10"
                }`}
              >
                <BarcodeIcon />
                <span className="hidden sm:inline">{scanning ? "Stop" : "Scan"}</span>
              </button>
              <button
                type="submit"
                disabled={searching}
                className={`h-11 px-4 sm:px-5 rounded-xl bg-[#0f172a] text-[#Fdfaf3] text-sm font-medium hover:bg-[#7a947c] disabled:opacity-50 transition-colors inline-flex items-center gap-2 ${focusRing}`}
              >
                {searching && <Spinner />}
                {searching ? "Searching" : "Search"}
              </button>
            </div>
          </form>

          {/* ---------------- Camera ----------------
              The video element stays mounted (just hidden) so it always
              exists when ZXing attaches the stream, like the library page. */}
          <div className={scanning ? "mt-5 space-y-3" : "hidden"} aria-hidden={!scanning}>
            <div className="relative overflow-hidden rounded-2xl bg-[#0f172a] aspect-[4/3] sm:aspect-video">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-[80%] max-w-md h-28 rounded-xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] overflow-hidden">
                  <span className="absolute left-3 right-3 top-1/2 h-0.5 bg-[#7a947c] shadow-[0_0_12px_#7a947c] animate-scan-line" />
                </div>
              </div>

              <div className="absolute bottom-3 inset-x-0 text-center px-4">
                <span className="inline-block bg-[#0f172a]/80 text-white text-xs px-4 py-2 rounded-full">
                  Line up the barcode on the back cover inside the frame
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={stopScanner}
              tabIndex={scanning ? 0 : -1}
              className={`w-full h-11 border border-slate-200 text-slate-600 rounded-xl hover:border-[#0f172a] hover:text-[#0f172a] transition-all ${focusRing}`}
            >
              Stop camera
            </button>
          </div>

          {scannerError && (
            <p role="alert" className="mt-4 text-sm text-[#a14e43]">
              {scannerError}
            </p>
          )}

          {searchError && (
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <p role="alert" className="flex-1 text-sm text-[#a14e43]">
                {searchError}
              </p>
              {fromScan && (
                <button
                  type="button"
                  onClick={startScanner}
                  className={`shrink-0 h-10 px-5 rounded-full border border-[#7a947c] text-[#4a5c4b] text-sm font-medium hover:bg-[#7a947c] hover:text-white transition-colors ${focusRing}`}
                >
                  Scan another
                </button>
              )}
            </div>
          )}

          {/* ---------------- Single ISBN verdict ---------------- */}
          {singleResult && (() => {
            const r = singleResult;
            const key = resultKey(r);
            const owned = libraryMatch(r);
            const listed = wishlistMatch(r);
            const adding = addingKey === key;

            const verdict =
              owned === "exact"
                ? { tone: "owned", title: "You already own this", body: "This exact edition is in your library." }
                : owned === "edition"
                ? { tone: "owned", title: "You own another edition", body: "It's in your library with a different ISBN." }
                : listed === "exact"
                ? { tone: "listed", title: "Already on your wishlist", body: "You've been hoping to get this one." }
                : listed === "edition"
                ? { tone: "listed", title: "Another edition is on your wishlist", body: "You wished for a different edition of this book." }
                : { tone: "new", title: "Not in your library", body: "You don't have this book yet." };

            const toneClass =
              verdict.tone === "owned"
                ? "bg-[#eef3ee] border-[#7a947c]/30"
                : verdict.tone === "listed"
                ? "bg-[#d8d0e3]/35 border-[#9a86b9]/30"
                : "bg-[#Fdfaf3] border-[#0f172a]/10";

            const canAdd = listed !== "exact" && owned !== "exact";

            return (
              <div className={`mt-6 rounded-2xl border p-4 sm:p-5 ${toneClass}`} aria-live="polite">
                <div className="flex gap-4">
                  <Cover src={r.coverUrl} title={r.title || "Untitled"} author={r.author} className="w-20 sm:w-24 shrink-0 shadow-md" />

                  <div className="flex-1 min-w-0">
                    <p className="font-classical text-xl sm:text-2xl font-semibold leading-tight">{verdict.title}</p>
                    <p className="text-sm text-slate-600 mt-1">{verdict.body}</p>

                    <div className="mt-3">
                      <p className="font-medium leading-snug line-clamp-2">{r.title}</p>
                      <p className="text-sm text-slate-500 truncate">
                        {[r.author, yearOf(r.publishedDate)].filter(Boolean).join(", ")}
                      </p>
                      {(r.isbn13 || r.isbn10) && (
                        <p className="text-xs text-slate-400 mt-0.5">ISBN {r.isbn13 || r.isbn10}</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-col sm:flex-row gap-2">
                  {canAdd && (
                    <button
                      type="button"
                      onClick={() => addToWishlist(r)}
                      disabled={adding || !r.title}
                      className={`h-11 px-6 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-sm font-medium hover:bg-[#7a947c] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2 ${focusRing}`}
                    >
                      {adding && <Spinner />}
                      {owned === "edition" || listed === "edition" ? "Add this edition to wishlist" : "Add to wishlist"}
                    </button>
                  )}
                  {fromScan && (
                    <button
                      type="button"
                      onClick={startScanner}
                      className={`h-11 px-6 rounded-full border border-[#7a947c] text-[#4a5c4b] text-sm font-medium hover:bg-[#7a947c] hover:text-white transition-colors inline-flex items-center justify-center gap-2 ${focusRing}`}
                    >
                      <BarcodeIcon />
                      Scan another
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearSearch}
                    className={`h-11 px-5 rounded-full text-slate-500 hover:text-[#0f172a] hover:bg-[#0f172a]/5 text-sm transition-colors ${focusRing}`}
                  >
                    Clear
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ---------------- Text search results ---------------- */}
          {!singleResult && results && results.length > 0 && (
            <div className="mt-7">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-slate-500" aria-live="polite">
                  {results.length} {results.length === 1 ? "result" : "results"}
                </p>
                <button
                  type="button"
                  onClick={clearSearch}
                  className={`text-sm text-slate-500 hover:text-[#0f172a] rounded ${focusRing}`}
                >
                  Clear
                </button>
              </div>

              <ul className="divide-y divide-[#0f172a]/5 max-h-[520px] overflow-y-auto -mx-2 px-2">
                {results.map((r) => {
                  const key = resultKey(r);
                  const owned = libraryMatch(r);
                  const listed = wishlistMatch(r);
                  const adding = addingKey === key;

                  const status = owned
                    ? { label: "In your library", kind: owned }
                    : listed
                    ? { label: "On your wishlist", kind: listed }
                    : null;

                  // Offer a second edition only if this exact one isn't already on the wishlist
                  const canAddEdition = status?.kind === "edition" && listed !== "exact";

                  return (
                    <li key={key} className="flex items-center gap-4 py-4">
                      <Cover src={r.coverUrl} title={r.title || "Untitled"} author={r.author} className="w-12 shrink-0 shadow-sm" />

                      <div className="flex-1 min-w-0">
                        <p className="font-classical font-semibold leading-snug line-clamp-2">{r.title}</p>
                        <p className="text-sm text-slate-500 truncate">
                          {[r.author, yearOf(r.publishedDate)].filter(Boolean).join(", ")}
                        </p>
                        {(r.isbn13 || r.isbn10) && (
                          <p className="text-xs text-slate-400 mt-0.5">ISBN {r.isbn13 || r.isbn10}</p>
                        )}
                      </div>

                      {status ? (
                        <div className="shrink-0 flex flex-col items-end gap-1.5 text-right">
                          <span
                            className={`text-xs px-3 py-1.5 rounded-full ${
                              owned ? "bg-[#eef3ee] text-[#4a5c4b]" : "bg-[#d8d0e3]/50 text-[#0f172a]"
                            }`}
                          >
                            {status.label}
                          </span>

                          {status.kind === "edition" && (
                            <span className="text-[11px] text-slate-400">Different edition</span>
                          )}

                          {canAddEdition && (
                            <button
                              type="button"
                              onClick={() => addToWishlist(r)}
                              disabled={adding}
                              aria-label={`Add this edition of ${r.title} to your wishlist`}
                              className={`text-xs text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] disabled:opacity-50 inline-flex items-center gap-1.5 rounded ${focusRing}`}
                            >
                              {adding && <Spinner light={false} />}
                              Add this edition
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToWishlist(r)}
                          disabled={adding || !r.title}
                          aria-label={`Add ${r.title} to your wishlist`}
                          className={`shrink-0 h-10 px-4 rounded-full border border-[#7a947c] text-[#4a5c4b] text-sm font-medium hover:bg-[#7a947c] hover:text-white disabled:opacity-50 transition-colors inline-flex items-center gap-2 ${focusRing}`}
                        >
                          {adding ? <Spinner light={false} /> : <span aria-hidden="true">+</span>}
                          <span className="hidden sm:inline">Add</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {results && results.length === 0 && !searchError && (
            <p className="mt-6 text-sm text-slate-500" aria-live="polite">
              Nothing matched “{query.trim()}”. Try fewer words, or search by the author&apos;s name.
            </p>
          )}
        </section>

        {/* ---------------- Share ---------------- */}
        <div className="mb-12">
          <ShareWishlistCard userId={userId} itemCount={items.length} />
        </div>

        {/* ---------------- Wishlist ---------------- */}
        <section aria-labelledby="wishlist-heading">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
            <div>
              <h2 id="wishlist-heading" className="font-classical text-3xl font-semibold">
                Your wishlist
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {items.length} {items.length === 1 ? "book" : "books"}
              </p>
            </div>

            {items.length > 5 && (
              <div className="sm:w-72">
                <label htmlFor="wishlist-filter" className="sr-only">
                  Filter your wishlist
                </label>
                <input
                  id="wishlist-filter"
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter your wishlist"
                  className="w-full h-11 px-5 bg-white border border-slate-200 rounded-full text-sm placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/15 transition-all"
                />
              </div>
            )}
          </div>

          {loadError && (
            <p role="alert" className="mb-6 px-4 py-3 rounded-xl bg-[#f8e9e5] text-sm text-[#a14e43]">
              {loadError}
            </p>
          )}

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6" aria-busy="true" aria-label="Loading your wishlist">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-lg bg-[#0f172a]/[0.06] animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="bg-white/70 border border-dashed border-[#0f172a]/12 rounded-3xl p-10 sm:p-14 text-center">
              <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-[#d8d0e3]/40 flex items-center justify-center">
                <span className="font-classical text-2xl">A</span>
              </div>
              <h3 className="font-classical text-2xl font-semibold">Nothing on your wishlist yet</h3>
              <p className="text-slate-500 text-sm max-w-sm mx-auto mt-2 leading-6">
                Search above for a book you&apos;d like to read, or scan one in a bookshop.
              </p>
              <button
                type="button"
                onClick={() => document.getElementById("book-search")?.focus()}
                className={`mt-6 h-11 px-6 rounded-full bg-[#7a947c] text-white text-sm font-medium hover:bg-[#6b826c] transition-colors ${focusRing}`}
              >
                Search for a book
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-slate-500">No wishlist books match “{filter.trim()}”.</p>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-5 gap-y-9">
              {filteredItems.map((item) => {
                const owned = libraryMatch(itemAsKeys(item));
                return (
                  <li key={item.id} className="flex flex-col">
                    <Cover src={item.cover_url} title={item.title} author={item.author} className="shadow-md" />

                    <div className="mt-3.5 flex-1">
                      <h3 className="font-classical font-semibold text-[17px] leading-snug line-clamp-2">{item.title}</h3>
                      {item.author && <p className="text-sm text-slate-500 mt-1 line-clamp-1">{item.author}</p>}
                      {owned && (
                        <p className="text-xs text-[#4a5c4b] mt-2">
                          {owned === "exact"
                            ? "You already have this in your library."
                            : "You have another edition in your library."}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => openTransfer(item)}
                        className={`flex-1 h-10 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-xs sm:text-sm font-medium hover:bg-[#7a947c] transition-colors ${focusRing}`}
                        aria-label={`I got ${item.title}. Move it to my library`}
                      >
                        I got it
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item)}
                        disabled={removingId === item.id}
                        aria-label={`Remove ${item.title} from your wishlist`}
                        className={`w-10 h-10 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-[#a14e43] hover:border-[#e0a79d] transition-colors disabled:opacity-50 flex items-center justify-center ${focusRing}`}
                      >
                        <span aria-hidden="true" className="text-lg leading-none">×</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </section>

      {/* ---------------- Move to library modal ---------------- */}
      {transferItem && (
        <div
          className="fixed inset-0 z-50 bg-[#0f172a]/45 backdrop-blur-sm flex items-end sm:items-center justify-center sm:px-5 sm:py-8"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !transferring) setTransferItem(null);
          }}
        >
          <form
            onSubmit={confirmTransfer}
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-title"
            className="w-full sm:max-w-2xl max-h-[94vh] flex flex-col bg-[#Fdfaf3] rounded-t-3xl sm:rounded-3xl shadow-2xl ring-1 ring-[#0f172a]/5 animate-sheet-in"
            noValidate
          >
            <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-5 border-b border-[#0f172a]/5 flex items-start gap-4">
              <Cover src={transferItem.cover_url} title={transferItem.title} author={transferItem.author} className="w-14 shrink-0 shadow-md" />
              <div className="flex-1 min-w-0">
                <h2 id="transfer-title" className="font-classical text-2xl sm:text-3xl font-semibold leading-tight">
                  Move to your library
                </h2>
                <p className="text-sm text-slate-500 mt-1 truncate">{transferItem.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setTransferItem(null)}
                disabled={transferring}
                aria-label="Close"
                className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`}
              >
                <span aria-hidden="true" className="text-2xl leading-none">×</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-7">
              {/* Status */}
              <fieldset>
                <legend className="block text-sm font-medium text-slate-700 mb-2">Reading status</legend>
                <div className="grid grid-cols-3 gap-2">
                  {STATUS_OPTIONS.map((option) => {
                    const checked = tStatus === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`cursor-pointer rounded-2xl border px-3 py-3 text-center transition-all focus-within:ring-2 focus-within:ring-[#7a947c] ${
                          checked
                            ? "border-[#0f172a] bg-[#0f172a] text-[#Fdfaf3]"
                            : "border-slate-200 bg-white text-slate-600 hover:border-[#7a947c]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="transfer-status"
                          value={option.value}
                          checked={checked}
                          onChange={() => setTStatus(option.value)}
                          className="sr-only"
                        />
                        <span className="block text-sm font-medium">{option.label}</span>
                        <span className={`hidden sm:block text-xs mt-0.5 ${checked ? "text-[#Fdfaf3]/60" : "text-slate-400"}`}>
                          {option.hint}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* Bought from */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label htmlFor="t-bought" className="text-sm font-medium text-slate-700">
                    Where did you get it?
                  </label>
                  <span className="text-xs text-slate-400">Optional</span>
                </div>
                <input
                  id="t-bought"
                  type="text"
                  maxLength={120}
                  value={tBoughtFrom}
                  onChange={(e) => setTBoughtFrom(e.target.value)}
                  placeholder="Text Book Centre, a gift, a friend…"
                  className={inputClass}
                />
              </div>

              {/* Book details */}
              <div>
                <h3 className="text-sm font-medium text-slate-700">Book details</h3>
                <p className="text-xs text-slate-400 mt-0.5 mb-3">Check these and fill in anything missing.</p>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="t-title" className="block text-xs text-slate-500 mb-1.5">Title</label>
                    <input id="t-title" type="text" required maxLength={500} value={tTitle} onChange={(e) => setTTitle(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="t-author" className="block text-xs text-slate-500 mb-1.5">Author</label>
                    <input id="t-author" type="text" maxLength={300} value={tAuthor} onChange={(e) => setTAuthor(e.target.value)} placeholder="Missing" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="t-publisher" className="block text-xs text-slate-500 mb-1.5">Publisher</label>
                    <input id="t-publisher" type="text" maxLength={300} value={tPublisher} onChange={(e) => setTPublisher(e.target.value)} placeholder="Missing" className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="t-published" className="block text-xs text-slate-500 mb-1.5">Published</label>
                    <input id="t-published" type="date" value={tPublished} onChange={(e) => setTPublished(e.target.value)} className={inputClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="t-pages" className="block text-xs text-slate-500 mb-1.5">Pages</label>
                      <input id="t-pages" type="number" inputMode="numeric" min={1} max={100000} value={tPages} onChange={(e) => setTPages(e.target.value)} placeholder="—" className={inputClass} />
                    </div>
                    <div>
                      <label htmlFor="t-binding" className="block text-xs text-slate-500 mb-1.5">Binding</label>
                      <input id="t-binding" type="text" maxLength={100} value={tBinding} onChange={(e) => setTBinding(e.target.value)} placeholder="Paperback" className={inputClass} />
                    </div>
                  </div>
                </div>

                {(transferItem.isbn_13 || transferItem.isbn_10) && (
                  <p className="text-xs text-slate-400 mt-3">ISBN {transferItem.isbn_13 || transferItem.isbn_10}</p>
                )}
              </div>

              {transferError && (
                <p role="alert" className="px-4 py-3 rounded-xl bg-[#f8e9e5] text-sm text-[#a14e43]">
                  {transferError}
                </p>
              )}
            </div>

            <div className="px-6 sm:px-8 py-5 border-t border-[#0f172a]/5 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setTransferItem(null)}
                disabled={transferring}
                className={`h-12 px-6 rounded-full text-slate-600 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-all disabled:opacity-50 ${focusRing}`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transferring}
                className={`h-12 px-8 rounded-full bg-[#7a947c] text-white font-medium hover:bg-[#6b826c] disabled:opacity-50 transition-all inline-flex items-center justify-center gap-2 ${focusRing}`}
              >
                {transferring && <Spinner />}
                {transferring ? "Moving…" : "Move to library"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------------- Toast ---------------- */}
      {toast && (
        <div className="fixed bottom-5 inset-x-5 sm:inset-x-auto sm:right-6 sm:bottom-6 z-[60] sm:max-w-sm" role="status" aria-live="polite">
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
            <p className={`flex-1 text-sm ${toast.type === "success" ? "text-[#4a5c4b]" : "text-[#a14e43]"}`}>
              {toast.message}
            </p>
            {toast.href && (
              <Link href={toast.href} className={`shrink-0 text-sm font-medium text-[#0f172a] underline underline-offset-4 rounded ${focusRing}`}>
                {toast.linkLabel}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className={`shrink-0 text-slate-400 hover:text-[#0f172a] text-lg leading-none rounded ${focusRing}`}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function BarcodeIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
    </svg>
  );
}