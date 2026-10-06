"use client";

// src/app/global-error.tsx
// Last-resort page for errors in the root layout itself. It replaces the whole
// layout, so it brings its own <html> and <body> and uses inline styles in case
// the site's CSS didn't load.

import { useEffect } from "react";

const styles = {
  body: {
    margin: 0,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fdfaf3",
    color: "#0f172a",
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    padding: "24px",
    textAlign: "center" as const,
  },
  mark: {
    width: 72,
    height: 72,
    margin: "0 auto",
    borderRadius: "999px",
    background: "#0f172a",
    color: "#fdfaf3",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: 30,
  },
  title: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontWeight: 600,
    fontSize: 40,
    lineHeight: 1.15,
    margin: "28px 0 0",
  },
  message: { maxWidth: 460, margin: "16px auto 0", color: "#475569", fontWeight: 300, fontSize: 18, lineHeight: 1.7 },
  actions: { marginTop: 36, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" as const },
  primary: {
    height: 48,
    padding: "0 28px",
    borderRadius: 999,
    border: "none",
    background: "#0f172a",
    color: "#fdfaf3",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  secondary: {
    height: 48,
    padding: "0 28px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#ffffff",
    color: "#334155",
    fontSize: 14,
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    textDecoration: "none",
  },
  reference: { marginTop: 36, fontSize: 12, color: "#94a3b8" },
};

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong | The Archive</title>
        <meta name="robots" content="noindex" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&display=swap"
        />
      </head>
      <body style={styles.body}>
        <main>
          <div aria-hidden="true" style={styles.mark}>A</div>
          <h1 style={styles.title}>The Archive couldn&apos;t open</h1>
          <p style={styles.message}>
            Something went wrong while loading the site. Your books and notes are safe. Try again, or reload the page.
          </p>
          <div style={styles.actions}>
            <button type="button" onClick={reset} style={styles.primary}>
              Try again
            </button>
            {/* A full reload, not client navigation: the app shell itself failed */}
            <a href="/library" style={styles.secondary}>
              Go to My Library
            </a>
          </div>
          {error.digest && <p style={styles.reference}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
