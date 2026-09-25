"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useRouter } from "next/navigation";

import Navbar from "../components/Navbar";
import { supabase } from "../../lib/supabase";

interface Book {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
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

export default function Library() {
  // --------------------------------------------------
  // Router
  // IMPORTANT: Hooks must be called inside the component
  // --------------------------------------------------

  const router = useRouter();

  // --------------------------------------------------
  // Library
  // --------------------------------------------------

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  // --------------------------------------------------
  // Authentication
  // --------------------------------------------------

  const [userId, setUserId] = useState<string | null>(null);

  // --------------------------------------------------
  // Add book modal
  // --------------------------------------------------

  const [showAddBook, setShowAddBook] = useState(false);

  // --------------------------------------------------
  // ISBN search
  // --------------------------------------------------

  const [isbn, setIsbn] = useState("");
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [searchingBook, setSearchingBook] = useState(false);
  const [bookError, setBookError] = useState("");

  // --------------------------------------------------
  // Barcode scanner
  // --------------------------------------------------

  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const scannerControlsRef = useRef<{
    stop: () => void;
  } | null>(null);

  const hasScannedRef = useRef(false);

  // --------------------------------------------------
  // Book status
  // --------------------------------------------------

  const [status, setStatus] = useState("want_to_read");

  // --------------------------------------------------
  // Where bought
  // --------------------------------------------------

  const [boughtFrom, setBoughtFrom] = useState("");

  // --------------------------------------------------
  // Add book loading state
  // --------------------------------------------------

  const [addingBook, setAddingBook] = useState(false);

  // --------------------------------------------------
  // Library search/filter
  // --------------------------------------------------

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // --------------------------------------------------
  // Fetch books for a specific user
  // --------------------------------------------------

  async function fetchBooksForUser(currentUserId: string) {
    if (!currentUserId) {
      setBooks([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching your books:", error);
        setBooks([]);
        return;
      }

      setBooks(data || []);
    } catch (error) {
      console.error("Unexpected error fetching books:", error);
      setBooks([]);
    }
  }

  // --------------------------------------------------
  // Get authenticated user
  // --------------------------------------------------

  async function getCurrentUser() {
    setLoading(true);

    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("Error getting Supabase session:", error);

        setUserId(null);
        setBooks([]);
        setLoading(false);

        return;
      }

      if (!session?.user) {
        console.log("No authenticated Supabase session found.");

        setUserId(null);
        setBooks([]);
        setLoading(false);

        return;
      }

      const currentUserId = session.user.id;

      console.log("Authenticated user:", session.user);
      console.log("Authenticated user ID:", currentUserId);

      // Update the state
      setUserId(currentUserId);

      // IMPORTANT:
      // Do NOT immediately call fetchBooks() here because
      // setUserId() is asynchronous.
      //
      // Instead, use the ID directly from the session.
      await fetchBooksForUser(currentUserId);
    } catch (error) {
      console.error("Unexpected authentication error:", error);

      setUserId(null);
      setBooks([]);
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // Authentication listener
  // --------------------------------------------------

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      if (!mounted) return;

      await getCurrentUser();
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;

      if (session?.user) {
        const currentUserId = session.user.id;

        console.log(
          "Auth state changed. Current user:",
          currentUserId
        );

        setUserId(currentUserId);
        setLoading(true);

        await fetchBooksForUser(currentUserId);

        if (mounted) {
          setLoading(false);
        }
      } else {
        console.log("User signed out.");

        setUserId(null);
        setBooks([]);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // --------------------------------------------------
  // Stop barcode scanner
  // --------------------------------------------------

  function stopBarcodeScanner() {
    // Stop ZXing's barcode decoding
    if (scannerControlsRef.current) {
      try {
        scannerControlsRef.current.stop();
      } catch (error) {
        console.error("Error stopping scanner:", error);
      }

      scannerControlsRef.current = null;
    }

    // Stop the camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });

      streamRef.current = null;
    }

    // Clear the video element
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // Ignore pause errors during cleanup
      }

      videoRef.current.srcObject = null;
    }

    hasScannedRef.current = false;
    setScanning(false);
  }

  // --------------------------------------------------
  // Clean up barcode scanner when page closes
  // --------------------------------------------------

  useEffect(() => {
    return () => {
      if (scannerControlsRef.current) {
        try {
          scannerControlsRef.current.stop();
        } catch {
          // Ignore cleanup errors
        }

        scannerControlsRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });

        streamRef.current = null;
      }

      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {
          // Ignore cleanup errors
        }

        videoRef.current.srcObject = null;
      }
    };
  }, []);

  // --------------------------------------------------
  // Search for book by ISBN
  // --------------------------------------------------

  async function searchBookByISBN(isbnValue: string) {
    const cleanISBN = isbnValue.replace(/[-\s]/g, "");

    if (!cleanISBN) {
      setBookError("Please enter an ISBN.");
      return;
    }

    if (!/^(?:\d{10}|\d{13})$/.test(cleanISBN)) {
      setBookError("Please enter a valid ISBN-10 or ISBN-13.");
      return;
    }

    setSearchingBook(true);
    setBookError("");
    setScannerError("");
    setBookResult(null);

    try {
      const response = await fetch(
        `/api/books/isbn/${cleanISBN}`
      );

      const data = await response.json();

      if (!response.ok) {
        setBookError(
          data.error || "We couldn't find that book."
        );
        return;
      }

      setBookResult(data);
    } catch (error) {
      console.error("Book search error:", error);

      setBookError(
        "Something went wrong while searching for the book."
      );
    } finally {
      setSearchingBook(false);
    }
  }

  async function searchBook() {
    await searchBookByISBN(isbn);
  }

  // --------------------------------------------------
  // Start barcode scanner
  // --------------------------------------------------

  async function startBarcodeScanner() {
    setScannerError("");
    setBookError("");
    setScanning(true);
    hasScannedRef.current = false;

    try {
      // Check that the browser supports media devices
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setScannerError(
          "Camera access is not supported by this browser. Please enter the ISBN manually."
        );

        setScanning(false);
        return;
      }

      const devices =
        await BrowserMultiFormatReader.listVideoInputDevices();

      if (devices.length === 0) {
        setScannerError(
          "No camera was found. Please enter the ISBN manually."
        );

        setScanning(false);
        return;
      }

      // Prefer the back camera on phones
      const backCamera =
        devices.find((device) => {
          const label = device.label.toLowerCase();

          return (
            label.includes("back") ||
            label.includes("rear") ||
            label.includes("environment")
          );
        }) || devices[0];

      const codeReader = new BrowserMultiFormatReader();

      if (!videoRef.current) {
        setScannerError(
          "The camera could not be initialized. Please try again."
        );

        setScanning(false);
        return;
      }

      const controls =
        await codeReader.decodeFromVideoDevice(
          backCamera.deviceId,
          videoRef.current,
          async (result) => {
            if (!result) {
              return;
            }

            // Prevent multiple searches from the same barcode
            if (hasScannedRef.current) {
              return;
            }

            const scannedValue = result.getText();

            console.log(
              "Scanned barcode:",
              scannedValue
            );

            const cleanBarcode = scannedValue.replace(
              /[-\s]/g,
              ""
            );

            // Ignore barcodes that are not valid ISBNs
            if (
              !/^(?:\d{10}|\d{13})$/.test(cleanBarcode)
            ) {
              setScannerError(
                "The scanned barcode does not look like a valid ISBN. Please try again."
              );

              return;
            }

            // Mark as scanned BEFORE doing anything else
            hasScannedRef.current = true;

            console.log(
              "Detected ISBN:",
              cleanBarcode
            );

            // Stop ZXing's continuous decoding
            if (scannerControlsRef.current) {
              try {
                scannerControlsRef.current.stop();
              } catch {
                // Ignore scanner stop errors
              }

              scannerControlsRef.current = null;
            }

            // Stop the camera
            if (streamRef.current) {
              streamRef.current
                .getTracks()
                .forEach((track) => track.stop());

              streamRef.current = null;
            }

            if (videoRef.current) {
              try {
                videoRef.current.pause();
              } catch {
                // Ignore pause errors
              }

              videoRef.current.srcObject = null;
            }

            setScanning(false);

            // Put the ISBN into the input
            setIsbn(cleanBarcode);

            // Search only ONCE
            await searchBookByISBN(cleanBarcode);
          }
        );

      scannerControlsRef.current = controls;

      // ZXing manages the video stream internally, so capture
      // the stream from the video element when available.
      if (
        videoRef.current &&
        videoRef.current.srcObject instanceof MediaStream
      ) {
        streamRef.current = videoRef.current.srcObject;
      }
    } catch (error) {
      console.error(
        "Barcode scanner error:",
        error
      );

      stopBarcodeScanner();

      setScannerError(
        "We couldn't access your camera. Please allow camera access or enter the ISBN manually."
      );
    }
  }

  // --------------------------------------------------
  // Add book to Supabase
  // --------------------------------------------------

  async function addBookToLibrary() {
    if (!bookResult) {
      setBookError(
        "Please find a book before adding it."
      );
      return;
    }

    if (!bookResult.title) {
      setBookError(
        "This book does not have a title."
      );
      return;
    }

    if (!userId) {
      setBookError(
        "You need to be logged in to add a book."
      );
      return;
    }

    setAddingBook(true);
    setBookError("");

    try {
      console.log(
        "Adding book for user:",
        userId
      );

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
            published_date:
              formatPublishedDate(
                bookResult.publishedDate
              ),
            publisher: bookResult.publisher,
            pages: bookResult.pages,
            cover_url: bookResult.coverUrl,
            open_library_id:
              bookResult.openLibraryId,
            status: status,
            bought_from:
              boughtFrom.trim() || null,
            added_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(
          "Error adding book:",
          error
        );

        setBookError(
          `Could not add the book: ${error.message}`
        );

        return;
      }

      console.log(
        "Book successfully added:",
        data
      );

      if (data) {
        setBooks((currentBooks) => [
          data as Book,
          ...currentBooks,
        ]);
      }

      closeAddBookModal();
    } catch (error) {
      console.error(
        "Unexpected error adding the book:",
        error
      );

      setBookError(
        "Something went wrong while adding the book."
      );
    } finally {
      setAddingBook(false);
    }
  }

  // --------------------------------------------------
  // Convert Open Library date into YYYY-MM-DD
  // --------------------------------------------------

  function formatPublishedDate(
    date: string | null
  ): string | null {
    if (!date) {
      return null;
    }

    // Handle year-only dates such as "2024"
    if (/^\d{4}$/.test(date)) {
      return `${date}-01-01`;
    }

    // Handle year-month dates such as "2024-05"
    if (/^\d{4}-\d{2}$/.test(date)) {
      return `${date}-01`;
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate
      .toISOString()
      .split("T")[0];
  }

  // --------------------------------------------------
  // Close modal and reset search
  // --------------------------------------------------

  function closeAddBookModal() {
    stopBarcodeScanner();

    setShowAddBook(false);
    setBookResult(null);
    setBookError("");
    setScannerError("");
    setIsbn("");
    setStatus("want_to_read");
    setBoughtFrom("");
    setAddingBook(false);
  }

  // --------------------------------------------------
  // Filter books
  // --------------------------------------------------

  const filteredBooks = books.filter((book) => {
    const searchTerm = search
      .trim()
      .toLowerCase();

    const matchesSearch =
      !searchTerm ||
      book.title
        .toLowerCase()
        .includes(searchTerm) ||
      (book.author || "")
        .toLowerCase()
        .includes(searchTerm);

    const matchesFilter =
      filter === "all" ||
      book.status === filter;

    return matchesSearch && matchesFilter;
  });

  // --------------------------------------------------
  // Convert status value to readable label
  // --------------------------------------------------

  function statusLabel(
    bookStatus: string | null
  ) {
    switch (bookStatus) {
      case "reading":
        return "Currently Reading";

      case "finished":
        return "Finished";

      case "want_to_read":
        return "Want to Read";

      default:
        return "Want to Read";
    }
  }

  // --------------------------------------------------
  // Render
  // --------------------------------------------------

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-slate-800 font-sans selection:bg-[#d8d0e3] selection:text-[#0f172a] relative overflow-hidden">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');

            .font-classical {
              font-family: 'Playfair Display', serif;
            }
          `,
        }}
      />

      {/* Background atmosphere */}

      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[#d8d0e3]/20 rounded-full blur-[130px] -z-10 pointer-events-none" />

      <div className="absolute top-[500px] -right-40 w-[600px] h-[600px] bg-[#89a08a]/10 rounded-full blur-[130px] -z-10 pointer-events-none" />

      {/* Navbar */}

      <Navbar isLoggedIn={!!userId} />

      {/* Main Library Content */}

      <section className="max-w-6xl mx-auto px-8 pt-10 pb-24 relative z-10">
        {/* Header */}

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
          <div>
            <p className="uppercase tracking-[0.25em] text-sm text-[#7a947c] font-medium mb-3">
              Your collection
            </p>

            <h1 className="text-5xl md:text-6xl font-classical font-semibold text-[#0f172a]">
              My Library
            </h1>

            <p className="mt-4 text-slate-600 font-light max-w-xl text-lg">
              A home for the books you&apos;ve
              read, are reading, and hope to
              read.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              setShowAddBook(true)
            }
            disabled={!userId}
            className="w-fit bg-[#0f172a] text-[#Fdfaf3] px-7 py-3.5 rounded-full flex items-center gap-3 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-xl">
              +
            </span>

            <span>Add Book</span>
          </button>
        </div>

        {/* Statistics */}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-white border border-[#0f172a]/5 rounded-xl p-6 shadow-sm">
            <p className="text-sm uppercase tracking-wider text-slate-400 mb-2">
              Total Books
            </p>

            <p className="text-3xl font-classical text-[#0f172a]">
              {books.length}
            </p>
          </div>

          <div className="bg-white border border-[#0f172a]/5 rounded-xl p-6 shadow-sm">
            <p className="text-sm uppercase tracking-wider text-slate-400 mb-2">
              Reading
            </p>

            <p className="text-3xl font-classical text-[#0f172a]">
              {
                books.filter(
                  (book) =>
                    book.status ===
                    "reading"
                ).length
              }
            </p>
          </div>

          <div className="bg-white border border-[#0f172a]/5 rounded-xl p-6 shadow-sm">
            <p className="text-sm uppercase tracking-wider text-slate-400 mb-2">
              Finished
            </p>

            <p className="text-3xl font-classical text-[#0f172a]">
              {
                books.filter(
                  (book) =>
                    book.status ===
                    "finished"
                ).length
              }
            </p>
          </div>
        </div>

        {/* Search + Filters */}

        <div className="flex flex-col md:flex-row gap-4 justify-between mb-10">
          <div className="relative w-full md:max-w-md">
            <input
              type="text"
              placeholder="Search your library..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              className="w-full h-12 px-5 bg-white border border-slate-200 rounded-full text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7a947c]/50 focus:border-[#7a947c] transition-all"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {[
              {
                value: "all",
                label: "All Books",
              },
              {
                value: "reading",
                label: "Reading",
              },
              {
                value: "want_to_read",
                label: "Want to Read",
              },
              {
                value: "finished",
                label: "Finished",
              },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() =>
                  setFilter(item.value)
                }
                className={`px-5 py-2.5 rounded-full text-sm transition-all ${
                  filter === item.value
                    ? "bg-[#0f172a] text-[#Fdfaf3]"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-[#7a947c] hover:text-[#7a947c]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Book Grid / Empty State */}

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="w-8 h-8 border-2 border-[#7a947c]/30 border-t-[#7a947c] rounded-full animate-spin" />
          </div>
        ) : filteredBooks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#0f172a]/5 shadow-sm py-24 px-8 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-[#d8d0e3]/30 flex items-center justify-center mb-6">
              <span className="font-classical text-3xl text-[#0f172a]">
                A
              </span>
            </div>

            <h2 className="text-3xl font-classical text-[#0f172a]">
              {books.length > 0
                ? "No books found."
                : "Your shelves are waiting."}
            </h2>

            <p className="text-slate-500 font-light mt-3 max-w-md mx-auto">
              {books.length > 0
                ? "Try changing your search or filter."
                : "Add your first book to begin building your personal archive."}
            </p>

            {books.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  setShowAddBook(true)
                }
                disabled={!userId}
                className="mt-7 bg-[#7a947c] text-[#Fdfaf3] px-7 py-3 rounded-full hover:bg-[#6b826c] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Add Your First Book
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-7">
            {filteredBooks.map((book) => (
              <article
                key={book.id}
                onClick={() =>
                  router.push(
                    `/library/${book.id}`
                  )
                }
                className="group cursor-pointer"
              >
                {/* Book Cover */}

                <div className="aspect-[2/3] bg-[#e9e4d9] rounded-lg overflow-hidden shadow-md group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-300">
                  {book.cover_url ? (
                    <img
                      src={book.cover_url}
                      alt={`Cover of ${book.title}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display =
                          "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full p-6 flex flex-col justify-between bg-[#0f172a] text-[#Fdfaf3]">
                      <div className="text-xs uppercase tracking-[0.2em] opacity-60">
                        The Archive
                      </div>

                      <div>
                        <h3 className="font-classical text-xl leading-tight">
                          {book.title}
                        </h3>

                        {book.author && (
                          <p className="text-sm opacity-70 mt-2">
                            {book.author}
                          </p>
                        )}
                      </div>

                      <div className="text-right font-classical text-xl opacity-50">
                        A
                      </div>
                    </div>
                  )}
                </div>

                {/* Book Details */}

                <div className="mt-4">
                  <h3 className="font-classical font-semibold text-lg text-[#0f172a] leading-tight">
                    {book.title}
                  </h3>

                  {book.author && (
                    <p className="text-sm text-slate-500 mt-1">
                      {book.author}
                    </p>
                  )}

                  <span className="inline-block mt-3 text-xs px-3 py-1 rounded-full bg-[#d8d0e3]/50 text-[#0f172a]">
                    {statusLabel(
                      book.status
                    )}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ADD BOOK MODAL */}

      {showAddBook && (
        <div
          className="fixed inset-0 z-50 bg-[#0f172a]/40 backdrop-blur-sm flex items-center justify-center px-5 py-8 overflow-y-auto"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeAddBookModal();
            }
          }}
        >
          <div className="w-full max-w-2xl bg-[#Fdfaf3] rounded-2xl shadow-2xl p-8 md:p-10">
            {/* Modal Header */}

            <div className="flex items-start justify-between mb-8">
              <div>
                <p className="uppercase tracking-[0.2em] text-xs text-[#7a947c] mb-2">
                  Add to your archive
                </p>

                <h2 className="text-3xl font-classical font-semibold text-[#0f172a]">
                  Add a Book
                </h2>

                <p className="text-slate-500 font-light mt-2">
                  Enter an ISBN or scan the
                  barcode on your book.
                </p>
              </div>

              <button
                type="button"
                onClick={closeAddBookModal}
                className="text-slate-400 hover:text-[#0f172a] text-2xl transition-colors"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* ISBN Search / Barcode Scanner */}

            <div className="space-y-4">
              <label
                htmlFor="isbn"
                className="block text-sm font-medium text-slate-700"
              >
                ISBN
              </label>

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  id="isbn"
                  type="text"
                  value={isbn}
                  onChange={(event) => {
                    setIsbn(
                      event.target.value
                    );
                    setBookError("");
                    setScannerError("");
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      searchBook();
                    }
                  }}
                  placeholder="e.g. 9781399713795"
                  className="flex-1 h-12 px-4 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#7a947c] focus:ring-1 focus:ring-[#7a947c]/30 transition-all"
                />

                <button
                  type="button"
                  onClick={searchBook}
                  disabled={
                    searchingBook ||
                    scanning
                  }
                  className="h-12 px-6 bg-[#0f172a] text-[#Fdfaf3] rounded-lg hover:bg-[#1b2940] disabled:opacity-50 transition-all"
                >
                  {searchingBook
                    ? "Searching..."
                    : "Find Book"}
                </button>
              </div>

              {/* OR divider */}

              <div className="flex items-center gap-3">
                <div className="h-px bg-slate-200 flex-1" />

                <span className="text-xs uppercase tracking-widest text-slate-400">
                  or
                </span>

                <div className="h-px bg-slate-200 flex-1" />
              </div>

              {/* Scan Button / Camera */}

              {!scanning ? (
                <button
                  type="button"
                  onClick={
                    startBarcodeScanner
                  }
                  disabled={searchingBook}
                  className="w-full h-12 border border-[#7a947c] text-[#7a947c] rounded-lg hover:bg-[#7a947c] hover:text-[#Fdfaf3] disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  <span className="text-lg">
                    ▣
                  </span>

                  <span>
                    Scan Book Barcode
                  </span>
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="relative overflow-hidden rounded-xl bg-[#0f172a] aspect-video">
                    <video
                      ref={videoRef}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                    />

                    {/* Scanner guide */}

                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-[75%] h-24 border-2 border-white/80 rounded-lg shadow-lg" />
                    </div>

                    {/* Scanner instruction */}

                    <div className="absolute bottom-3 left-0 right-0 text-center">
                      <span className="inline-block bg-[#0f172a]/80 text-white text-xs px-4 py-2 rounded-full">
                        Point your camera at
                        the book barcode
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={
                      stopBarcodeScanner
                    }
                    className="w-full h-11 border border-slate-200 text-slate-600 rounded-lg hover:border-[#0f172a] hover:text-[#0f172a] transition-all"
                  >
                    Cancel Scan
                  </button>
                </div>
              )}

              <p className="text-xs text-slate-400">
                Enter an ISBN-10 or ISBN-13
                manually, or scan the barcode
                on the back of your book.
              </p>

              {/* Scanner Error */}

              {scannerError && (
                <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
                  {scannerError}
                </div>
              )}
            </div>

            {/* Search Error */}

            {bookError && (
              <div className="mt-5 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm">
                {bookError}
              </div>
            )}

            {/* Book Result */}

            {bookResult && (
              <div className="mt-8 border-t border-[#0f172a]/10 pt-8">
                <p className="uppercase tracking-[0.2em] text-xs text-[#7a947c] mb-5">
                  Book found
                </p>

                <div className="flex flex-col sm:flex-row gap-7">
                  {/* Book Cover */}

                  <div className="w-36 sm:w-40 flex-shrink-0 mx-auto sm:mx-0">
                    <div className="aspect-[2/3] rounded-lg overflow-hidden shadow-md bg-[#e9e4d9]">
                      {bookResult.coverUrl ? (
                        <img
                          src={
                            bookResult.coverUrl
                          }
                          alt={`Cover of ${bookResult.title}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-[#0f172a] text-[#Fdfaf3] p-5 flex flex-col justify-between">
                          <span className="text-xs uppercase tracking-widest opacity-60">
                            The Archive
                          </span>

                          <span className="font-classical text-lg leading-tight">
                            {
                              bookResult.title
                            }
                          </span>

                          <span className="font-classical text-xl opacity-50">
                            A
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Book Details */}

                  <div className="flex-1">
                    <h3 className="text-3xl font-classical font-semibold text-[#0f172a] leading-tight">
                      {bookResult.title}
                    </h3>

                    {bookResult.author && (
                      <p className="text-lg text-slate-600 mt-2">
                        {
                          bookResult.author
                        }
                      </p>
                    )}

                    <div className="mt-6 space-y-3 text-sm">
                      {bookResult.isbn13 && (
                        <div className="flex gap-3">
                          <span className="text-slate-400 w-28">
                            ISBN-13
                          </span>

                          <span className="text-slate-700">
                            {
                              bookResult.isbn13
                            }
                          </span>
                        </div>
                      )}

                      {bookResult.isbn10 && (
                        <div className="flex gap-3">
                          <span className="text-slate-400 w-28">
                            ISBN-10
                          </span>

                          <span className="text-slate-700">
                            {
                              bookResult.isbn10
                            }
                          </span>
                        </div>
                      )}

                      {bookResult.binding && (
                        <div className="flex gap-3">
                          <span className="text-slate-400 w-28">
                            Binding
                          </span>

                          <span className="text-slate-700">
                            {
                              bookResult.binding
                            }
                          </span>
                        </div>
                      )}

                      {bookResult.publishedDate && (
                        <div className="flex gap-3">
                          <span className="text-slate-400 w-28">
                            Published
                          </span>

                          <span className="text-slate-700">
                            {
                              bookResult.publishedDate
                            }
                          </span>
                        </div>
                      )}

                      {bookResult.publisher && (
                        <div className="flex gap-3">
                          <span className="text-slate-400 w-28">
                            Publisher
                          </span>

                          <span className="text-slate-700">
                            {
                              bookResult.publisher
                            }
                          </span>
                        </div>
                      )}

                      {bookResult.pages && (
                        <div className="flex gap-3">
                          <span className="text-slate-400 w-28">
                            Pages
                          </span>

                          <span className="text-slate-700">
                            {
                              bookResult.pages
                            }
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Reading Status */}

                <div className="mt-8">
                  <label
                    htmlFor="status"
                    className="block text-sm font-medium text-slate-700 mb-2"
                  >
                    Reading Status
                  </label>

                  <select
                    id="status"
                    value={status}
                    onChange={(event) =>
                      setStatus(
                        event.target.value
                      )
                    }
                    className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#7a947c] focus:ring-1 focus:ring-[#7a947c]/30"
                  >
                    <option value="want_to_read">
                      Want to Read
                    </option>

                    <option value="reading">
                      Currently Reading
                    </option>

                    <option value="finished">
                      Finished
                    </option>
                  </select>
                </div>

                {/* Where Bought */}

                <div className="mt-5">
                  <label
                    htmlFor="boughtFrom"
                    className="block text-sm font-medium text-slate-700 mb-2"
                  >
                    Where did you buy this
                    book?
                  </label>

                  <input
                    id="boughtFrom"
                    type="text"
                    value={boughtFrom}
                    onChange={(event) =>
                      setBoughtFrom(
                        event.target.value
                      )
                    }
                    placeholder="e.g. Text Book Centre, Amazon, Jumia, Bookstore"
                    className="w-full h-12 px-4 bg-white border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-[#7a947c] focus:ring-1 focus:ring-[#7a947c]/30 transition-all"
                  />

                  <p className="text-xs text-slate-400 mt-2">
                    You can leave this blank
                    if you don&apos;t
                    remember.
                  </p>
                </div>

                {/* Add To Library */}

                <button
                  type="button"
                  onClick={
                    addBookToLibrary
                  }
                  disabled={
                    addingBook || !userId
                  }
                  className="w-full mt-6 bg-[#7a947c] text-[#Fdfaf3] py-3.5 rounded-full hover:bg-[#6b826c] disabled:opacity-50 transition-all"
                >
                  {addingBook
                    ? "Adding to Library..."
                    : "Add to My Library"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}