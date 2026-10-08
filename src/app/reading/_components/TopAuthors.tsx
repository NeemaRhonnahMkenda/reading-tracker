// src/app/reading/_components/TopAuthors.tsx
// Authors you've finished more than one book by.

export default function TopAuthors({ authors }: { authors: { author: string; count: number }[] }) {
  const max = Math.max(1, ...authors.map((a) => a.count));

  return (
    <section
      aria-labelledby="top-authors-title"
      className="relative h-full min-w-0 w-full overflow-hidden rounded-[1.6rem] bg-[#0f172a] text-[#fdfaf3] shadow-[0_20px_50px_rgba(15,23,42,0.18)] p-5 sm:p-6 lg:p-7"
    >
      {/* Glow stays inside the card (overflow-hidden) so it can't widen the page */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 w-32 h-32 sm:w-40 sm:h-40 rounded-full bg-[#7a947c]/25 blur-2xl" />

      <p className="relative text-xs font-medium tracking-[0.18em] uppercase text-[#a9bfaa]">Favourites</p>
      <h3 id="top-authors-title" className="relative mt-1 font-classical text-xl sm:text-2xl font-semibold leading-snug break-words">
        Authors you return to
      </h3>

      {authors.length === 0 ? (
        <p className="relative mt-4 text-sm text-[#fdfaf3]/60 font-light leading-6">
          Finish two books by the same author and they&apos;ll appear here.
        </p>
      ) : (
        <ol className="relative mt-5 space-y-4">
          {authors.map((a, i) => (
            <li key={a.author} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-x-3">
              <span
                aria-hidden="true"
                className={`w-8 h-8 rounded-full flex items-center justify-center font-classical text-sm ${
                  i === 0 ? "bg-[#c69a3d] text-[#0f172a]" : "bg-white/10"
                }`}
              >
                {i + 1}
              </span>

              {/* Long names wrap onto a second line instead of pushing the count off-screen */}
              <div className="min-w-0 pt-1">
                <p className="text-[15px] leading-snug break-words line-clamp-2" title={a.author}>
                  <span className="sr-only">{i + 1}. </span>
                  {a.author}
                </p>
                <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${i === 0 ? "bg-[#c69a3d]" : "bg-[#7a947c]"}`}
                    style={{ width: `${(a.count / max) * 100}%` }}
                  />
                </div>
              </div>

              <span className="mt-0.5 inline-flex items-center h-7 px-2.5 rounded-full bg-white/10 text-xs text-[#fdfaf3]/80 whitespace-nowrap tabular-nums">
                {a.count} {a.count === 1 ? "book" : "books"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}