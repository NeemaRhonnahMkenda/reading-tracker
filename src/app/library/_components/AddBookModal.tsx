// src/app/library/_components/AddBookModal.tsx
// Find a book by ISBN (typed or scanned), optionally add your own cover
// photo, pick a status and shelve it.

"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

import Modal from "../../components/ui/Modal";
import Button, { focusRing } from "../../components/ui/Button";
import { supabase } from "../../../lib/supabase";
import { BOOK_COLUMNS, COVER_BUCKET, type Book } from "../_lib/library";
import BookCover from "./BookCover";
import Alert from "./Alert";

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

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const ISBN_PATTERN = /^(?:\d{10}|\d{9}X|\d{13})$/i;
const ALLOWED_COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const STATUS_OPTIONS = [
  { value: "want_to_read", label: "Want to read", hint: "On the pile" },
  { value: "reading", label: "Reading", hint: "On the nightstand" },
  { value: "finished", label: "Finished", hint: "Back on the shelf" },
] as const;

function cleanIsbn(value: string) {
  return value.replace(/[-\s]/g, "").toUpperCase();
}

function formatPublishedDate(date: string | null): string | null {
  if (!date) return null;
  if (/^\d{4}$/.test(date)) return `${date}-01-01`;
  if (/^\d{4}-\d{2}$/.test(date)) return `${date}-01`;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
}

// Check the real file type from its first bytes instead of trusting file.type
async function sniffImageType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const ascii = String.fromCharCode(...bytes);
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

export default function AddBookModal({
  open,
  userId,
  onClose,
  onAdded,
}: {
  open: boolean;
  userId: string | null;
  onClose: () => void;
  onAdded: (book: Book) => void;
}) {
  const [entryMode, setEntryMode] = useState<EntryMode>("type");

  // ISBN search
  const [isbn, setIsbn] = useState("");
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [searchingBook, setSearchingBook] = useState(false);
  const [bookError, setBookError] = useState("");

  // Scanner
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const hasScannedRef = useRef(false);

  // Cover
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverType, setCoverType] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverError, setCoverError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  // Details
  const [status, setStatus] = useState<string>("want_to_read");
  const [boughtFrom, setBoughtFrom] = useState("");
  const [adding, setAdding] = useState(false);

  // ---------- Camera ----------
  function teardownCamera() {
    try {
      controlsRef.current?.stop();
    } catch {
      // ignore
    }
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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

  useEffect(() => () => teardownCamera(), []);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  // ---------- Reset on close ----------
  function clearCover() {
    setCoverFile(null);
    setCoverType(null);
    setCoverPreview(null);
    setCoverError("");
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  function resetAll() {
    stopScanner();
    clearCover();
    setEntryMode("type");
    setBookResult(null);
    setBookError("");
    setScannerError("");
    setIsbn("");
    setStatus("want_to_read");
    setBoughtFrom("");
  }

  function close(force = false) {
    if (adding && !force) return;
    resetAll();
    onClose();
  }

  // ---------- Search ----------
  async function searchByIsbn(value: string) {
    const clean = cleanIsbn(value);
    if (!clean) return setBookError("Enter an ISBN to search.");
    if (!ISBN_PATTERN.test(clean)) return setBookError("That doesn't look like an ISBN. Use 10 or 13 digits.");

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
    } catch (err) {
      console.error("Book search error:", err);
      setBookError("The book search failed. Check your connection and try again.");
    } finally {
      setSearchingBook(false);
    }
  }

  async function startScanner() {
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

      // Labels are empty before permission; undefined lets ZXing ask for the rear camera
      const back = devices.find((d) => /back|rear|environment/i.test(d.label));

      if (!videoRef.current) {
        setScannerError("The camera couldn't start. Try again.");
        setScanning(false);
        return;
      }

      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromVideoDevice(back?.deviceId, videoRef.current, async (result) => {
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
        await searchByIsbn(scanned);
      });

      if (videoRef.current?.srcObject instanceof MediaStream) streamRef.current = videoRef.current.srcObject;
    } catch (err) {
      console.error("Barcode scanner error:", err);
      stopScanner();
      setScannerError("Camera access was blocked. Allow camera access or type the ISBN instead.");
    }
  }

  function switchMode(mode: EntryMode) {
    if (mode === entryMode) return;
    setEntryMode(mode);
    setScannerError("");
    setBookError("");
    if (mode === "type") stopScanner();
  }

  function searchAgain() {
    clearCover();
    setBookResult(null);
    setBookError("");
    setIsbn("");
  }

  // ---------- Cover ----------
  async function handleCoverFile(file: File | null | undefined) {
    setCoverError("");
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) return setCoverError("That image is over 5 MB. Choose a smaller file.");
    const realType = await sniffImageType(file);
    if (!realType || !ALLOWED_COVER_TYPES[realType]) return setCoverError("Use a JPG, PNG or WebP image.");
    setCoverFile(file);
    setCoverType(realType);
    setCoverPreview(URL.createObjectURL(file));
  }

  async function uploadCover(uid: string): Promise<string | null> {
    if (!coverFile || !coverType) return null;
    const path = `${uid}/${crypto.randomUUID()}.${ALLOWED_COVER_TYPES[coverType]}`;
    const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, coverFile, {
      contentType: coverType,
      cacheControl: "31536000", // unique file names, safe to cache for a year
      upsert: false,
    });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("bucket not found")) console.error(`Storage bucket "${COVER_BUCKET}" does not exist.`);
      else if (msg.includes("row-level security")) console.error("Storage RLS blocked the upload. Check storage.objects policies.");
      else console.error("Cover upload failed:", error.message);
      throw new Error("COVER_UPLOAD_FAILED");
    }
    return path;
  }

  // ---------- Save ----------
  async function addBook() {
    if (!bookResult?.title) return setBookError("Find a book with a title before adding it.");
    if (!userId) return setBookError("Sign in to add books to your library.");

    setAdding(true);
    setBookError("");
    let uploaded: string | null = null;

    try {
      try {
        uploaded = await uploadCover(userId);
      } catch {
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
            custom_cover_path: uploaded,
            open_library_id: bookResult.openLibraryId,
            status,
            bought_from: boughtFrom.trim() || null,
            added_at: new Date().toISOString(),
          },
        ])
        .select(BOOK_COLUMNS)
        .single();

      if (error || !data) {
        console.error("Error adding book:", error?.message);
        if (uploaded) await supabase.storage.from(COVER_BUCKET).remove([uploaded]);
        setBookError("The book couldn't be saved. Try again.");
        return;
      }

      onAdded(data as unknown as Book);
      close(true);
    } catch (err) {
      console.error("Unexpected error adding book:", err);
      if (uploaded) await supabase.storage.from(COVER_BUCKET).remove([uploaded]);
      setBookError("The book couldn't be saved. Try again.");
    } finally {
      setAdding(false);
    }
  }

  const detailRows: [string, string | number | null][] = bookResult
    ? [
        ["ISBN-13", bookResult.isbn13],
        ["ISBN-10", bookResult.isbn10],
        ["Publisher", bookResult.publisher],
        ["Published", bookResult.publishedDate],
        ["Format", bookResult.binding],
        ["Pages", bookResult.pages],
      ]
    : [];

  const previewCover = coverPreview || bookResult?.coverUrl || null;

  return (
    <Modal open={open} onClose={() => close()} labelledBy="add-book-title" size="lg" dismissible={!adding}>
      {/* Header */}
      <div className="px-5 sm:px-9 pt-3 sm:pt-8 pb-5 border-b border-[#0f172a]/[0.06]">
        <div className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full bg-[#0f172a]/15" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="add-book-title" className="font-classical text-2xl sm:text-3xl font-semibold text-[#0f172a]">
              {bookResult ? "Shelve this book" : "Add a book"}
            </h2>
            <p className="mt-1.5 text-sm sm:text-base text-slate-500 font-light">
              {bookResult ? "Add your own cover photo and a few details." : "Find it by ISBN, typed or scanned from the barcode."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => close()}
            disabled={adding}
            aria-label="Close"
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-slate-400 hover:text-[#0f172a] hover:bg-[#0f172a]/5 transition-colors disabled:opacity-40 ${focusRing}`}
          >
            <span aria-hidden="true" className="text-2xl leading-none">×</span>
          </button>
        </div>

        <div className="mt-5 flex items-center gap-2" aria-hidden="true">
          <span className="h-1 flex-1 rounded-full bg-[#7a947c]" />
          <span className={`h-1 flex-1 rounded-full transition-colors duration-500 ${bookResult ? "bg-[#7a947c]" : "bg-[#0f172a]/10"}`} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400">
          <span className={!bookResult ? "text-[#0f172a] font-medium" : ""}>1. Find</span>
          <span className={bookResult ? "text-[#0f172a] font-medium" : ""}>2. Details</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-9 py-6 sm:py-7">
        {!bookResult ? (
          <div className="space-y-5">
            <div role="tablist" aria-label="How to find the book" className="grid grid-cols-2 p-1 rounded-full bg-[#0f172a]/5">
              {(["type", "scan"] as EntryMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={entryMode === mode}
                  onClick={() => switchMode(mode)}
                  className={`h-10 rounded-full text-sm font-medium transition-all ${focusRing} ${
                    entryMode === mode ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"
                  }`}
                >
                  {mode === "type" ? "Type ISBN" : "Scan barcode"}
                </button>
              ))}
            </div>

            {entryMode === "type" ? (
              <div className="space-y-2">
                <label htmlFor="isbn" className="block text-sm font-medium text-slate-700">ISBN</label>
                <div className="flex flex-col min-[420px]:flex-row min-[420px]:items-center gap-2 p-1.5 bg-white border border-[#0f172a]/10 rounded-2xl focus-within:border-[#7a947c] focus-within:ring-4 focus-within:ring-[#7a947c]/10 transition-all">
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
                        searchByIsbn(isbn);
                      }
                    }}
                    placeholder="9781399713795"
                    className="flex-1 min-w-0 h-11 px-3 bg-transparent text-lg tracking-wider text-[#0f172a] placeholder:text-slate-300 focus:outline-none"
                  />
                  <Button variant="dark" onClick={() => searchByIsbn(isbn)} loading={searchingBook} className="rounded-xl">
                    {searchingBook ? "Searching" : "Find book"}
                  </Button>
                </div>
                <p className="text-xs text-slate-400">It&apos;s printed above the barcode or on the copyright page. Dashes are fine.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-2xl bg-[#0f172a] aspect-[4/3] sm:aspect-video">
                  <video ref={videoRef} className={`w-full h-full object-cover ${scanning ? "" : "opacity-0"}`} muted playsInline />
                  {scanning ? (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="relative w-[78%] h-28 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] overflow-hidden">
                          <span className="absolute left-3 right-3 top-1/2 h-0.5 bg-[#7a947c] shadow-[0_0_12px_#7a947c] animate-scan-line" />
                        </div>
                      </div>
                      <div className="absolute bottom-3 inset-x-0 text-center px-4">
                        <span className="inline-block bg-[#0f172a]/80 text-white text-xs px-4 py-2 rounded-full">Hold the barcode inside the frame</span>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-[#fdfaf3] px-6 text-center">
                      <div className="flex gap-[3px] h-10 opacity-70" aria-hidden="true">
                        {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 2].map((w, i) => (
                          <span key={i} className="bg-[#fdfaf3] h-full" style={{ width: w * 2 }} />
                        ))}
                      </div>
                      <p className="text-sm opacity-80 max-w-xs">Your browser will ask for camera access. Nothing is recorded.</p>
                      <Button onClick={startScanner} loading={searchingBook}>
                        {searchingBook ? "Looking up book…" : "Start camera"}
                      </Button>
                    </div>
                  )}
                </div>
                {scanning && (
                  <Button variant="outline" fullWidth onClick={stopScanner}>
                    Stop camera
                  </Button>
                )}
              </div>
            )}

            {scannerError && <Alert>{scannerError}</Alert>}
            {bookError && <Alert>{bookError}</Alert>}
          </div>
        ) : (
          <div className="space-y-7 sm:space-y-8">
            {/* Found book */}
            <div className="flex flex-col sm:flex-row gap-5 sm:gap-7">
              <div className="w-32 sm:w-40 shrink-0 mx-auto sm:mx-0">
                <div className="relative aspect-[2/3] rounded-xl overflow-hidden shadow-lg bg-[#e9e4d9] ring-1 ring-[#0f172a]/10">
                  <BookCover src={previewCover} title={bookResult.title || "Untitled"} author={bookResult.author} size="lg" eager sizes="160px" />
                  {coverPreview && (
                    <span className="absolute top-2 left-2 text-[11px] px-2 py-1 rounded-full bg-[#7a947c] text-white shadow">Your photo</span>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0 text-center sm:text-left">
                <h3 className="font-classical text-2xl sm:text-3xl font-semibold text-[#0f172a] leading-tight break-words">{bookResult.title}</h3>
                {bookResult.author && <p className="text-base sm:text-lg text-slate-600 mt-1.5">{bookResult.author}</p>}

                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-left">
                  {detailRows
                    .filter(([, v]) => v !== null && v !== "")
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
                  disabled={adding}
                  className={`mt-5 text-sm text-[#4a5c4b] hover:text-[#0f172a] underline underline-offset-4 decoration-[#7a947c]/40 transition-colors disabled:opacity-50 rounded ${focusRing}`}
                >
                  Not this book? Search again
                </button>
              </div>
            </div>

            {/* Cover upload */}
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
                className="sr-only"
                onChange={(e) => handleCoverFile(e.target.files?.[0])}
              />

              {coverFile ? (
                <div className="flex items-center gap-3 sm:gap-4 p-3 pr-4 bg-white border border-[#7a947c]/40 rounded-2xl">
                  <div className="w-12 h-16 rounded-md overflow-hidden bg-[#e9e4d9] shrink-0">
                    {coverPreview && <img src={coverPreview} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#0f172a] truncate">{coverFile.name}</p>
                    <p className="text-xs text-slate-400">{(coverFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <label htmlFor="custom-cover" className="text-sm text-[#0f172a] hover:text-[#7a947c] cursor-pointer transition-colors">
                    Replace
                  </label>
                  <button type="button" onClick={clearCover} disabled={adding} className={`text-sm text-slate-400 hover:text-[#a14e43] transition-colors rounded ${focusRing}`}>
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
                  className={`flex items-center gap-4 p-4 sm:p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
                    dragOver ? "border-[#7a947c] bg-[#7a947c]/10" : "border-[#0f172a]/15 bg-white hover:border-[#7a947c] hover:bg-[#7a947c]/5"
                  }`}
                >
                  <span className="w-11 h-11 rounded-full bg-[#7a947c]/15 text-[#7a947c] flex items-center justify-center shrink-0" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[#0f172a]">Upload a photo of your copy</span>
                    <span className="block text-xs text-slate-400 mt-0.5">JPG, PNG or WebP, up to 5 MB. Replaces the catalogue cover on your shelf.</span>
                  </span>
                </label>
              )}
              {coverError && <div className="mt-3"><Alert>{coverError}</Alert></div>}
            </div>

            {/* Status */}
            <fieldset>
              <legend className="block text-sm font-medium text-slate-700 mb-2">Reading status</legend>
              <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
                {STATUS_OPTIONS.map((option) => {
                  const checked = status === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`relative cursor-pointer rounded-2xl border px-3 py-3 text-left min-[420px]:text-center transition-all focus-within:ring-2 focus-within:ring-[#7a947c] ${
                        checked ? "border-[#0f172a] bg-[#0f172a] text-[#fdfaf3]" : "border-[#0f172a]/10 bg-white text-slate-600 hover:border-[#7a947c]"
                      }`}
                    >
                      <input type="radio" name="status" value={option.value} checked={checked} onChange={() => setStatus(option.value)} className="sr-only" />
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className={`block text-xs mt-0.5 ${checked ? "text-[#fdfaf3]/60" : "text-slate-400"}`}>{option.hint}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Where bought */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <label htmlFor="boughtFrom" className="block text-sm font-medium text-slate-700">Where did you buy it?</label>
                <span className="text-xs text-slate-400">Optional</span>
              </div>
              <input
                id="boughtFrom"
                type="text"
                maxLength={120}
                value={boughtFrom}
                onChange={(e) => setBoughtFrom(e.target.value)}
                placeholder="Text Book Centre, Amazon, a friend…"
                className="w-full h-12 px-4 bg-white border border-[#0f172a]/10 rounded-xl text-base sm:text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-4 focus:ring-[#7a947c]/10 transition-all"
              />
            </div>

            {bookError && <Alert>{bookError}</Alert>}
          </div>
        )}
      </div>

      {/* Footer */}
      {bookResult && (
        <div className="px-5 sm:px-9 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-5 border-t border-[#0f172a]/[0.06] flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 sm:justify-end">
          <Button variant="ghost" size="lg" onClick={() => close()} disabled={adding}>
            Cancel
          </Button>
          <Button size="lg" onClick={addBook} loading={adding} disabled={!userId}>
            {adding ? (coverFile ? "Uploading cover…" : "Adding…") : "Add to my library"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
