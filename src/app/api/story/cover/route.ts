// src/app/api/story/cover/route.ts
// GET /api/story/cover?url=https://covers.openlibrary.org/b/id/123-L.jpg
// Serves a book cover from this app's own address, so the story card canvas
// can be saved as an image (browsers block saving a canvas that drew a
// picture from a site that doesn't allow it).
//
// Locked down so it can't be used to fetch anything else:
//   - signed-in users only, rate-limited
//   - https only, to an allowlist of cover hosts (every redirect re-checked)
//   - images only (JPEG, PNG, WebP, GIF), 8 MB at most
// Add hosts with STORY_COVER_HOSTS=host1,host2 in .env.local if your covers
// come from elsewhere.

import { NextRequest, NextResponse } from "next/server";
import { jsonError, rateLimited, requireUser } from "../_lib/auth";

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function allowedHosts(): string[] {
  const hosts = ["covers.openlibrary.org", "archive.org", "books.google.com", "books.googleusercontent.com"];
  try {
    hosts.push(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname);
  } catch {
    // no Supabase URL configured
  }
  (process.env.STORY_COVER_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => /^[a-z0-9.-]+$/.test(h))
    .forEach((h) => hosts.push(h));
  return hosts.filter(Boolean);
}

function isAllowed(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  // An exact host, or a subdomain of one (archive.org serves from ia800...us.archive.org)
  return allowedHosts().some((h) => host === h || host.endsWith(`.${h}`));
}

export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const limited = rateLimited(`cover:${user.id}`, 30, 30);
  if (limited) return limited;

  const raw = request.nextUrl.searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return jsonError("That isn't a valid image address.", 400);
  }
  if (raw.length > 2000 || !isAllowed(url)) return jsonError("Covers from that site can't be used on story cards.", 400);

  try {
    // Follow redirects by hand so each hop is checked against the allowlist
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), headers: { Accept: "image/*" }, cache: "no-store" });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get("location");
        if (!next) break;
        url = new URL(next, url);
        if (!isAllowed(url)) return jsonError("That cover redirected somewhere that isn't allowed.", 400);
        continue;
      }
      break;
    }
    if (!res || !res.ok || !res.body) return jsonError("The cover couldn't be loaded.", 502);

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(type)) return jsonError("That address isn't an image.", 415);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return jsonError("That cover is too large.", 413);

    // Read with a hard cap, whatever the headers said
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return jsonError("That cover is too large.", 413);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.byteLength;
    }

    return new NextResponse(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return jsonError("The cover couldn't be loaded.", 502);
  }
}
