"use client";

// src/app/diary/_components/SessionCard.tsx

import Link from "next/link";
import { useState } from "react";
import { focusRing } from "../../components/ui/Button";
import { ReadingSession, formatMinutes, locationLabel, pagesRead } from "../../../lib/reading";
import BookThumb from "./BookThumb";

const THOUGHTS_PREVIEW = 220;

export default function SessionCard({
  session,
  onEdit,
  onDelete,
}: {
  session: ReadingSession;
  onEdit: (session: ReadingSession) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const pages = pagesRead(session);
  const from = locationLabel(session.start_chapter, session.start_page);
  const to = locationLabel(session.end_chapter, session.end_page);
  const title = session.book?.title ?? "A book you've removed";
  const longThoughts = (session.thoughts?.length ?? 0) > THOUGHTS_PREVIEW;

  return (
    <article className="soft-surface border soft-border rounded-[1.4rem] shadow-[0_8px_30px_rgba(15,23,42,0.04)] p-5 sm:p-6">
      <div className="flex gap-4">
        <BookThumb title={title} coverUrl={session.book?.cover_url ?? null} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {session.book ? (
                <Link
                  href={`/library/${session.book.id}`}
                  className={`font-classical font-semibold text-xl leading-snug text-[#0f172a] hover:text-[#4a5c4b] line-clamp-2 rounded ${focusRing}`}
                >
                  {title}
                </Link>
              ) : (
                <p className="font-classical font-semibold text-xl text-slate-400">{title}</p>
              )}
              {session.book?.author && <p className="text-sm text-slate-500 font-light truncate">{session.book.author}</p>}
            </div>

            <span className="shrink-0 inline-flex items-center px-3 py-1 rounded-full bg-[#f7f5fa] text-[#6c5c85] text-xs font-medium border border-[#9a86b9]/20">
              {formatMinutes(session.minutes_read)}
            </span>
          </div>

          {(from || to || (pages != null && pages > 0)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(from || to) && (
                <span className="text-sm text-slate-600">
                  {from || "Start not noted"} <span className="text-slate-400">to</span> {to || "end not noted"}
                </span>
              )}
              {pages != null && pages > 0 && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#eef3ee] text-[#4a5c4b] text-xs font-semibold">
                  {pages} {pages === 1 ? "page" : "pages"}
                </span>
              )}
            </div>
          )}

          {session.thoughts && (
            <div className="mt-4">
              <p
                className={`text-slate-700 leading-8 whitespace-pre-wrap text-[15px] font-light border-l-2 border-[#d8d0e3] pl-4 ${
                  !expanded && longThoughts ? "line-clamp-3" : ""
                }`}
              >
                {session.thoughts}
              </p>
              {longThoughts && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className={`mt-1 ml-4 text-sm font-medium text-[#4a5c4b] underline underline-offset-4 decoration-[#7a947c]/40 hover:text-[#0f172a] rounded ${focusRing}`}
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-1">
            {confirming ? (
              <>
                <span className="text-xs text-slate-500 mr-1">Delete this session?</span>
                <button
                  type="button"
                  onClick={() => onDelete(session.id)}
                  className={`text-xs font-medium text-white bg-[#c0675b] hover:bg-[#a14e43] px-3 py-1.5 rounded-lg transition-colors ${focusRing}`}
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className={`text-xs text-slate-500 hover:text-[#0f172a] px-2.5 py-1.5 rounded-lg hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
                >
                  Keep
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(session)}
                  aria-label={`Edit session for ${title}`}
                  className={`text-xs text-slate-400 hover:text-[#0f172a] px-2.5 py-1.5 rounded-lg hover:bg-[#0f172a]/5 transition-colors ${focusRing}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  aria-label={`Delete session for ${title}`}
                  className={`text-xs text-slate-400 hover:text-[#a34d43] px-2.5 py-1.5 rounded-lg hover:bg-[#f7e9e6] transition-colors ${focusRing}`}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
