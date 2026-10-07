// src/app/reading/_components/ShelfSection.tsx
// A titled shelf that can collapse, and shows a "Show all" button when long.

"use client";

import { ReactNode, useId, useState } from "react";
import { focusRing } from "../../components/ui/Button";

export default function ShelfSection({
  id,
  title,
  subtitle,
  count,
  dot,
  defaultOpen = true,
  toolbar,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  count: number;
  dot: string; // tailwind bg class
  defaultOpen?: boolean;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-36 sm:scroll-mt-40">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-4 mb-5 sm:mb-6 border-b border-[#0f172a]/[0.07]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={`group flex items-start gap-3 text-left rounded-lg -ml-1 pl-1 pr-2 ${focusRing}`}
        >
          <span aria-hidden="true" className={`mt-3 w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
          <span>
            <span className="flex items-center gap-2.5">
              <h2 id={`${id}-title`} className="font-classical text-2xl sm:text-[1.75rem] font-semibold text-[#0f172a] leading-tight">
                {title}
              </h2>
              <span className="min-w-7 h-7 px-2 rounded-full bg-[#0f172a]/[0.06] text-slate-600 text-xs font-semibold inline-flex items-center justify-center">
                {count}
              </span>
              <span
                aria-hidden="true"
                className={`text-slate-400 group-hover:text-[#0f172a] transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
              >
                ▾
              </span>
            </span>
            {subtitle && <span className="block mt-1 text-sm text-slate-500 font-light">{subtitle}</span>}
          </span>
        </button>

        {open && toolbar}
      </div>

      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
