// src/middleware.ts
// Runs before every page and API request. Pages behind login redirect to /login
// (and come back afterwards); protected API routes answer 401.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_AFTER_LOGIN, isAuthPage, isProtectedApi, isProtectedPage, loginUrlFor } from "./lib/routes";

const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  let authHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // Refreshed session cookies must reach both the page and the browser
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          authHeaders = headers;
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    }
  );

  // getUser() checks the token with Supabase Auth. Don't use getSession() here:
  // it only reads the cookie, which the browser controls.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Carries refreshed cookies and cache headers over to a redirect or error response
  function withSession<T extends NextResponse>(next: T) {
    response.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
    Object.entries(authHeaders).forEach(([key, value]) => next.headers.set(key, value));
    return next;
  }

  // Protected API: 401, never a redirect (fetch would follow it to the login HTML)
  if (!user && isProtectedApi(pathname)) {
    return withSession(
      NextResponse.json({ error: "Sign in to use this." }, { status: 401, headers: { "Cache-Control": NO_STORE } })
    );
  }

  // Protected page: go to /login, then come back here
  if (!user && isProtectedPage(pathname)) {
    const url = new URL(loginUrlFor(`${pathname}${search}`), request.url);
    return withSession(NextResponse.redirect(url));
  }

  // Already signed in: skip the login page
  if (user && isAuthPage(pathname)) {
    return withSession(NextResponse.redirect(new URL(DEFAULT_AFTER_LOGIN, request.url)));
  }

  // Private pages must not be stored by shared caches or the back/forward cache after sign-out
  if (isProtectedPage(pathname) || isProtectedApi(pathname)) {
    response.headers.set("Cache-Control", NO_STORE);
  }

  return response;
}

export const config = {
  // Everything except static files and images
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};