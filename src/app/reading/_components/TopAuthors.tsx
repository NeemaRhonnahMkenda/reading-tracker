// src/app/reading/_components/TopAuthors.tsx

export default function TopAuthors({ authors }: { authors: { author: string; count: number }[] }) {
  return (
    <div className="h-full rounded-[1.6rem] bg-[#0f172a] text-[#fdfaf3] shadow-[0_20px_50px_rgba(15,23,42,0.18)] p-5 sm:p-6 relative overflow-hidden">
      <div aria-hidden="true" className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-[#7a947c]/25 blur-2xl" />
      <p className="relative text-xs font-medium tracking-[0.18em] uppercase text-[#a9bfaa]">Favourites</p>
      <h3 className="relative mt-1 font-classical text-2xl font-semibold">Authors you return to</h3>

      {authors.length === 0 ? (
        <p className="relative mt-4 text-sm text-[#fdfaf3]/60 font-light leading-6">
          Finish two books by the same author and they&apos;ll appear here.
        </p>
      ) : (
        <ol className="relative mt-5 space-y-3">
          {authors.map((a, i) => (
            <li key={a.author} className="flex items-center gap-3">
              <span className="w-8 h-8 shrink-0 rounded-full bg-white/10 flex items-center justify-center font-classical text-sm">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate">{a.author}</span>
              <span className="text-sm text-[#fdfaf3]/60 shrink-0">
                {a.count} {a.count === 1 ? "book" : "books"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
