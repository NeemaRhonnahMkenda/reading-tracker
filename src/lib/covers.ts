// src/lib/covers.ts
// Signs private cover photos (custom_cover_path) in one request and picks the
// cover to show: your photo first, the catalogue cover as the fallback.

import { supabase } from "./supabase";

const COVER_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_COVER_BUCKET || "book-covers";
const SIGNED_URL_TTL = 60 * 60; // 1 hour
const SIGNED_URL_MIN_REMAINING = 5 * 60 * 1000; // re-sign under 5 minutes left

// Reused between calls so the browser can cache the images
const signedCoverCache = new Map<string, { url: string; expiresAt: number }>();

export async function signCoverPaths(paths: (string | null | undefined)[]) {
  const now = Date.now();
  const unique = Array.from(new Set(paths.filter((p): p is string => !!p)));
  const result = new Map<string, string>();
  const missing: string[] = [];

  for (const path of unique) {
    const cached = signedCoverCache.get(path);
    if (cached && cached.expiresAt - now > SIGNED_URL_MIN_REMAINING) result.set(path, cached.url);
    else missing.push(path);
  }

  if (missing.length === 0) return result;

  const { data, error } = await supabase.storage.from(COVER_BUCKET).createSignedUrls(missing, SIGNED_URL_TTL);

  if (error || !data) {
    console.error("Error signing cover photos:", error?.message);
    return result; // those books fall back to their catalogue cover
  }

  const expiresAt = Date.now() + SIGNED_URL_TTL * 1000;
  for (const item of data) {
    if (item.path && item.signedUrl) {
      signedCoverCache.set(item.path, { url: item.signedUrl, expiresAt });
      result.set(item.path, item.signedUrl);
    }
  }
  return result;
}

export function displayCover(customPath: string | null | undefined, coverUrl: string | null, signed: Map<string, string>) {
  return (customPath && signed.get(customPath)) || coverUrl || null;
}
