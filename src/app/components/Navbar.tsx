"use client";

import Link from "next/link";

interface NavbarProps {
  isLoggedIn?: boolean;
}

export default function Navbar({ isLoggedIn = false }: NavbarProps) {
  return (
    <nav className="max-w-6xl mx-auto px-8 py-8 flex justify-between items-center relative z-10">
      
      {/* Logo */}
      <Link href="/" className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-[#0f172a] flex items-center justify-center text-[#Fdfaf3] text-2xl font-classical font-semibold shadow-sm">
          A
        </div>

        <span className="text-2xl font-classical font-semibold text-[#0f172a] tracking-wide">
          The Archive
        </span>
      </Link>

      {/* Navigation */}
      {isLoggedIn ? (
        <div className="flex items-center gap-8">
          
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
            className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
          >
            Logout
          </button>

        </div>
      ) : (
        <Link
          href="/login"
          className="text-[#0f172a] font-medium hover:text-[#7a947c] transition-colors tracking-wide"
        >
          Sign In
        </Link>
      )}
    </nav>
  );
}