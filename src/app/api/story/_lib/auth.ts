// src/app/api/story/_lib/auth.ts
// Who is asking, and a small per-person rate limit, for the story card routes.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function requireUser(): Promise<User | NextResponse> {
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: () => {
        // read-only here; the proxy/middleware refreshes the session
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? jsonError("Sign in to use this.", 401);
}

const buckets = new Map<string, { tokens: number; at: number }>();

/** Token bucket per person and route: `capacity` requests, refilling `perMinute`. */
export function rateLimited(key: string, capacity: number, perMinute: number): NextResponse | null {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  if (b.tokens < 1) return jsonError("Too many requests. Wait a moment and try again.", 429);
  b.tokens -= 1;
  return null;
}
