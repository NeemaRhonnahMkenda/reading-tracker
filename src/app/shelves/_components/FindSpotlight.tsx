// src/app/shelves/_components/FindSpotlight.tsx
// "Where is it?" The page scrolls to the book, the room dims and a spotlight
// closes in on it, the book slides out of the shelf, and a gold pin drops onto
// it with a card saying exactly where it lives.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { focusRing } from "../../components/ui/Button";
import { SpineVisual, type SpineLook } from "./Spine";

export interface FindTarget {
  bookId: string;
  look: SpineLook;
  orientation: "upright" | "flat";
  place: string; // "Living room"
  detail: string; // "Shelf 2 · 5th from the left"
}

type Box = { left: number; top: number; width: number; height: number };

const CARD_W = 300;

export default function FindSpotlight({ target, onClose }: { target: FindTarget | null; onClose: () => void }) {
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState(false);
  const [view, setView] = useState({ w: 1024, h: 768 });
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Scroll to the book, then follow it while the page settles
  useEffect(() => {
    if (!target) return;

    const el = document.querySelector<HTMLElement>(`[data-spine-id="${CSS.escape(target.bookId)}"]`);
    if (!el) {
      onCloseRef.current();
      return;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center", inline: "center" });

    let frame = 0;
    let last = "";
    const track = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.left}|${r.top}|${r.width}|${r.height}|${window.innerWidth}|${window.innerHeight}`;
      if (key !== last) {
        last = key;
        setBox({ left: r.left, top: r.top, width: r.width, height: r.height });
        setView({ w: window.innerWidth, h: window.innerHeight });
      }
      frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);

    const reveal = window.setTimeout(() => {
      setShown(true);
      el.style.visibility = "hidden"; // the lifted copy takes its place
      requestAnimationFrame(() => doneRef.current?.focus({ preventScroll: true }));
    }, reduce ? 0 : 560);

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(reveal);
      window.removeEventListener("keydown", onKey);
      el.style.visibility = "";
      setShown(false);
      setBox(null);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [target]);

  if (!target || !box) return null;

  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const radius = Math.max(box.width, box.height) / 2 + 44;

  const cardW = Math.min(CARD_W, view.w - 32);
  const below = box.top + box.height + 200 < view.h;
  const cardLeft = Math.min(Math.max(16, cx - cardW / 2), view.w - cardW - 16);
  const cardTop = below ? box.top + box.height + 26 : Math.max(16, box.top - 210);

  const { book } = target.look;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={`Where ${book.title} is`}>
      <style>{`
        @property --spot-r { syntax: '<length>'; inherits: false; initial-value: 2400px; }
        .spot-dim {
          --spot-r: 2400px;
          transition: --spot-r 800ms cubic-bezier(.65,0,.25,1), opacity 300ms ease;
          -webkit-mask-image: radial-gradient(circle var(--spot-r) at var(--cx) var(--cy), transparent 92%, #000 100%);
                  mask-image: radial-gradient(circle var(--spot-r) at var(--cx) var(--cy), transparent 92%, #000 100%);
        }
        .spot-dim.is-on { --spot-r: var(--final-r); }
        @keyframes spot-lift {
          0%   { transform: translateY(0) scale(1) rotate(0); }
          45%  { transform: translateY(-34px) scale(1.12) rotate(-5deg); }
          70%  { transform: translateY(-16px) scale(1.07) rotate(-2deg); }
          100% { transform: translateY(-20px) scale(1.08) rotate(-3deg); }
        }
        @keyframes spot-pin {
          0%   { transform: translate(-50%, -140px); opacity: 0; }
          55%  { transform: translate(-50%, 0); opacity: 1; }
          70%  { transform: translate(-50%, -18px); }
          85%  { transform: translate(-50%, 0); }
          93%  { transform: translate(-50%, -5px); }
          100% { transform: translate(-50%, 0); opacity: 1; }
        }
        @keyframes spot-bob { 0%,100% { translate: 0 0; } 50% { translate: 0 -6px; } }
        @keyframes spot-ring {
          0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        @keyframes spot-card { from { opacity: 0; transform: translateY(${below ? "-8px" : "8px"}); } to { opacity: 1; transform: none; } }
        .spot-lift { animation: spot-lift 700ms cubic-bezier(.2,.8,.2,1) both; }
        .spot-pin  { animation: spot-pin 900ms cubic-bezier(.3,.7,.3,1) 250ms both; }
        .spot-pin-inner { animation: spot-bob 1.8s ease-in-out 1.2s infinite; }
        .spot-ring { animation: spot-ring 1.6s ease-out 700ms infinite; }
        .spot-card { animation: spot-card 380ms ease-out 650ms both; }
        @media (prefers-reduced-motion: reduce) {
          .spot-dim { transition: none; }
          .spot-lift, .spot-pin, .spot-pin-inner, .spot-ring, .spot-card { animation: none; }
        }
      `}</style>

      {/* Dimmed room with a hole over the book. Tap anywhere to close. */}
      <div
        onMouseDown={onClose}
        className={`spot-dim absolute inset-0 bg-[#0f172a]/70 ${shown ? "is-on" : ""}`}
        style={{ ["--cx" as string]: `${cx}px`, ["--cy" as string]: `${cy}px`, ["--final-r" as string]: `${radius}px` }}
      />

      {shown && (
        <>
          {/* Pulsing ring around the gap */}
          <span
            aria-hidden="true"
            className="spot-ring pointer-events-none absolute rounded-full border-2 border-[#e8c873]"
            style={{ left: cx, top: cy, width: radius * 1.2, height: radius * 1.2 }}
          />

          {/* The book, lifted out of the shelf */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height, transformOrigin: "50% 100%" }}
          >
            <div className="spot-lift drop-shadow-[0_0_18px_rgba(232,200,115,0.75)]" style={{ transformOrigin: "50% 100%" }}>
              <SpineVisual look={target.look} orientation={target.orientation} lifted />
            </div>
          </div>

          {/* Gold pin */}
          <div aria-hidden="true" className="spot-pin pointer-events-none absolute" style={{ left: cx, top: box.top - 74 }}>
            <div className="spot-pin-inner">
              <svg width="38" height="50" viewBox="0 0 38 50">
                <defs>
                  <linearGradient id="pin-gold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#f5dc94" />
                    <stop offset="55%" stopColor="#c69a3d" />
                    <stop offset="100%" stopColor="#8a6a22" />
                  </linearGradient>
                </defs>
                <path d="M19 49C19 49 3 30 3 18.5 3 9.4 10.2 2 19 2s16 7.4 16 16.5C35 30 19 49 19 49z" fill="url(#pin-gold)" stroke="#fdfaf3" strokeWidth="2" />
                <circle cx="19" cy="18" r="6.5" fill="#fdfaf3" />
              </svg>
            </div>
          </div>

          {/* Where it is */}
          <div
            className="spot-card absolute rounded-2xl bg-[#fdfaf3] border border-[#0f172a]/10 shadow-[0_25px_60px_rgba(15,23,42,0.35)] p-4"
            style={{ left: cardLeft, top: cardTop, width: cardW }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-[#7a947c]">Found it</p>
            <p className="mt-1 font-classical text-lg font-semibold text-[#0f172a] leading-snug line-clamp-2">{book.title}</p>
            {book.author && <p className="text-sm text-slate-500 truncate">{book.author}</p>}

            <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-[#fbf6ea] border border-[#c69a3d]/20 px-3 py-2.5">
              <span aria-hidden="true" className="mt-0.5 w-2.5 h-2.5 shrink-0 rounded-full bg-[#c69a3d] shadow-[0_0_0_3px_rgba(198,154,61,0.25)]" />
              <p className="text-sm text-[#5b4718] leading-snug">
                <span className="font-semibold">{target.place}</span>
                <span className="block text-[#8a6a22]">{target.detail}</span>
              </p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link
                href={`/library/${book.id}`}
                className={`inline-flex items-center justify-center h-10 rounded-full bg-white border border-[#0f172a]/10 text-sm font-medium text-slate-700 hover:border-[#7a947c] hover:text-[#0f172a] transition-colors ${focusRing}`}
              >
                Open book
              </Link>
              <button
                ref={doneRef}
                type="button"
                onClick={onClose}
                className={`h-10 rounded-full bg-[#0f172a] text-[#fdfaf3] text-sm font-medium hover:bg-[#1e293b] transition-colors ${focusRing}`}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}

      <p className="sr-only" aria-live="assertive">
        {shown ? `${book.title} is in ${target.place}, ${target.detail}.` : ""}
      </p>
    </div>
  );
}
