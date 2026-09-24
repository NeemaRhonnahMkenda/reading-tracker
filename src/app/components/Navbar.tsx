"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "../../lib/supabase";

interface NavbarProps {
  isLoggedIn?: boolean;
}

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export default function Navbar({
  isLoggedIn = false,
}: NavbarProps) {
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);

  const inactivityTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // --------------------------------------------------
  // Logout
  // --------------------------------------------------

  async function handleLogout() {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      return;
    }

    setMenuOpen(false);

    router.push("/login");
    router.refresh();
  }

  // --------------------------------------------------
  // Automatic logout after inactivity
  // --------------------------------------------------

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    function resetInactivityTimer() {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }

      inactivityTimerRef.current = setTimeout(() => {
        handleLogout();
      }, INACTIVITY_TIMEOUT);
    }

    const activityEvents = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    activityEvents.forEach((event) => {
      window.addEventListener(
        event,
        resetInactivityTimer
      );
    });

    // Start the timer when the navbar mounts
    resetInactivityTimer();

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }

      activityEvents.forEach((event) => {
        window.removeEventListener(
          event,
          resetInactivityTimer
        );
      });
    };
  }, [isLoggedIn]);

  // --------------------------------------------------
  // Close mobile menu
  // --------------------------------------------------

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <nav className="max-w-6xl mx-auto px-5 sm:px-8 py-5 sm:py-8 relative z-20">
      <div className="flex justify-between items-center">
        {/* Logo */}
        <Link
          href="/"
          onClick={closeMenu}
          className="flex items-center gap-3 sm:gap-4"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#0f172a] flex items-center justify-center text-[#Fdfaf3] text-xl sm:text-2xl font-classical font-semibold shadow-sm">
            A
          </div>

          <span className="text-xl sm:text-2xl font-classical font-semibold text-[#0f172a] tracking-wide">
            The Archive
          </span>
        </Link>

        {/* --------------------------------------------------
            Desktop Navigation
            -------------------------------------------------- */}

        {isLoggedIn ? (
          <div className="hidden md:flex items-center gap-6 lg:gap-8">
            <Link
              href="/library"
              className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
            >
              My Library
            </Link>

            <Link
              href="/reading"
              className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
            >
              Reading
            </Link>

            <Link
              href="/wishlist"
              className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
            >
              Want to Read
            </Link>

            <Link
              href="/profile"
              className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
            >
              Profile
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
            >
              Logout
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="hidden md:block text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
          >
            Sign In
          </Link>
        )}

        {/* --------------------------------------------------
            Mobile Menu Button
            -------------------------------------------------- */}

        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={
            menuOpen ? "Close navigation menu" : "Open navigation menu"
          }
          aria-expanded={menuOpen}
          className="md:hidden w-11 h-11 rounded-full border border-slate-200 bg-white flex items-center justify-center text-[#0f172a] hover:border-[#7a947c] transition-colors"
        >
          {menuOpen ? (
            <span className="text-2xl leading-none">
              ×
            </span>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="block w-5 h-px bg-[#0f172a]" />
              <span className="block w-5 h-px bg-[#0f172a]" />
              <span className="block w-5 h-px bg-[#0f172a]" />
            </div>
          )}
        </button>
      </div>

      {/* --------------------------------------------------
          Mobile Navigation
          -------------------------------------------------- */}

      {menuOpen && (
        <div className="md:hidden mt-4 bg-white rounded-2xl border border-[#0f172a]/5 shadow-lg p-4">
          {isLoggedIn ? (
            <div className="flex flex-col">
              <Link
                href="/library"
                onClick={closeMenu}
                className="px-4 py-3.5 rounded-lg text-[#0f172a] font-medium hover:bg-[#Fdfaf3] hover:text-[#7a947c] transition-colors"
              >
                My Library
              </Link>

              <Link
                href="/reading"
                onClick={closeMenu}
                className="px-4 py-3.5 rounded-lg text-[#0f172a] font-medium hover:bg-[#Fdfaf3] hover:text-[#7a947c] transition-colors"
              >
                Reading
              </Link>

              <Link
                href="/wishlist"
                onClick={closeMenu}
                className="px-4 py-3.5 rounded-lg text-[#0f172a] font-medium hover:bg-[#Fdfaf3] hover:text-[#7a947c] transition-colors"
              >
                Want to Read
              </Link>

              <Link
                href="/profile"
                onClick={closeMenu}
                className="px-4 py-3.5 rounded-lg text-[#0f172a] font-medium hover:bg-[#Fdfaf3] hover:text-[#7a947c] transition-colors"
              >
                Profile
              </Link>

              <div className="h-px bg-slate-100 my-2" />

              <button
                type="button"
                onClick={handleLogout}
                className="text-left px-4 py-3.5 rounded-lg text-[#0f172a] font-medium hover:bg-[#Fdfaf3] hover:text-[#7a947c] transition-colors"
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              onClick={closeMenu}
              className="block px-4 py-3.5 rounded-lg text-[#0f172a] font-medium hover:bg-[#Fdfaf3] hover:text-[#7a947c] transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}