// src/lib/shelf.ts
// Data for the Reading page: every book with its status, review and progress,
// plus the stats worked out from them.

import { supabase } from "./supabase";
import { displayCover, signCoverPaths } from "./covers";

export type ShelfStatus = "reading" | "want_to_read" | "finished" | "did_not_finish";

export interface ShelfReview {
  rating: number | null;
  finishedYear: number | null;
  finishedMonth: number | null;
  hasText: boolean;
}

export interface ShelfBook {
  id: string;
  title: string;
  author: string | null;
  status: ShelfStatus;
  cover: string | null;
  pages: number | null;
  addedAt: string;
  review: ShelfReview | null;
  furthestPage: number | null;
  progress: number | null; // 0 to 100, when both pages and a position are known
}

export interface YearCount {
  year: number | null; // null = finished, but no date recorded
  count: number;
}

export interface ShelfStats {
  counts: Record<ShelfStatus, number>;
  finishedThisYear: number;
  pagesRead: number;
  avgRating: number | null;
  reviewed: number;
  writtenReviews: number;
  unreviewed: ShelfBook[];
  byYear: YearCount[];
  ratingDist: number[]; // index 0 = 1 to 1.75 stars … 4 = 5 stars
  topAuthors: { author: string; count: number }[];
}

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatFinished(year: number | null | undefined, month: number | null | undefined) {
  if (!year) return "";
  return month ? `${MONTHS_SHORT[month - 1]} ${year}` : String(year);
}

const VALID_STATUS: ShelfStatus[] = ["reading", "want_to_read", "finished", "did_not_finish"];

function normaliseStatus(status: string | null): ShelfStatus {
  return VALID_STATUS.includes(status as ShelfStatus) ? (status as ShelfStatus) : "want_to_read";
}

type BookRow = {
  id: string;
  title: string;
  author: string | null;
  status: string | null;
  cover_url: string | null;
  custom_cover_path: string | null;
  pages: number | null;
  created_at: string;
  added_at: string | null;
};

type ReviewRow = {
  book_id: string;
  rating: number | null;
  finished_year: number | null;
  finished_month: number | null;
  review_text: string | null;
};

// Furthest page per book, from journal notes and diary sessions
async function fetchFurthestPages(bookIds: string[]) {
  const furthest = new Map<string, number>();
  if (bookIds.length === 0) return furthest;

  const bump = (id: string, page: number | null) => {
    if (page == null) return;
    furthest.set(id, Math.max(furthest.get(id) ?? 0, page));
  };

  const [journal, sessions] = await Promise.all([
    supabase.from("book_journal_entries").select("book_id, page_number").in("book_id", bookIds).not("page_number", "is", null),
    supabase.from("reading_sessions").select("book_id, end_page").in("book_id", bookIds).not("end_page", "is", null),
  ]);

  if (journal.error) console.error("Journal progress failed:", journal.error.message);
  else (journal.data as { book_id: string; page_number: number | null }[]).forEach((r) => bump(r.book_id, r.page_number));

  // The diary table is optional; skip quietly if it isn't set up
  if (!sessions.error) (sessions.data as { book_id: string; end_page: number | null }[]).forEach((r) => bump(r.book_id, r.end_page));

  return furthest;
}

export async function loadShelf(userId: string): Promise<ShelfBook[]> {
  const [booksResult, reviewsResult] = await Promise.all([
    supabase
      .from("books")
      .select("id, title, author, status, cover_url, custom_cover_path, pages, created_at, added_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("book_reviews")
      .select("book_id, rating, finished_year, finished_month, review_text")
      .eq("user_id", userId),
  ]);

  if (booksResult.error) throw booksResult.error;
  if (reviewsResult.error) console.error("Reviews failed:", reviewsResult.error.message);

  const rows = (booksResult.data ?? []) as BookRow[];
  const reviews = new Map(((reviewsResult.data ?? []) as ReviewRow[]).map((r) => [r.book_id, r]));

  const readingIds = rows.filter((b) => normaliseStatus(b.status) === "reading" || b.status === "did_not_finish").map((b) => b.id);

  const [signed, furthest] = await Promise.all([
    signCoverPaths(rows.map((b) => b.custom_cover_path)),
    fetchFurthestPages(readingIds),
  ]);

  return rows.map((b) => {
    const review = reviews.get(b.id);
    const furthestPage = furthest.get(b.id) ?? null;
    const progress =
      furthestPage != null && b.pages && b.pages > 0 ? Math.min(100, Math.round((furthestPage / b.pages) * 100)) : null;

    return {
      id: b.id,
      title: b.title,
      author: b.author,
      status: normaliseStatus(b.status),
      cover: displayCover(b.custom_cover_path, b.cover_url, signed),
      pages: b.pages,
      addedAt: b.added_at ?? b.created_at,
      review: review
        ? {
            rating: review.rating != null ? Number(review.rating) : null,
            finishedYear: review.finished_year,
            finishedMonth: review.finished_month,
            hasText: !!review.review_text?.trim(),
          }
        : null,
      furthestPage,
      progress,
    };
  });
}

export function computeStats(books: ShelfBook[], currentYear: number): ShelfStats {
  const counts: Record<ShelfStatus, number> = { reading: 0, want_to_read: 0, finished: 0, did_not_finish: 0 };
  books.forEach((b) => counts[b.status]++);

  const finished = books.filter((b) => b.status === "finished");
  const reviewedBooks = finished.filter((b) => b.review);
  const rated = reviewedBooks.map((b) => b.review!.rating).filter((r): r is number => !!r);

  const yearMap = new Map<number | null, number>();
  finished.forEach((b) => {
    const year = b.review?.finishedYear ?? null;
    yearMap.set(year, (yearMap.get(year) ?? 0) + 1);
  });
  const byYear = Array.from(yearMap, ([year, count]) => ({ year, count })).sort((a, b) => {
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  });

  // Bucket by whole star: 4, 4.25, 4.5 and 4.75 all count as "4"
  const ratingDist = [0, 0, 0, 0, 0];
  rated.forEach((r) => ratingDist[Math.min(5, Math.max(1, Math.floor(r))) - 1]++);

  const authorMap = new Map<string, number>();
  finished.forEach((b) => {
    if (b.author) authorMap.set(b.author, (authorMap.get(b.author) ?? 0) + 1);
  });
  const topAuthors = Array.from(authorMap, ([author, count]) => ({ author, count }))
    .filter((a) => a.count > 1)
    .sort((a, b) => b.count - a.count || a.author.localeCompare(b.author))
    .slice(0, 4);

  return {
    counts,
    finishedThisYear: finished.filter((b) => b.review?.finishedYear === currentYear).length,
    pagesRead: finished.reduce((sum, b) => sum + (b.pages ?? 0), 0),
    avgRating: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
    reviewed: reviewedBooks.length,
    writtenReviews: reviewedBooks.filter((b) => b.review!.hasText).length,
    unreviewed: finished.filter((b) => !b.review),
    byYear,
    ratingDist,
    topAuthors,
  };
}
