// src/lib/supabase.ts
// Browser Supabase client that keeps the session in cookies (not localStorage),
// so the middleware can see who is signed in before a protected page loads.
// Every existing `import { supabase } from ".../lib/supabase"` keeps working.

import { createBrowserClient } from "@supabase/ssr";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
