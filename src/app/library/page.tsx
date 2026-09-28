"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrowserMultiFormatReader } from "@zxing/browser";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

// --------------------------------------------------
// Types
// --------------------------------------------------

interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  custom_cover_path: string | null;
  status: string | null;
  created_at: string;
  added_at: string | null;
  bought_from: string | null;
}

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

type EntryMode = "type" | "scan";

// --------------------------------------------------
// Config
// --------------------------------------------------

// Private Supabase Storage bucket for user-uploaded covers
const COVER_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5 MB
const SIGNED_URL_TTL = 60 * 60; // 1 hour

const ALLOWED_COVER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const STATUS_OPTIONS = [
  { value: "want_to_read", label: "Want to read", hint: "On the wishlist" },
  { value: "reading", label: "Reading", hint: "On the nightstand" },
  { value: "finished", label: "Finished", hint: "Back on the shelf" },
] as const;

const FILTERS = [
  { value: "all", label: "All books" },
  { value: "reading", label: "Reading" },
  { value: "want_to_read", label: "Want to read" },
  { value: "finished", label: "Finished" },
] as const;

const ISBN_PATTERN = /^(?:\d{10}|\d{9}X|\d{13})$/i;

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function cleanIsbn(value: string) {
  return value.replace(/[-\s]/g, "").toUpperCase();
}

function statusLabel(bookStatus: string | null) {
  switch (bookStatus) {
    case "reading":
      return "Currently reading";
    case "finished":
      return "Finished";
    default:
      return "Want to read";
  }
}

// Convert Open Library date into YYYY-MM-DD
function formatPublishedDate(date: string | null): string | null {
  if (!date) return null;
  if (/^\d{4}$/.test(date)) return `${date}-01-01`;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

// Check real file type from magic bytes instead of trusting file.type
async function sniffImageType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  const ascii = String.fromCharCode(...bytes);
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

// --------------------------------------------------
// Book cover with graceful fallback
// --------------------------------------------------

function BookCover({
  src,
  title,
  author,
  size = "md",
}: {
  src: string | null;
  title: string;
  author?: string | null;
  size?: "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={`Cover of ${title}`}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-full h-full p-5 flex flex-col justify-between bg-[#0f172a] text-[#Fdfaf3]">
      <span className="text-[10px] tracking-[0.2em] opacity-50">The Archive</span>
      <div>
        <p
          className={`font-classical leading-tight ${size === "lg" ? "text-xl" : "text-lg"
            }`}
        >
          {title}
        </p>
        {author && <p className="text-xs opacity-70 mt-2">{author}</p>}
      </div>
      <span className="self-end font-classical text-xl opacity-40">A</span>
    </div>
  );
}

// --------------------------------------------------
// Inline alert
// --------------------------------------------------

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm"
    >
      <span aria-hidden="true" className="mt-0.5">!</span>
      <span>{children}</span>
    </div>
  );
}

// ==================================================
// Page
// ==================================================

export default function Library() {
  // Library
  const [books, setBooks] = useState<Book[]>([]);
  const [signedCovers, setSignedCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Auth
  const [userId, setUserId] = useState<string | null>(null);

  // Modal
  const [showAddBook, setShowAddBook] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("type");

  // ISBN search
  const [isbn, setIsbn] = useState("");
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [searchingBook, setSearchingBook] = useState(false);
  const [bookError, setBookError] = useState("");

  // Barcode scanner
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const hasScannedRef = useRef(false);

  // Custom cover
  const [customCoverFile, setCustomCoverFile] = useState<File | null>(null);
  const [customCoverType, setCustomCoverType] = useState<string | null>(null);
  const [customCoverPreview, setCustomCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Book details
  const [status, setStatus] = useState("want_to_read");
  const [boughtFrom, setBoughtFrom] = useState("");
  const [addingBook, setAddingBook] = useState(false);

  // Library search/filter
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // --------------------------------------------------
  // Signed URLs for private custom covers
  // --------------------------------------------------

  const signCoverPaths = useCallback(async (paths: string[]) => {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (unique.length === 0) return;

    const { data, error } = await supabase.storage
      .from(COVER_BUCKET)
      .createSignedUrls(unique, SIGNED_URL_TTL);

    if (error || !data) {
      console.error("Error signing cover URLs:", error);
      return;
    }

    setSignedCovers((current) => {
      const next = { ...current };
      data.forEach((item) => {
        if (item.path && item.signedUrl) next[item.path] = item.signedUrl;
      });
      return next;
    });
  }, []);

  function coverFor(book: Book) {
    if (book.custom_cover_path && signedCovers[book.custom_cover_path]) {
      return signedCovers[book.custom_cover_path];
    }
    return book.cover_url;
  }

  // --------------------------------------------------
  // Fetch books
  // --------------------------------------------------

  const fetchBooksForUser = useCallback(
    async (currentUserId: string) => {
      try {
        const { data, error } = await supabase
          .from("books")
          .select("*")
          .eq("user_id", currentUserId)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error fetching books:", error.message);
          setBooks([]);
          return;
        }

        const rows = (data || []) as Book[];
        setBooks(rows);

        await signCoverPaths(
          rows.map((b) => b.custom_cover_path).filter((p): p is string => !!p)
        );
      } catch (error) {
        console.error("Unexpected error fetching books:", error);
        setBooks([]);
      }
    },
    [signCoverPaths]
  );

  // --------------------------------------------------
  // Auth
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function load(currentUserId: string | null) {
      if (!mounted) return;

      setUserId(currentUserId);

      if (!currentUserId) {
        setBooks([]);
        setSignedCovers({});
        setLoading(false);
        return;
      }

      setLoading(true);
      await fetchBooksForUser(currentUserId);
      if (mounted) setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) console.error("Session error:", error.message);
      load(session?.user?.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Avoid refetching on token refresh
      if (event === "TOKEN_REFRESHED") return;
      load(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchBooksForUser]);

  // --------------------------------------------------
  // Scanner teardown
  // --------------------------------------------------

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

  function stopBarcodeScanner() {
    teardownCamera();
    hasScannedRef.current = false;
    setScanning(false);
  }

  useEffect(() => {
    return () => teardownCamera();
  }, []);

  // --------------------------------------------------
  // Object URL cleanup for cover preview
  // --------------------------------------------------

  useEffect(() => {
    return () => {
      if (customCoverPreview) URL.revokeObjectURL(customCoverPreview);
    };
  }, [customCoverPreview]);

  // --------------------------------------------------
  // Modal: Escape to close + lock background scroll
  // --------------------------------------------------

  useEffect(() => {
    if (!showAddBook) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !addingBook) closeAddBookModal();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddBook, addingBook]);

  // --------------------------------------------------
  // ISBN search
  // --------------------------------------------------

  async function searchBookByISBN(isbnValue: string) {
    const clean = cleanIsbn(isbnValue);

    if (!clean) {
      setBookError("Enter an ISBN to search.");
      return;
    }

    if (!ISBN_PATTERN.test(clean)) {
      setBookError("That doesn't look like an ISBN. Use 10 or 13 digits.");
      return;
    }

    setSearchingBook(true);
    setBookError("");
    setScannerError("");
    setBookResult(null);

    try {
      const response = await fetch(`/api/books/isbn/${encodeURIComponent(clean)}`);
      const data = await response.json();

      if (!response.ok) {
        setBookError(data.error || "No book matches that ISBN. Check the number and try again.");
        return;
      }

      setBookResult(data);
    } catch (error) {
      console.error("Book search error:", error);
      setBookError("The book search failed. Check your connection and try again.");
    } finally {
      setSearchingBook(false);
    }
  }

  // --------------------------------------------------
  // Barcode scanner
  // --------------------------------------------------

  async function startBarcodeScanner() {
    setScannerError("");
    setBookError("");
    setScanning(true);
    hasScannedRef.current = false;

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setScannerError("This browser can't use the camera. Type the ISBN instead.");
        setScanning(false);
        return;
      }

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();

      if (devices.length === 0) {
        setScannerError("No camera found. Type the ISBN instead.");
        setScanning(false);
        return;
      }

      const backCamera =
        devices.find((device) => {
          const label = device.label.toLowerCase();
          return (
            label.includes("back") ||
            label.includes("rear") ||
            label.includes("environment")
          );
        }) || devices[0];

      if (!videoRef.current) {
        setScannerError("The camera couldn't start. Try again.");
        setScanning(false);
        return;
      }

      const codeReader = new BrowserMultiFormatReader();

      const controls = await codeReader.decodeFromVideoDevice(
        backCamera.deviceId,
        videoRef.current,
        async (result) => {
          if (!result || hasScannedRef.current) return;

          const scanned = cleanIsbn(result.getText());

          if (!ISBN_PATTERN.test(scanned)) {
            setScannerError("That barcode isn't an ISBN. Try the barcode on the back cover.");
            return;
          }

          hasScannedRef.current = true;
          teardownCamera();
          setScanning(false);
          setIsbn(scanned);
          await searchBookByISBN(scanned);
        }
      );

      scannerControlsRef.current = controls;

      if (videoRef.current?.srcObject instanceof MediaStream) {
        streamRef.current = videoRef.current.srcObject;
      }
    } catch (error) {
      console.error("Barcode scanner error:", error);
      stopBarcodeScanner();
      setScannerError("Camera access was blocked. Allow camera access or type the ISBN instead.");
    }
  }

  // --------------------------------------------------
  // Custom cover selection
  // --------------------------------------------------

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

    setCustomCoverFile(file);
    setCustomCoverType(realType);
    setCustomCoverPreview(URL.createObjectURL(file));
  }

  function clearCustomCover() {
    setCustomCoverFile(null);
    setCustomCoverType(null);
    setCustomCoverPreview(null);
    setCoverError("");
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  async function uploadCustomCover(currentUserId: string): Promise<string | null> {
    if (!customCoverFile || !customCoverType) return null;

    const extension = ALLOWED_COVER_TYPES[customCoverType];
    // Path starts with the user's ID so storage RLS can scope access
    const path = `${currentUserId}/${crypto.randomUUID()}.${extension}`;

    const { error } = await supabase.storage
      .from(COVER_BUCKET)
      .upload(path, customCoverFile, {
        contentType: customCoverType,
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      const message = error.message.toLowerCase();

      if (message.includes("bucket not found")) {
        console.error(
          `Storage bucket "${COVER_BUCKET}" does not exist in this Supabase project.`
        );
      } else if (message.includes("row-level security")) {
        console.error("Storage RLS blocked the upload. Check the storage.objects policies.");
      } else {
        console.error("Cover upload failed:", error.message);
      }

      throw new Error("COVER_UPLOAD_FAILED");
    }

    return path;
  }

  // --------------------------------------------------
  // Add book
  // --------------------------------------------------

  async function addBookToLibrary() {
    if (!bookResult?.title) {
      setBookError("Find a book with a title before adding it.");
      return;
    }

    if (!userId) {
      setBookError("Sign in to add books to your library.");
      return;
    }

    setAddingBook(true);
    setBookError("");

    let uploadedPath: string | null = null;

    try {
      try {
        uploadedPath = await uploadCustomCover(userId);
      } catch (error) {
        console.error("Cover upload error:", error);
        setCoverError("The cover didn't upload. Try again or remove it to continue.");
        return;
      }

      const { data, error } = await supabase
        .from("books")
        .insert([
          {
            user_id: userId,
            title: bookResult.title,
            author: bookResult.author,
            isbn_10: bookResult.isbn10,
            isbn_13: bookResult.isbn13,
            binding: bookResult.binding,
            published_date: formatPublishedDate(bookResult.publishedDate),
            publisher: bookResult.publisher,
            pages: bookResult.pages,
            cover_url: bookResult.coverUrl,
            custom_cover_path: uploadedPath,
            open_library_id: bookResult.openLibraryId,
            status,
            bought_from: boughtFrom.trim() || null,
            added_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Error adding book:", error.message);

        // Remove the orphaned upload if the row wasn't created
        if (uploadedPath) {
          await supabase.storage.from(COVER_BUCKET).remove([uploadedPath]);
        }

        setBookError("The book couldn't be saved. Try again.");
        return;
      }

      if (data) {
        const newBook = data as Book;
        setBooks((current) => [newBook, ...current]);
        if (newBook.custom_cover_path) {
          await signCoverPaths([newBook.custom_cover_path]);
        }
      }

      closeAddBookModal(true);
    } catch (error) {
      console.error("Unexpected error adding book:", error);
      if (uploadedPath) {
        await supabase.storage.from(COVER_BUCKET).remove([uploadedPath]);
      }
      setBookError("The book couldn't be saved. Try again.");
    } finally {
      setAddingBook(false);
    }
  }

  // --------------------------------------------------
  // Modal controls
  // --------------------------------------------------

  function openAddBookModal() {
    setShowAddBook(true);
    setEntryMode("type");
  }

  function closeAddBookModal(force = false) {
    if (addingBook && !force) return;

    stopBarcodeScanner();
    clearCustomCover();

    setShowAddBook(false);
    setEntryMode("type");
    setBookResult(null);
    setBookError("");
    setScannerError("");
    setIsbn("");
    setStatus("want_to_read");
    setBoughtFrom("");
  }

  function searchAgain() {
    clearCustomCover();
    setBookResult(null);
    setBookError("");
    setIsbn("");
  }

  function switchMode(mode: EntryMode) {
    if (mode === entryMode) return;
    setEntryMode(mode);
    setScannerError("");
    setBookError("");
    if (mode === "type") stopBarcodeScanner();
  }

  // --------------------------------------------------
  // Derived data
  // --------------------------------------------------

  const searchTerm = search.trim().toLowerCase();

  const filteredBooks = books.filter((book) => {
    const matchesSearch =
      !searchTerm ||
      book.title.toLowerCase().includes(searchTerm) ||
      (book.author || "").toLowerCase().includes(searchTerm);

    const matchesFilter = filter === "all" || book.status === filter;
    return matchesSearch && matchesFilter;
  });

  const readingCount = books.filter((b) => b.status === "reading").length;
  const finishedCount = books.filter((b) => b.status === "finished").length;

  const detailRows: [string, string | number | null][] = bookResult
    ? [
      ["ISBN-13", bookResult.isbn13],
      ["ISBN-10", bookResult.isbn10],
      ["Publisher", bookResult.publisher],
      ["Published", bookResult.publishedDate],
      ["Binding", bookResult.binding],
      ["Pages", bookResult.pages],
    ]
    : [];

  const previewCover = customCoverPreview || bookResult?.coverUrl || null;

  const focusRing =
    "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#Fdfaf3]";

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-slate-800 font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] relative overflow-x-clip">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');
            .font-classical { font-family: 'Playfair Display', serif; }
            @keyframes sheet-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
            @keyframes scan-line { 0%, 100% { transform: translateY(-40px); } 50% { transform: translateY(40px); } }
            .animate-sheet-in { animation: sheet-in 320ms cubic-bezier(.2,.8,.2,1) both; }
            .animate-fade-in { animation: fade-in 200ms ease-out both; }
            .animate-scan-line { animation: scan-line 2.2s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) {
              .animate-sheet-in, .animate-fade-in, .animate-scan-line { animation: none; }
            }
          `,
        }}
      />

      {/* Background atmosphere */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />
      <div className="absolute top-[500px] -right-40 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <Navbar isLoggedIn={!!userId} />

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-10 pb-24 relative z-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
          <div>
            <p className="tracking-[0.25em] text-sm text-[#7a947c] font-medium mb-3">
              Your collection
            </p>
            <h1 className="text-5xl md:text-6xl font-classical font-semibold text-[#0f172a]">
              My Library
            </h1>
            <p className="mt-4 text-slate-600 font-light max-w-xl text-lg">
              A home for the books you&apos;ve read, are reading, and hope to read.
            </p>
          </div>

          <button
            type="button"
            onClick={openAddBookModal}
            disabled={!userId}
            className={`w-fit bg-[#0f172a] text-[#Fdfaf3] px-7 py-3.5 rounded-full flex items-center gap-3 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`}
          >
            <span aria-hidden="true" className="text-xl leading-none">+</span>
            <span>Add book</span>
          </button>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {[
            ["Total books", books.length],
            ["Reading", readingCount],
            ["Finished", finishedCount],
          ].map(([label, value]) => (
            <div key={label} className="bg-white border border-[#0f172a]/5 rounded-xl p-6 shadow-sm">
              <p className="text-sm text-slate-400 mb-2">{label}</p>
              <p className="text-3xl font-classical text-[#0f172a]">{value}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col md:flex-row gap-4 justify-between mb-10">
          <div className="relative w-full md:max-w-md">
            <label htmlFor="library-search" className="sr-only">Search your library</label>
            <input
              id="library-search"
              type="search"
              placeholder="Search by title or author"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-12 px-5 bg-white border border-slate-200 rounded-full text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7a947c]/30 focus:border-[#7a947c] transition-all"
            />
          </div>

          <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by status">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className={`px-5 py-2.5 rounded-full text-sm transition-all ${focusRing} ${filter === item.value
                    ? "bg-[#0f172a] text-[#Fdfaf3]"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-[#7a947c] hover:text-[#7a947c]"
                  }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grid / empty state */}
        {loading ? (
          <div className="flex justify-center py-24" aria-label="Loading your library">
            <div className="w-8 h-8 border-2 border-[#7a947c]/30 border-t-[#7a947c] rounded-full animate-spin" />
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#0f172a]/5 shadow-sm py-24 px-8 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-[#d8d0e3]/30 flex items-center justify-center mb-6">
              <span className="font-classical text-3xl text-[#0f172a]">A</span>
            </div>
            <h2 className="text-3xl font-classical text-[#0f172a]">
              {books.length > 0 ? "No books match." : "Your shelves are waiting."}
            </h2>
            <p className="text-slate-500 font-light mt-3 max-w-md mx-auto">
              {books.length > 0
                ? "Change the search or pick another filter."
                : "Add your first book to start your archive."}
            </p>
            {books.length === 0 && (
              <button
                type="button"
                onClick={openAddBookModal}
                disabled={!userId}
                className={`mt-7 bg-[#7a947c] text-[#Fdfaf3] px-7 py-3 rounded-full hover:bg-[#6b826c] disabled:opacity-50 disabled:cursor-not-allowed transition-all ${focusRing}`}
              >
                Add your first book
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-7">
            {filteredBooks.map((book) => (
              <Link
                key={book.id}
                href={`/library/${book.id}`}
                className={`group block rounded-lg ${focusRing}`}
              >
                <div className="aspect-[2/3] bg-[#e9e4d9] rounded-lg overflow-hidden shadow-md group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-300">
                  <BookCover src={coverFor(book)} title={book.title} author={book.author} />
                </div>
                <div className="mt-4">
                  <h3 className="font-classical font-semibold text-lg text-[#0f172a] leading-tight line-clamp-2">
                    {book.title}
                  </h3>
                  {book.author && (
                    <p className="text-sm text-slate-500 mt-1 line-clamp-1">{book.author}</p>
                  )}
                  <span className="inline-block mt-3 text-xs px-3 py-1 rounded-full bg-[#d8d0e3]/50 text-[#0f172a]">
                    {statusLabel(book.status)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ==================================================
          ADD BOOK MODAL
          ================================================== */}

      {showAddBook && (
        <div
          className="fixed inset-0 z-50 bg-[#0f172a]/45 backdrop-blur-sm flex items-end sm:items-center justify-center sm:px-5 sm:py-8 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeAddBookModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-book-title"
            className="w-full sm:max-w-2xl max-h-[94vh] sm:max-h-[90vh] flex flex-col bg-[#Fdfaf3] rounded-t-3xl sm:rounded-3xl shadow-2xl ring-1 ring-[#0f172a]/5 animate-sheet-in"
          >
            {/* Header */}
            <div className="px-6 sm:px-9 pt-6 sm:pt-8 pb-5 border-b border-[#0f172a]/5">
              <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="add-book-title" className="text-3xl font-classical font-semibold text-[#0f172a]">
                    {bookResult ? "Shelve this book" : "Add a book"}
                  </h2>
                  <p className="text-slate-500 font-light mt-1.5">
                    {bookResult
                      ? "Add your own cover photo and a few details."
                      : "Find it by ISBN, typed or scanned from the barcode."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => closeAddBookModal()}
                  disabled={addingBook}
                  aria-label="Close"
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`}
                >
                  <span aria-hidden="true" className="text-2xl leading-none">×</span>
                </button>
              </div>

              {/* Progress: find → details */}
              <div className="mt-5 flex items-center gap-2" aria-hidden="true">
                <span className="h-1 flex-1 rounded-full bg-[#7a947c]" />
                <span
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${bookResult ? "bg-[#7a947c]" : "bg-[#0f172a]/10"
                    }`}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-400">
                <span className={!bookResult ? "text-[#0f172a] font-medium" : ""}>Find</span>
                <span className={bookResult ? "text-[#0f172a] font-medium" : ""}>Details</span>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 sm:px-9 py-7">
              {!bookResult ? (
                // ---------------- Step 1: find ----------------
                <div className="space-y-5">
                  {/* Mode switch */}
                  <div
                    role="tablist"
                    aria-label="How to find the book"
                    className="grid grid-cols-2 p-1 rounded-full bg-[#0f172a]/5"
                  >
                    {(["type", "scan"] as EntryMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="tab"
                        aria-selected={entryMode === mode}
                        onClick={() => switchMode(mode)}
                        className={`h-10 rounded-full text-sm font-medium transition-all ${focusRing} ${entryMode === mode
                            ? "bg-white text-[#0f172a] shadow-sm"
                            : "text-slate-500 hover:text-[#0f172a]"
                          }`}
                      >
                        {mode === "type" ? "Type ISBN" : "Scan barcode"}
                      </button>
                    ))}
                  </div>

                  {entryMode === "type" ? (
                    <div className="space-y-2">
                      <label htmlFor="isbn" className="block text-sm font-medium text-slate-700">
                        ISBN
                      </label>
                      <div className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded-2xl focus-within:border-[#7a947c] focus-within:ring-2 focus-within:ring-[#7a947c]/20 transition-all">
                        <input
                          id="isbn"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          autoFocus
                          value={isbn}
                          onChange={(e) => {
                            setIsbn(e.target.value);
                            setBookError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              searchBookByISBN(isbn);
                            }
                          }}
                          placeholder="9781399713795"
                          className="flex-1 min-w-0 h-11 px-3 bg-transparent text-lg tracking-wider text-[#0f172a] placeholder:text-slate-300 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => searchBookByISBN(isbn)}
                          disabled={searchingBook}
                          className={`h-11 px-5 bg-[#0f172a] text-[#Fdfaf3] rounded-xl text-sm font-medium hover:bg-[#1b2940] disabled:opacity-50 transition-all flex items-center gap-2 ${focusRing}`}
                        >
                          {searchingBook && (
                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          )}
                          {searchingBook ? "Searching" : "Find book"}
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">
                        It&apos;s printed above the barcode or on the copyright page. Dashes are fine.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="relative overflow-hidden rounded-2xl bg-[#0f172a] aspect-[4/3] sm:aspect-video">
                        <video
                          ref={videoRef}
                          className={`w-full h-full object-cover ${scanning ? "" : "opacity-0"}`}
                          muted
                          playsInline
                        />

                        {scanning ? (
                          <>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="relative w-[78%] h-28 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] overflow-hidden">
                                <span className="absolute left-3 right-3 top-1/2 h-0.5 bg-[#7a947c] shadow-[0_0_12px_#7a947c] animate-scan-line" />
                              </div>
                            </div>
                            <div className="absolute bottom-3 inset-x-0 text-center">
                              <span className="inline-block bg-[#0f172a]/80 text-white text-xs px-4 py-2 rounded-full">
                                Hold the barcode inside the frame
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[#Fdfaf3] px-6 text-center">
                            <div className="flex gap-[3px] h-10 opacity-70" aria-hidden="true">
                              {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 2].map((w, i) => (
                                <span key={i} className="bg-[#Fdfaf3] h-full" style={{ width: w * 2 }} />
                              ))}
                            </div>
                            <p className="text-sm opacity-80 max-w-xs">
                              Your browser will ask for camera access. Nothing is recorded.
                            </p>
                            <button
                              type="button"
                              onClick={startBarcodeScanner}
                              disabled={searchingBook}
                              className={`h-11 px-6 rounded-full bg-[#7a947c] text-[#Fdfaf3] text-sm font-medium hover:bg-[#6b826c] disabled:opacity-50 transition-all ${focusRing}`}
                            >
                              {searchingBook ? "Looking up book…" : "Start camera"}
                            </button>
                          </div>
                        )}
                      </div>

                      {scanning && (
                        <button
                          type="button"
                          onClick={stopBarcodeScanner}
                          className={`w-full h-11 border border-slate-200 text-slate-600 rounded-xl hover:border-[#0f172a] hover:text-[#0f172a] transition-all ${focusRing}`}
                        >
                          Stop camera
                        </button>
                      )}
                    </div>
                  )}

                  {scannerError && <Alert>{scannerError}</Alert>}
                  {bookError && <Alert>{bookError}</Alert>}
                </div>
              ) : (
                // ---------------- Step 2: details ----------------
                <div className="space-y-8">
                  {/* Found book */}
                  <div className="flex flex-col sm:flex-row gap-6 sm:gap-7">
                    {/* Cover swap */}
                    <div className="w-40 shrink-0 mx-auto sm:mx-0">
                      <div className="relative aspect-[2/3] rounded-lg overflow-hidden shadow-lg bg-[#e9e4d9] ring-1 ring-[#0f172a]/5">
                        <BookCover
                          src={previewCover}
                          title={bookResult.title || "Untitled"}
                          author={bookResult.author}
                          size="lg"
                        />
                        {customCoverPreview && (
                          <span className="absolute top-2 left-2 text-[11px] px-2 py-1 rounded-full bg-[#7a947c] text-[#Fdfaf3] shadow">
                            Your photo
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-2xl sm:text-3xl font-classical font-semibold text-[#0f172a] leading-tight">
                        {bookResult.title}
                      </h3>
                      {bookResult.author && (
                        <p className="text-lg text-slate-600 mt-1.5">{bookResult.author}</p>
                      )}

                      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        {detailRows
                          .filter(([, value]) => value !== null && value !== "")
                          .map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="text-slate-400 text-xs">{label}</dt>
                              <dd className="text-slate-700 truncate">{value}</dd>
                            </div>
                          ))}
                      </dl>

                      <button
                        type="button"
                        onClick={searchAgain}
                        disabled={addingBook}
                        className={`mt-5 text-sm text-[#7a947c] hover:text-[#0f172a] underline underline-offset-4 decoration-[#7a947c]/40 transition-colors disabled:opacity-50 rounded ${focusRing}`}
                      >
                        Not this book? Search again
                      </button>
                    </div>
                  </div>

                  {/* Custom cover upload */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="block text-sm font-medium text-slate-700">Cover photo</span>
                      <span className="text-xs text-slate-400">Optional</span>
                    </div>

                    <input
                      ref={coverInputRef}
                      id="custom-cover"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      className="sr-only"
                      onChange={(e) => handleCoverFile(e.target.files?.[0])}
                    />

                    {customCoverFile ? (
                      <div className="flex items-center gap-4 p-3 pr-4 bg-white border border-[#7a947c]/40 rounded-2xl">
                        <div className="w-12 h-16 rounded-md overflow-hidden bg-[#e9e4d9] shrink-0">
                          {customCoverPreview && (
                            <img src={customCoverPreview} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#0f172a] truncate">{customCoverFile.name}</p>
                          <p className="text-xs text-slate-400">
                            {(customCoverFile.size / 1024 / 1024).toFixed(1)} MB
                          </p>
                        </div>
                        <label
                          htmlFor="custom-cover"
                          className="text-sm text-[#0f172a] hover:text-[#7a947c] cursor-pointer transition-colors"
                        >
                          Replace
                        </label>
                        <button
                          type="button"
                          onClick={clearCustomCover}
                          disabled={addingBook}
                          className={`text-sm text-slate-400 hover:text-red-600 transition-colors rounded ${focusRing}`}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label
                        htmlFor="custom-cover"
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOver(false);
                          handleCoverFile(e.dataTransfer.files?.[0]);
                        }}
                        className={`flex items-center gap-4 p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${dragOver
                            ? "border-[#7a947c] bg-[#7a947c]/10"
                            : "border-[#0f172a]/15 bg-white hover:border-[#7a947c] hover:bg-[#7a947c]/5"
                          }`}
                      >
                        <span className="w-11 h-11 rounded-full bg-[#7a947c]/15 text-[#7a947c] flex items-center justify-center shrink-0" aria-hidden="true">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                            <circle cx="12" cy="13" r="3.5" />
                          </svg>
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[#0f172a]">
                            Photograph your copy or upload an image
                          </span>
                          <span className="block text-xs text-slate-400 mt-0.5">
                            JPG, PNG or WebP, up to 5 MB. Replaces the catalogue cover on your shelf.
                          </span>
                        </span>
                      </label>
                    )}

                    {coverError && <div className="mt-3"><Alert>{coverError}</Alert></div>}
                  </div>

                  {/* Reading status */}
                  <fieldset>
                    <legend className="block text-sm font-medium text-slate-700 mb-2">
                      Reading status
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {STATUS_OPTIONS.map((option) => {
                        const checked = status === option.value;
                        return (
                          <label
                            key={option.value}
                            className={`relative cursor-pointer rounded-2xl border px-3 py-3 text-center transition-all focus-within:ring-2 focus-within:ring-[#7a947c] ${checked
                                ? "border-[#0f172a] bg-[#0f172a] text-[#Fdfaf3]"
                                : "border-slate-200 bg-white text-slate-600 hover:border-[#7a947c]"
                              }`}
                          >
                            <input
                              type="radio"
                              name="status"
                              value={option.value}
                              checked={checked}
                              onChange={() => setStatus(option.value)}
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

                  {/* Where bought */}
                  <div>
                    <div className="flex items-baseline justify-between mb-2">
                      <label htmlFor="boughtFrom" className="block text-sm font-medium text-slate-700">
                        Where did you buy it?
                      </label>
                      <span className="text-xs text-slate-400">Optional</span>
                    </div>
                    <input
                      id="boughtFrom"
                      type="text"
                      maxLength={120}
                      value={boughtFrom}
                      onChange={(e) => setBoughtFrom(e.target.value)}
                      placeholder="Text Book Centre, Amazon, a friend…"
                      className="w-full h-12 px-4 bg-white border border-slate-200 rounded-xl text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-2 focus:ring-[#7a947c]/20 transition-all"
                    />
                  </div>

                  {bookError && <Alert>{bookError}</Alert>}
                </div>
              )}
            </div>

            {/* Footer (details step only) */}
            {bookResult && (
              <div className="px-6 sm:px-9 py-5 border-t border-[#0f172a]/5 bg-[#Fdfaf3] rounded-b-none sm:rounded-b-3xl flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
                <button
                  type="button"
                  onClick={() => closeAddBookModal()}
                  disabled={addingBook}
                  className={`h-12 px-6 rounded-full text-slate-600 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-all disabled:opacity-50 ${focusRing}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addBookToLibrary}
                  disabled={addingBook || !userId}
                  className={`h-12 px-8 rounded-full bg-[#7a947c] text-[#Fdfaf3] font-medium shadow-sm hover:bg-[#6b826c] hover:shadow-md disabled:opacity-50 transition-all flex items-center justify-center gap-2 ${focusRing}`}
                >
                  {addingBook && (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {addingBook
                    ? customCoverFile
                      ? "Uploading cover…"
                      : "Adding…"
                    : "Add to my library"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}