"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { supabase } from "../../lib/supabase";

// --------------------------------------------------
// Config
// --------------------------------------------------

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const ACTIVITY_THROTTLE = 1000; // reset timer at most once per second

const ACTIVITY_EVENTS = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
] as const;

const NAV_LINKS = [
    { href: "/library", label: "My Library" },
    { href: "/reading", label: "Reading" },
    { href: "/wishlist", label: "Wishlist" },
    { href: "/family", label: "Family" },
] as const;

// Palette (unchanged)
// navy  #0f172a  | cream #Fdfaf3 | sage #7a947c

// --------------------------------------------------
// Shared auth status
//
// Lives at module scope, so it survives page navigations. The first
// page load resolves it once; every Navbar mounted after that starts
// with the known status and never flashes the signed-out view.
// --------------------------------------------------

type AuthStatus = "unknown" | "signed-in" | "signed-out";

let authStatus: AuthStatus = "unknown";
let watcherStarted = false;
const subscribers = new Set<() => void>();

function setAuthStatus(next: AuthStatus) {
    if (authStatus === next) return;
    authStatus = next;
    subscribers.forEach((notify) => notify());
}

function startAuthWatcher() {
    if (watcherStarted || typeof window === "undefined") return;
    watcherStarted = true;

    supabase.auth.getSession().then(({ data }) => {
        setAuthStatus(data.session ? "signed-in" : "signed-out");
    });

    supabase.auth.onAuthStateChange((_event, session) => {
        setAuthStatus(session ? "signed-in" : "signed-out");
    });
}

function subscribe(notify: () => void) {
    startAuthWatcher();
    subscribers.add(notify);
    return () => {
        subscribers.delete(notify);
    };
}

const getSnapshot = () => authStatus;
const getServerSnapshot = (): AuthStatus => "unknown";

/**
 * `hint` lets a page that already knows the user is signed in skip the
 * brief "unknown" state. A false hint is ignored, because pages pass
 * false while they are still loading.
 */
function useAuthStatus(hint?: boolean): AuthStatus {
    const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    if (status === "unknown" && hint) return "signed-in";
    return status;
}

// --------------------------------------------------
// Component
// --------------------------------------------------

interface NavbarProps {
    /** Optional. Navbar resolves auth itself; `true` only skips the placeholder. */
    isLoggedIn?: boolean;
}

export default function Navbar({ isLoggedIn }: NavbarProps) {
    const router = useRouter();
    const pathname = usePathname();

    const status = useAuthStatus(isLoggedIn);
    const signedIn = status === "signed-in";
    const resolving = status === "unknown";

    const [menuOpen, setMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState<string | null>(null);

    const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastActivityRef = useRef(0);

    const isActive = (href: string) =>
        pathname === href || pathname?.startsWith(`${href}/`);

    // --------------------------------------------------
    // Logout
    // --------------------------------------------------

    const handleLogout = useCallback(async () => {
        if (inactivityTimerRef.current) {
            clearTimeout(inactivityTimerRef.current);
            inactivityTimerRef.current = null;
        }

        setLoggingOut(true);
        setLogoutError(null);

        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error("Logout error:", error.message);
            setLogoutError("Sign out failed. Try again.");
            setLoggingOut(false);
            return;
        }

        setAuthStatus("signed-out");
        setMenuOpen(false);
        setLoggingOut(false);
        router.replace("/login");
        router.refresh();
    }, [router]);

    // Keep latest handler in a ref so the inactivity effect
    // never calls a stale closure and never needs to re-subscribe.
    const logoutRef = useRef(handleLogout);
    useEffect(() => {
        logoutRef.current = handleLogout;
    }, [handleLogout]);

    // --------------------------------------------------
    // Automatic logout after inactivity (throttled)
    // --------------------------------------------------

    useEffect(() => {
        if (!signedIn) return;

        const startTimer = () => {
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
            }
            inactivityTimerRef.current = setTimeout(() => {
                logoutRef.current();
            }, INACTIVITY_TIMEOUT);
        };

        const onActivity = () => {
            const now = Date.now();
            if (now - lastActivityRef.current < ACTIVITY_THROTTLE) return;
            lastActivityRef.current = now;
            startTimer();
        };

        ACTIVITY_EVENTS.forEach((event) =>
            window.addEventListener(event, onActivity, { passive: true })
        );

        startTimer();

        return () => {
            if (inactivityTimerRef.current) {
                clearTimeout(inactivityTimerRef.current);
                inactivityTimerRef.current = null;
            }
            ACTIVITY_EVENTS.forEach((event) =>
                window.removeEventListener(event, onActivity)
            );
        };
    }, [signedIn]);

    // --------------------------------------------------
    // Scroll state for sticky bar styling
    // --------------------------------------------------

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 8);
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    // --------------------------------------------------
    // Mobile menu behaviour
    // --------------------------------------------------

    // Close on route change
    useEffect(() => {
        setMenuOpen(false);
    }, [pathname]);

    // Escape to close + lock page scroll while open
    useEffect(() => {
        if (!menuOpen) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMenuOpen(false);
        };

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", onKey);
        };
    }, [menuOpen]);

    const closeMenu = () => setMenuOpen(false);

    // --------------------------------------------------
    // Shared styles
    // --------------------------------------------------

    const focusRing =
        "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#Fdfaf3]";

    return (
        <header
            className={`sticky top-0 z-30 transition-[background-color,box-shadow,backdrop-filter] duration-300 ${
                scrolled || menuOpen
                    ? "bg-[#Fdfaf3]/85 backdrop-blur-md shadow-[0_1px_0_rgba(15,23,42,0.06)]"
                    : "bg-transparent"
            }`}
        >
            <nav
                aria-label="Main"
                aria-busy={resolving || undefined}
                className={`max-w-6xl mx-auto px-5 sm:px-8 transition-[padding] duration-300 ${
                    scrolled ? "py-3 sm:py-4" : "py-5 sm:py-7"
                }`}
            >
                <div className="flex items-center justify-between gap-6">
                    {/* Logo */}
                    <Link
                        href="/"
                        onClick={closeMenu}
                        className={`group flex items-center gap-3 sm:gap-4 rounded-full ${focusRing}`}
                    >
                        <span
                            aria-hidden="true"
                            className="relative w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#0f172a] flex items-center justify-center text-[#Fdfaf3] text-xl sm:text-2xl font-classical font-semibold shadow-sm ring-1 ring-[#0f172a]/10 transition-transform duration-300 group-hover:-rotate-6"
                        >
                            A
                            {/* bookmark ribbon */}
                            <span className="absolute -bottom-1 right-1.5 w-2 h-3.5 bg-[#7a947c] [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)] transition-transform duration-300 group-hover:translate-y-0.5" />
                        </span>

                        <span className="text-xl sm:text-2xl font-classical font-semibold text-[#0f172a] tracking-wide">
                            The Archive
                        </span>
                    </Link>

                    {/* Desktop navigation */}
                    {resolving ? (
                        // Placeholder with the same footprint as the signed-in bar,
                        // so nothing jumps when the real links appear.
                        <div aria-hidden="true" className="hidden md:flex items-center gap-1 lg:gap-2">
                            {[88, 64, 96, 56].map((width) => (
                                <span
                                    key={width}
                                    className="mx-3 h-3.5 rounded-full bg-[#0f172a]/[0.07] animate-pulse"
                                    style={{ width }}
                                />
                            ))}
                            <span className="mx-3 h-6 w-px bg-[#0f172a]/10" />
                            <span className="w-10 h-10 rounded-full bg-[#0f172a]/[0.07] animate-pulse" />
                            <span className="ml-2 w-[86px] h-9 rounded-full bg-[#0f172a]/[0.07] animate-pulse" />
                        </div>
                    ) : signedIn ? (
                        <div className="hidden md:flex items-center gap-1 lg:gap-2">
                            <ul className="flex items-center gap-1 lg:gap-2">
                                {NAV_LINKS.map(({ href, label }) => {
                                    const active = isActive(href);
                                    return (
                                        <li key={href}>
                                            <Link
                                                href={href}
                                                aria-current={active ? "page" : undefined}
                                                className={`relative px-3 py-2 rounded-md font-medium tracking-wide transition-colors ${focusRing} ${
                                                    active
                                                        ? "text-[#0f172a]"
                                                        : "text-[#0f172a]/70 hover:text-[#7a947c]"
                                                }`}
                                            >
                                                {label}
                                                <span
                                                    aria-hidden="true"
                                                    className={`absolute left-3 right-3 -bottom-0.5 h-0.5 rounded-full bg-[#7a947c] origin-left transition-transform duration-300 ${
                                                        active ? "scale-x-100" : "scale-x-0"
                                                    }`}
                                                />
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>

                            <span aria-hidden="true" className="mx-3 h-6 w-px bg-[#0f172a]/10" />

                            <Link
                                href="/profile"
                                aria-current={isActive("/profile") ? "page" : undefined}
                                aria-label="Profile"
                                className={`w-10 h-10 rounded-full border flex items-center justify-center transition-colors ${focusRing} ${
                                    isActive("/profile")
                                        ? "border-[#7a947c] bg-[#7a947c]/10 text-[#0f172a]"
                                        : "border-[#0f172a]/15 text-[#0f172a] hover:border-[#7a947c] hover:text-[#7a947c]"
                                }`}
                            >
                                <UserIcon />
                            </Link>

                            <button
                                type="button"
                                onClick={handleLogout}
                                disabled={loggingOut}
                                className={`ml-2 px-4 py-2 rounded-full bg-[#0f172a] text-[#Fdfaf3] text-sm font-medium tracking-wide transition-colors hover:bg-[#7a947c] disabled:opacity-60 disabled:cursor-wait ${focusRing}`}
                            >
                                {loggingOut ? "Signing out…" : "Sign out"}
                            </button>
                        </div>
                    ) : (
                        <Link
                            href="/login"
                            className={`hidden md:inline-flex px-5 py-2.5 rounded-full bg-[#0f172a] text-[#Fdfaf3] font-medium tracking-wide transition-colors hover:bg-[#7a947c] ${focusRing}`}
                        >
                            Sign in
                        </Link>
                    )}

                    {/* Mobile menu button */}
                    {resolving ? (
                        <span
                            aria-hidden="true"
                            className="md:hidden w-11 h-11 rounded-full bg-[#0f172a]/[0.07] animate-pulse"
                        />
                    ) : (
                        <button
                            type="button"
                            onClick={() => setMenuOpen((open) => !open)}
                            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                            aria-expanded={menuOpen}
                            aria-controls="mobile-nav"
                            className={`md:hidden relative w-11 h-11 rounded-full border border-[#0f172a]/15 bg-white flex items-center justify-center text-[#0f172a] hover:border-[#7a947c] transition-colors ${focusRing}`}
                        >
                            <span aria-hidden="true" className="relative block w-5 h-3.5">
                                <span
                                    className={`absolute left-0 w-5 h-px bg-[#0f172a] transition-all duration-300 ${
                                        menuOpen ? "top-1/2 rotate-45" : "top-0"
                                    }`}
                                />
                                <span
                                    className={`absolute left-0 top-1/2 w-5 h-px bg-[#0f172a] transition-opacity duration-200 ${
                                        menuOpen ? "opacity-0" : "opacity-100"
                                    }`}
                                />
                                <span
                                    className={`absolute left-0 w-5 h-px bg-[#0f172a] transition-all duration-300 ${
                                        menuOpen ? "top-1/2 -rotate-45" : "top-full"
                                    }`}
                                />
                            </span>
                        </button>
                    )}
                </div>

                {logoutError && (
                    <p role="alert" className="mt-3 text-sm text-red-700 md:text-right">
                        {logoutError}
                    </p>
                )}

                {/* Mobile navigation */}
                {!resolving && (
                    <div
                        id="mobile-nav"
                        className={`md:hidden grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                            menuOpen
                                ? "grid-rows-[1fr] opacity-100 mt-4"
                                : "grid-rows-[0fr] opacity-0 pointer-events-none"
                        }`}
                        inert={!menuOpen ? true : undefined}
                    >
                        <div className="overflow-hidden">
                            <div className="bg-white rounded-2xl border border-[#0f172a]/5 shadow-lg p-2">
                                {signedIn ? (
                                    <ul className="flex flex-col">
                                        {[...NAV_LINKS, { href: "/profile", label: "Profile" }].map(
                                            ({ href, label }) => {
                                                const active = isActive(href);
                                                return (
                                                    <li key={href}>
                                                        <Link
                                                            href={href}
                                                            onClick={closeMenu}
                                                            aria-current={active ? "page" : undefined}
                                                            className={`flex items-center gap-3 px-4 py-3.5 rounded-xl font-medium transition-colors ${focusRing} ${
                                                                active
                                                                    ? "bg-[#Fdfaf3] text-[#0f172a]"
                                                                    : "text-[#0f172a]/80 hover:bg-[#Fdfaf3] hover:text-[#7a947c]"
                                                            }`}
                                                        >
                                                            <span
                                                                aria-hidden="true"
                                                                className={`w-1 h-5 rounded-full transition-colors ${
                                                                    active ? "bg-[#7a947c]" : "bg-transparent"
                                                                }`}
                                                            />
                                                            {label}
                                                        </Link>
                                                    </li>
                                                );
                                            }
                                        )}

                                        <li aria-hidden="true" className="h-px bg-[#0f172a]/5 my-2 mx-2" />

                                        <li>
                                            <button
                                                type="button"
                                                onClick={handleLogout}
                                                disabled={loggingOut}
                                                className={`w-full text-center px-4 py-3.5 rounded-xl bg-[#0f172a] text-[#Fdfaf3] font-medium transition-colors hover:bg-[#7a947c] disabled:opacity-60 ${focusRing}`}
                                            >
                                                {loggingOut ? "Signing out…" : "Sign out"}
                                            </button>
                                        </li>
                                    </ul>
                                ) : (
                                    <Link
                                        href="/login"
                                        onClick={closeMenu}
                                        className={`block text-center px-4 py-3.5 rounded-xl bg-[#0f172a] text-[#Fdfaf3] font-medium transition-colors hover:bg-[#7a947c] ${focusRing}`}
                                    >
                                        Sign in
                                    </Link>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </nav>
        </header>
    );
}

function UserIcon() {
    return (
        <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
    );
}