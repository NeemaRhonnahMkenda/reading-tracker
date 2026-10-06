// src/app/not-found.tsx
// Shown for unknown URLs, and anywhere you call notFound().

import type { Metadata } from "next";
import Navbar from "./components/Navbar";
import ErrorState from "./components/ErrorState";

export const metadata: Metadata = {
  title: "Page not found | The Archive",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#fdfaf3] text-[#0f172a] font-sans">
      <Navbar />
      <ErrorState
        code="404"
        title="This page isn't on the shelf"
        message="The link may be old, or the page may have moved. Check the address, or head back to your books."
        primary={{ href: "/library", label: "Go to My Library" }}
        secondary={{ href: "/", label: "Back to home" }}
      />
    </main>
  );
}
