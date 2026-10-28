// src/lib/supabase.ts
// Browser Supabase client that keeps the session in cookies (not localStorage),
// so the middleware can see who is signed in before a protected page loads.
// Every existing `import { supabase } from ".../lib/supabase"` keeps working.

import { createBrowserClient } from "@supabase/ssr";

// A token is stamped with the time the Auth server issued it. If the database
// API's clock is slightly behind, it rejects a brand-new token as "issued in the
// future" (usually right after signing in). The same request succeeds a moment
// later, so wait briefly and retry instead of failing the page.
const SKEW_RETRIES = 3;
const SKEW_MESSAGE = "JWT issued at future";

async function fetchWithClockSkewRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(input, init);
    if (response.status !== 401 || attempt >= SKEW_RETRIES) return response;

    const body = await response
      .clone()
      .text()
      .catch(() => "");
    if (!body.includes(SKEW_MESSAGE)) return response;

    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
}

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { global: { fetch: fetchWithClockSkewRetry } }
);