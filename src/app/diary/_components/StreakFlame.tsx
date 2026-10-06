// src/app/diary/_components/StreakFlame.tsx
// Gold flame (the site's star colour) when lit, soft grey when not.

import { useId } from "react";

export default function StreakFlame({ lit, size = 48, className = "" }: { lit: boolean; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");

  return (
    <svg aria-hidden="true" width={size} height={Math.round(size * 1.15)} viewBox="0 0 40 46" className={className}>
      <defs>
        <linearGradient id={`${id}-outer`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lit ? "#e9cf7f" : "#e2e0da"} />
          <stop offset="100%" stopColor={lit ? "#c69a3d" : "#c9c5bb"} />
        </linearGradient>
        <linearGradient id={`${id}-inner`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lit ? "#fdf6dd" : "#f4f2ed"} />
          <stop offset="100%" stopColor={lit ? "#e3c060" : "#dcd8cf"} />
        </linearGradient>
      </defs>
      <path
        d="M20 2c2 6-3 9-3 14 0 2.8 1.8 4.6 4 4.6 3.2 0 4.8-2.7 4.4-6.4C30.8 18 34 23.2 34 28.5 34 37 27.7 44 20 44S6 37 6 28.5c0-9 7.2-14.4 10.4-20.2C17.6 6.2 19 4.4 20 2z"
        fill={`url(#${id}-outer)`}
      />
      <path
        d="M20.5 24c1 3-1.6 4.6-1.6 7.2 0 1.6 1 2.6 2.3 2.6 1.8 0 2.7-1.4 2.5-3.5 2.2 1.9 3.3 4 3.3 6.2 0 4.3-3 7.5-6.9 7.5S13 40.8 13 36.5c0-4.6 3.6-7.5 5.4-10.4.6-.9 1.4-1.4 2.1-2.1z"
        fill={`url(#${id}-inner)`}
      />
    </svg>
  );
}
