"use client";

// src/app/error.tsx
// Catches errors thrown while rendering any page (inside the root layout).
// Shows only a short reference id, never the error message or stack,
// so internal details don't leak to the screen.

import { useEffect } from "react";
import Navbar from "./components/Navbar";
import ErrorState, { primaryButton } from "./components/ErrorState";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Full details stay in the browser console and server logs
    console.error("Page error:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans">
      <Navbar />
      <ErrorState
        code="500"
        title="Something went wrong"
        message="This page couldn't load. Your books and notes are safe. Try again, and if it keeps happening, come back in a few minutes."
        secondary={{ href: "/library", label: "Go to My Library" }}
        reference={error.digest}
      >
        <button type="button" onClick={reset} className={primaryButton}>
          Try again
        </button>
      </ErrorState>
    </main>
  );
}
