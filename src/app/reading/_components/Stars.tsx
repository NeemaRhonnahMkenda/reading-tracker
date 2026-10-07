// src/app/reading/_components/Stars.tsx
// Read-only stars with quarter-star fill.

"use client";

import { useId } from "react";

const PATH = "M12 1.6l3.1 6.6 7.2.9-5.3 5 1.4 7.2L12 17.8l-6.4 3.5 1.4-7.2-5.3-5 7.2-.9z";

function StarIcon({ fill, className }: { fill: number; className: string }) {
  const clipId = useId();
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * Math.max(0, Math.min(1, fill))} height="24" />
        </clipPath>
      </defs>
      <path d={PATH} fill="#e2e8f0" />
      <path d={PATH} fill="#c5a24a" clipPath={`url(#${clipId})`} />
    </svg>
  );
}

export default function Stars({ value, className = "w-3.5 h-3.5" }: { value: number; className?: string }) {
  const label = String(Number(value.toFixed(2)));
  return (
    <span className="inline-flex gap-px align-middle" role="img" aria-label={`${label} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon key={star} fill={value - (star - 1)} className={className} />
      ))}
    </span>
  );
}
