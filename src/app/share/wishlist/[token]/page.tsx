// src/app/share/wishlist/[token]/page.tsx
// Public, read-only view of a shared wishlist. No login needed.
// Rendered on the server with the anon key; data comes only from the
// get_shared_wishlist() function, never from the wishlist table directly.

import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

import ShareCover from "../[token]/ShareCover";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book wishlist · The Archive",
  robots: { index: false, follow: false }, // keep private links out of search engines
  referrer: "no-referrer", // don't leak the token to sites visitors click through to
};

interface SharedItem {
  title: string;
  author: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  publisher: string | null;
  published_date: string | null;
  cover_url: string | null;
}

interface SharedWishlist {
  owner_name: string;
  owner_avatar: string | null;
  items: SharedItem[];
}

async function loadWishlist(token: string): Promise<SharedWishlist | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await supabase.rpc("get_shared_wishlist", { p_token: token });

  if (error) {
    console.error("Shared wishlist load failed:", error.message);
    return null;
  }

  return (data as SharedWishlist | null) ?? null;
}

function findItOnlineUrl(item: SharedItem) {
  const isbn = item.isbn_13 || item.isbn_10;
  const query = isbn ? `ISBN ${isbn}` : `${item.title} ${item.author ?? ""} book`;
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

function displayName(name: string) {
  return name === "A reader" ? name : `@${name}`;
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#Fdfaf3]";

export default async function SharedWishlistPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const wishlist = await loadWishlist(token);

  return (
    <main className="min-h-screen bg-[#Fdfaf3] text-[#0f172a] relative overflow-x-clip">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
          `,
        }}
      />

      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[480px] bg-[#d8d0e3]/25 rounded-full blur-[130px] -z-10 pointer-events-none" />

      {/* Minimal header: no app navigation, since visitors aren't signed in */}
      <header className="max-w-5xl mx-auto px-5 sm:px-8 py-6 flex items-center justify-between">
        <Link href="/" className={`flex items-center gap-3 rounded-full ${focusRing}`}>
          <span
            aria-hidden="true"
            className="relative w-10 h-10 rounded-full bg-[#0f172a] flex items-center justify-center text-[#Fdfaf3] text-xl font-classical font-semibold"
          >
            A
            <span className="absolute -bottom-1 right-1.5 w-2 h-3.5 bg-[#7a947c] [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" />
          </span>
          <span className="text-xl font-classical font-semibold">The Archive</span>
        </Link>
      </header>

      <section className="max-w-5xl mx-auto px-5 sm:px-8 pt-6 pb-24">
        {!wishlist ? (
          // ---------------- Not found / turned off ----------------
          <div className="max-w-md mx-auto text-center py-20">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#d8d0e3]/50 flex items-center justify-center">
              <span className="font-classical text-2xl">A</span>
            </div>
            <h1 className="font-classical text-4xl font-semibold">This wishlist isn&apos;t available</h1>
            <p className="text-slate-600 mt-4 leading-7">
              The link may have been replaced or turned off. Ask the person who shared it to send you a new one.
            </p>
          </div>
        ) : (
          <>
            {/* ---------------- Owner header ---------------- */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-5 mb-12">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-[#0f172a] text-[#Fdfaf3] flex items-center justify-center shrink-0 ring-4 ring-white shadow-md">
                {wishlist.owner_avatar ? (
                  <img src={wishlist.owner_avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-classical text-2xl" aria-hidden="true">
                    {wishlist.owner_name.replace(/^@/, "").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <h1 className="font-classical text-4xl sm:text-5xl font-semibold leading-tight">
                  {displayName(wishlist.owner_name)}&apos;s wishlist
                </h1>
                <p className="text-slate-600 mt-2">
                  {wishlist.items.length === 0
                    ? "Nothing on the list right now."
                    : `${wishlist.items.length} ${wishlist.items.length === 1 ? "book" : "books"} they'd love to read.`}
                </p>
              </div>
            </div>

            {wishlist.items.length === 0 ? (
              <div className="bg-white/70 border border-dashed border-[#0f172a]/12 rounded-3xl p-10 text-center">
                <p className="text-slate-500">Check back later, or ask them directly what they&apos;re hoping to read.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500 mb-6 max-w-xl leading-6">
                  Buying one? The ISBN is the most reliable way to get the exact edition. Show it at the bookshop or paste it into a search.
                </p>

                <ul className="grid sm:grid-cols-2 gap-4">
                  {wishlist.items.map((item, index) => {
                    const isbn = item.isbn_13 || item.isbn_10;
                    const year = item.published_date?.slice(0, 4);

                    return (
                      <li
                        key={`${isbn ?? item.title}-${index}`}
                        className="flex gap-4 p-4 rounded-2xl bg-white border border-[#0f172a]/5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
                      >
                        <ShareCover src={item.cover_url} title={item.title} author={item.author} />

                        <div className="flex-1 min-w-0 flex flex-col">
                          <h2 className="font-classical font-semibold text-lg leading-snug line-clamp-2">{item.title}</h2>
                          {item.author && <p className="text-sm text-slate-600 mt-1 line-clamp-1">{item.author}</p>}

                          <dl className="mt-3 space-y-1 text-xs text-slate-500">
                            {isbn && (
                              <div className="flex gap-2">
                                <dt className="text-slate-400">ISBN</dt>
                                <dd className="font-medium text-slate-700 select-all tabular-nums">{isbn}</dd>
                              </div>
                            )}
                            {(item.publisher || year) && (
                              <div className="flex gap-2">
                                <dt className="sr-only">Edition</dt>
                                <dd className="truncate">{[item.publisher, year].filter(Boolean).join(", ")}</dd>
                              </div>
                            )}
                          </dl>

                          <a
                            href={findItOnlineUrl(item)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`mt-auto pt-3 self-start text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
                          >
                            Find it online
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <footer className="mt-16 pt-6 border-t border-[#0f172a]/8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-slate-500">
              <p>Shared from The Archive, a home for a family&apos;s books.</p>
              <Link href="/login" className={`text-[#4a5c4b] hover:text-[#0f172a] underline underline-offset-4 rounded ${focusRing}`}>
                Start your own library
              </Link>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}