// src/app/shelves/_lib/match.ts
// Matches noisy spine text to books in your library.
// Spine text often includes the author and publisher too, so we measure how much
// of each title (as letter triples) appears in the spine text, not the other way round.

import type { ShelfBook } from "./shelves";

export interface MatchCandidate {
  bookId: string;
  score: number; // 0..1
}

export type MatchLevel = "likely" | "maybe" | "none";

const STOP = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "by", "with", "novel", "edition", "vol", "volume", "book"]);

export function normalise(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trigrams(text: string) {
  const words = normalise(text)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
  const grams = new Set<string>();
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function containment(needle: Set<string>, haystack: Set<string>) {
  if (needle.size === 0) return 0;
  let hit = 0;
  needle.forEach((g) => haystack.has(g) && hit++);
  return hit / needle.size;
}

export function matchLevel(score: number): MatchLevel {
  if (score >= 0.55) return "likely";
  if (score >= 0.33) return "maybe";
  return "none";
}

interface Indexed {
  id: string;
  title: Set<string>;
  author: Set<string>;
  short: boolean;
}

export function indexBooks(books: ShelfBook[]): Indexed[] {
  return books.map((b) => {
    const title = trigrams(b.title);
    return { id: b.id, title, author: trigrams(b.author ?? ""), short: title.size < 5 };
  });
}

/** Ranked candidates for one spine's text. */
export function rankBooks(text: string, index: Indexed[], limit = 5): MatchCandidate[] {
  const spine = trigrams(text);
  if (spine.size === 0) return [];

  return index
    .map((b) => {
      const titleScore = containment(b.title, spine);
      const authorScore = b.author.size ? containment(b.author, spine) : 0;
      let score = titleScore * 0.8 + authorScore * 0.2;
      if (b.short) score *= 0.85; // very short titles match too easily
      if (titleScore > 0.85 && authorScore > 0.5) score = Math.max(score, 0.9);
      return { bookId: b.id, score };
    })
    .filter((c) => c.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Best book for each spine, never using a book twice. The strongest matches
 * across the whole shelf are assigned first.
 */
export function assignBooks(texts: { index: number; text: string }[], books: ShelfBook[]) {
  const index = indexBooks(books);
  const ranked = texts.map((t) => ({ index: t.index, candidates: rankBooks(t.text, index) }));

  const pairs = ranked.flatMap((r) => r.candidates.map((c) => ({ spine: r.index, ...c })));
  pairs.sort((a, b) => b.score - a.score);

  const usedBooks = new Set<string>();
  const assigned = new Map<number, MatchCandidate>();
  for (const p of pairs) {
    if (p.score < 0.33 || assigned.has(p.spine) || usedBooks.has(p.bookId)) continue;
    assigned.set(p.spine, { bookId: p.bookId, score: p.score });
    usedBooks.add(p.bookId);
  }

  return { assigned, ranked: new Map(ranked.map((r) => [r.index, r.candidates])) };
}
