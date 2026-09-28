// src/app/api/books/search/route.ts
// Title / author search. Tries Open Library first, retries transient
// failures, then falls back to Google Books. Results use the same shape
// as /api/books/isbn/[isbn], with duplicate books removed.

import dns from "node:dns";
import { NextRequest, NextResponse } from "next/server";

// Prefer IPv4: flaky IPv6 routes are a common cause of ECONNRESET in Node fetch
dns.setDefaultResultOrder("ipv4first");

export const runtime = "nodejs";

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

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  isbn?: string[];
  cover_i?: number;
  first_publish_year?: number;
  publisher?: string[];
  number_of_pages_median?: number;
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    pageCount?: number;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

const OL_FIELDS = [
  "key",
  "title",
  "author_name",
  "isbn",
  "cover_i",
  "first_publish_year",
  "publisher",
  "number_of_pages_median",
].join(",");

// Replace the email with yours; Open Library asks for a contact
const USER_AGENT = "TheArchive/1.0 (contact: you@example.com)";

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown) {
  return (
    (error as { cause?: { code?: string } })?.cause?.code ||
    (error as Error)?.name ||
    "unknown"
  );
}

// Remove duplicate books (same ISBN, work, or title + author)
function dedupe(results: BookResult[]) {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key =
      r.isbn13 || r.isbn10 || r.openLibraryId || `${r.title}|${r.author}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// fetch with timeout + retry on dropped connections and 429/5xx
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await sleep(400 * attempt);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      const isTimeout = (error as Error)?.name === "TimeoutError";

      if (attempt < attempts && (isTimeout || (code && RETRYABLE_CODES.has(code)))) {
        await sleep(400 * attempt);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

// --------------------------------------------------
// Providers
// --------------------------------------------------

async function searchOpenLibrary(q: string): Promise<BookResult[]> {
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}` +
    `&limit=20&fields=${OL_FIELDS}`;

  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) throw new Error(`Open Library responded ${response.status}`);

  const data = (await response.json()) as { docs?: OpenLibraryDoc[] };

  return (data.docs ?? [])
    .filter((doc) => doc.title)
    .map((doc) => {
      const isbns = doc.isbn ?? [];
      return {
        title: doc.title ?? null,
        author: doc.author_name?.slice(0, 3).join(", ") ?? null,
        isbn13: isbns.find((i) => /^\d{13}$/.test(i)) ?? null,
        isbn10: isbns.find((i) => /^\d{9}[\dX]$/i.test(i))?.toUpperCase() ?? null,
        publisher: doc.publisher?.[0] ?? null,
        publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : null,
        pages: doc.number_of_pages_median ?? null,
        binding: null,
        coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
        openLibraryId: doc.key?.replace(/^\/works\//, "") ?? null,
      };
    });
}

async function searchGoogleBooks(q: string): Promise<BookResult[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY; // optional, raises the quota
  const url =
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}` +
    `&maxResults=20&printType=books${key ? `&key=${key}` : ""}`;

  const response = await fetchWithRetry(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) throw new Error(`Google Books responded ${response.status}`);

  const data = (await response.json()) as { items?: GoogleVolume[] };

  return (data.items ?? [])
    .map((item) => item.volumeInfo)
    .filter((info): info is NonNullable<GoogleVolume["volumeInfo"]> => !!info?.title)
    .map((info) => {
      const ids = info.industryIdentifiers ?? [];
      const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;

      return {
        title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title ?? null,
        author: info.authors?.slice(0, 3).join(", ") ?? null,
        isbn13: ids.find((i) => i.type === "ISBN_13")?.identifier ?? null,
        isbn10: ids.find((i) => i.type === "ISBN_10")?.identifier?.toUpperCase() ?? null,
        publisher: info.publisher ?? null,
        publishedDate: info.publishedDate ?? null,
        pages: info.pageCount ?? null,
        binding: null,
        // Google returns http thumbnails; the wishlist table only accepts https
        coverUrl: thumb ? thumb.replace(/^http:\/\//, "https://") : null,
        openLibraryId: null,
      };
    });
}

// --------------------------------------------------
// Route
// --------------------------------------------------

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ error: "Type at least 2 characters to search." }, { status: 400 });
  }

  if (q.length > 120) {
    return NextResponse.json(
      { error: "That search is too long. Shorten it and try again." },
      { status: 400 }
    );
  }

  try {
    const results = await searchOpenLibrary(q);
    return NextResponse.json({ results: dedupe(results), source: "openlibrary" });
  } catch (error) {
    console.warn(`Open Library search failed (${errorCode(error)}), trying Google Books`);
  }

  try {
    const results = await searchGoogleBooks(q);
    return NextResponse.json({ results: dedupe(results), source: "google" });
  } catch (error) {
    console.error(`Google Books search failed (${errorCode(error)})`);
    return NextResponse.json(
      { error: "The book catalogues aren't responding right now. Try again in a minute." },
      { status: 502 }
    );
  }
}