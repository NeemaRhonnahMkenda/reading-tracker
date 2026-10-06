// src/lib/routes.ts
// One place that decides which pages need a signed-in user.
// Used by the middleware (server) and the Navbar (browser). No Supabase imports,
// so it's safe to load in the middleware runtime.

export const NAV_LINKS = [
  { href: "/library", label: "My Library" },
  { href: "/reading", label: "Reading" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/family", label: "Family" },
  { href: "/diary", label: "Diary" },
] as const;

// Pages that need a signed-in user (each also covers its sub-pages, e.g. /library/123)
export const PROTECTED_PAGES: readonly string[] = [...NAV_LINKS.map((link) => link.href), "/profile"];

// API routes that need a signed-in user (answered with 401 JSON, not a redirect)
export const PROTECTED_API: readonly string[] = ["/api/books"];

// Signed-in users are sent from these to their library
export const AUTH_PAGES: readonly string[] = ["/login", "/signup"];

export const LOGIN_PATH = "/login";
export const DEFAULT_AFTER_LOGIN = "/library";

function matches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPage(pathname: string) {
  return PROTECTED_PAGES.some((prefix) => matches(pathname, prefix));
}

export function isProtectedApi(pathname: string) {
  return PROTECTED_API.some((prefix) => matches(pathname, prefix));
}

export function isAuthPage(pathname: string) {
  return AUTH_PAGES.some((prefix) => matches(pathname, prefix));
}

// Builds /login?next=/where/you/were
export function loginUrlFor(pathnameWithSearch: string) {
  return `${LOGIN_PATH}?next=${encodeURIComponent(pathnameWithSearch)}`;
}

/**
 * Validates a ?next= value before redirecting to it after sign-in.
 * Only same-site relative paths are allowed, which blocks open redirects
 * like ?next=//evil.com or ?next=https://evil.com.
 */
export function safeNextPath(value: string | null | undefined, fallback = DEFAULT_AFTER_LOGIN) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;

  try {
    const base = "http://archive.local";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    if (isAuthPage(url.pathname)) return fallback; // never bounce back to /login
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}