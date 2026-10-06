"use client";

// src/app/diary/_components/JournalDayCard.tsx
// A day you wrote journal notes but didn't log a session. It already counts
// towards your streak and pages; adding reading time turns it into a session.

import Link from "next/link";
import Button, { focusRing } from "../../components/ui/Button";
import { JournalDay, locationLabel } from "../../../lib/reading";
import BookThumb from "./BookThumb";

export default function JournalDayCard({ day, onAddTime }: { day: JournalDay; onAddTime: (day: JournalDay) => void }) {
  const reached = locationLabel(day.last_chapter, day.end_page);
  const from = day.start_page != null && day.end_page != null && day.end_page > day.start_page ? `Page ${day.start_page}` : "";

  return (
    <article className="rounded-[1.4rem] border border-dashed border-[#9a86b9]/35 bg-[#f7f5fa]/60 p-5 sm:p-6">
      <div className="flex gap-4">
        <BookThumb title={day.book_title} coverUrl={day.cover_url} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/library/${day.book_id}`}
                className={`font-classical font-semibold text-xl leading-snug text-[#0f172a] hover:text-[#4a5c4b] line-clamp-2 rounded ${focusRing}`}
              >
                {day.book_title}
              </Link>
              {day.book_author && <p className="text-sm text-slate-500 font-light truncate">{day.book_author}</p>}
            </div>

            <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white text-[#6c5c85] text-xs font-medium border border-[#9a86b9]/20">
              <span aria-hidden="true">✎</span>
              {day.notes} journal {day.notes === 1 ? "note" : "notes"}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {reached && (
              <span className="text-sm text-slate-600">
                {from ? (
                  <>
                    {from} <span className="text-slate-400">to</span> {reached.charAt(0).toLowerCase() + reached.slice(1)}
                  </>
                ) : (
                  <>Reached {reached.charAt(0).toLowerCase() + reached.slice(1)}</>
                )}
              </span>
            )}
            {day.pages > 0 && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                {day.pages} {day.pages === 1 ? "page" : "pages"}
              </span>
            )}
          </div>

          <p className="mt-3 text-sm text-slate-500 font-light">
            Counted from your journal. Add how long you read to include it in your daily goal.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onAddTime(day)}>
              Add reading time
            </Button>
            <Link
              href={`/library/${day.book_id}`}
              className={`text-xs font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] px-2 py-1.5 rounded ${focusRing}`}
            >
              Open journal
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
