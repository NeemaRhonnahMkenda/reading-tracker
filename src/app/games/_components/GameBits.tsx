// src/app/games/_components/GameBits.tsx
// Small shared pieces: cover art, platform badge, segmented control, chips.

"use client";

import { useState, type ReactNode } from "react";
import { focusRing } from "../../components/ui/Button";
import { platformById } from "../_lib/platforms";
import { coverSrc } from "../_lib/types";

// ------------------------------------------------------------
// Cover
// ------------------------------------------------------------

const FALLBACKS = [
  "from-[#1e293b] to-[#334155]",
  "from-[#4a5c4b] to-[#7a947c]",
  "from-[#5b4718] to-[#c69a3d]",
  "from-[#3b2a1c] to-[#7d5c37]",
];

export function GameCover({
  src: url,
  name,
  size = "big",
  className = "",
}: {
  src: string | null;
  name: string;
  size?: "small" | "big";
  className?: string;
}) {
  // Sized copy first, then the original, then the painted fallback
  const [failed, setFailed] = useState(0);
  const sized = coverSrc(url, size);
  const src = failed === 0 ? sized : failed === 1 && sized !== url ? (url ?? null) : null;
  const tone = FALLBACKS[(name.charCodeAt(0) || 0) % FALLBACKS.length];

  return (
    <div className={`relative aspect-[3/4] overflow-hidden rounded-xl bg-[#e9e4d9] ring-1 ring-[#0f172a]/10 ${className}`}>
      {src ? (
        // IGDB serves sized covers; plain <img> keeps next.config untouched
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed((n) => n + 1)} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div aria-hidden="true" className={`absolute inset-0 bg-gradient-to-br ${tone} flex items-end p-2.5`}>
          {size === "big" ? (
            <span className="font-classical text-[#fdfaf3] text-sm leading-tight line-clamp-4">{name}</span>
          ) : (
            <span className="font-classical text-[#fdfaf3]/90 text-lg leading-none">{name.replace(/^the\s+/i, "").charAt(0).toUpperCase()}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Platform badge
// ------------------------------------------------------------

export function PlatformBadge({ id, name, solid = false }: { id: number; name?: string; solid?: boolean }) {
  const p = platformById(id);
  const sony = p?.family === "playstation";
  const tone = solid
    ? sony
      ? "bg-[#1f3a7a] text-white"
      : "bg-[#b23a30] text-white"
    : sony
      ? "bg-[#e8edf8] text-[#1f3a7a] ring-1 ring-[#1f3a7a]/15"
      : "bg-[#fbecea] text-[#9c3128] ring-1 ring-[#b23a30]/15";
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold tracking-wide whitespace-nowrap ${tone}`}>
      {p?.short ?? name ?? "Other"}
    </span>
  );
}

// ------------------------------------------------------------
// Segmented control
// ------------------------------------------------------------

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; hint?: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex p-1 rounded-full bg-[#0f172a]/[0.05] gap-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-all ${focusRing} ${
              size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm"
            } ${on ? "bg-white text-[#0f172a] shadow-sm" : "text-slate-500 hover:text-[#0f172a]"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// Chip (toggle)
// ------------------------------------------------------------

export function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-medium border transition-colors ${focusRing} ${
        on ? "bg-[#0f172a] text-[#fdfaf3] border-[#0f172a]" : "bg-white/70 text-slate-600 border-[#0f172a]/10 hover:border-[#0f172a]/25 hover:text-[#0f172a]"
      }`}
    >
      {children}
    </button>
  );
}

export function FieldLabel({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold tracking-wide uppercase text-slate-500 mb-2">
      {children}
      {hint && <span className="ml-1.5 normal-case tracking-normal font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass = `w-full h-11 rounded-xl bg-white border border-[#0f172a]/10 px-3.5 text-sm text-[#0f172a] placeholder:text-slate-400 hover:border-[#0f172a]/20 focus:border-[#7a947c] ${focusRing}`;

const CREDITS: Record<string, { label: string; href: string }> = {
  rawg: { label: "RAWG.io", href: "https://rawg.io" },
  wikidata: { label: "Wikidata", href: "https://www.wikidata.org" },
  igdb: { label: "IGDB.com", href: "https://www.igdb.com" },
};

/** Where game details came from (RAWG asks for this link wherever its data is shown). */
export function CatalogCredit({ catalogs, className = "mt-10" }: { catalogs: string[]; className?: string }) {
  const list = [...new Set(catalogs)].filter((c) => CREDITS[c]);
  if (!list.length) return null;
  return (
    <p className={`text-xs text-slate-400 ${className}`}>
      Game details and images from{" "}
      {list.map((c, i) => (
        <span key={c}>
          {i > 0 && (i === list.length - 1 ? " and " : ", ")}
          <a href={CREDITS[c].href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 decoration-slate-300 hover:text-[#0f172a]">
            {CREDITS[c].label}
          </a>
        </span>
      ))}
    </p>
  );
}

export function ConfidencePill({ score }: { score: number }) {
  const strong = score >= 0.85;
  const likely = score >= 0.6;
  return (
    <span
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold ${
        strong ? "bg-[#e6efe6] text-[#3f5a41]" : likely ? "bg-[#fbf3df] text-[#7a5a14]" : "bg-[#0f172a]/[0.05] text-slate-500"
      }`}
    >
      {strong ? "✓ Strong match" : likely ? "Likely match" : "Check this"}
    </span>
  );
}
