// src/app/components/ErrorState.tsx
// Shared layout for error and empty-result pages, in The Archive's style.
// Works in server and client components (no hooks).

import Link from "next/link";
import { ReactNode } from "react";

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#7a947c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fdfaf3]";

export const primaryButton = `inline-flex items-center justify-center h-12 px-7 rounded-full bg-[#0f172a] text-[#fdfaf3] text-sm font-medium hover:bg-[#1e293b] shadow-md hover:shadow-lg transition-all ${focusRing}`;

export const secondaryButton = `inline-flex items-center justify-center h-12 px-7 rounded-full bg-white/70 text-slate-700 border border-[#0f172a]/10 text-sm font-medium hover:bg-white hover:text-[#0f172a] hover:border-[#0f172a]/25 transition-all ${focusRing}`;

export interface ErrorAction {
  href: string;
  label: string;
}

interface ErrorStateProps {
  code?: string; // e.g. "404"
  title: string;
  message: ReactNode;
  primary?: ErrorAction;
  secondary?: ErrorAction;
  children?: ReactNode; // custom actions (e.g. a "Try again" button)
  reference?: string | null; // error id to quote when reporting a problem
}

export default function ErrorState({ code, title, message, primary, secondary, children, reference }: ErrorStateProps) {
  return (
    <section className="relative max-w-3xl mx-auto px-5 sm:px-8 py-20 sm:py-28 text-center">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap');
            .font-classical { font-family: 'Playfair Display', Georgia, serif; }
          `,
        }}
      />

      {/* Book spine mark: the site's "A" with a fallen bookmark */}
      <div aria-hidden="true" className="relative mx-auto w-20 h-20 rounded-full bg-[#f7f5fa] border border-[#9a86b9]/20 flex items-center justify-center">
        <span className="font-classical text-3xl text-[#9a86b9]">A</span>
        <span className="absolute -bottom-1 right-3 w-2.5 h-4 bg-[#7a947c] rotate-12 [clip-path:polygon(0_0,100%_0,100%_100%,50%_75%,0_100%)]" />
      </div>

      {code && <p className="mt-8 tracking-[0.25em] text-sm text-[#7a947c] font-medium">Error {code}</p>}

      <h1 className={`${code ? "mt-3" : "mt-8"} text-4xl md:text-5xl font-classical font-semibold text-[#0f172a] leading-tight`}>
        {title}
      </h1>

      <div className="mt-5 text-slate-600 font-light text-lg leading-8 max-w-xl mx-auto">{message}</div>

      {(primary || secondary || children) && (
        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
          {children}
          {primary && (
            <Link href={primary.href} className={primaryButton}>
              {primary.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className={secondaryButton}>
              {secondary.label}
            </Link>
          )}
        </div>
      )}

      {reference && (
        <p className="mt-10 text-xs text-slate-400">
          Reference: <code className="font-mono text-slate-500">{reference}</code>
        </p>
      )}
    </section>
  );
}