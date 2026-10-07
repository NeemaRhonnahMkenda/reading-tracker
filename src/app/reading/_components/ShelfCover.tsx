// src/app/reading/_components/ShelfCover.tsx
// Book cover that fades in, with a navy title card when there's no image.

"use client";

import { useEffect, useRef, useState } from "react";

export default function ShelfCover({
  src,
  title,
  author,
  compact = false,
  eager = false,
}: {
  src: string | null;
  title: string;
  author?: string | null;
  compact?: boolean;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(!!imgRef.current?.complete && (imgRef.current?.naturalWidth ?? 0) > 0);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`w-full h-full bg-[#0f172a] text-[#fdfaf3] flex flex-col justify-between ${compact ? "p-1.5" : "p-3 sm:p-4"}`}>
        {compact ? (
          <span className="m-auto font-classical text-lg opacity-60">{title.charAt(0).toUpperCase()}</span>
        ) : (
          <>
            <span className="text-[9px] tracking-[0.2em] opacity-50">The Archive</span>
            <div>
              <p className="font-classical text-sm sm:text-base leading-tight line-clamp-4">{title}</p>
              {author && <p className="text-[11px] opacity-60 mt-1.5 line-clamp-2">{author}</p>}
            </div>
            <span className="self-end font-classical text-lg opacity-30">A</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div aria-hidden="true" className={`absolute inset-0 bg-[#e9e4d9] transition-opacity duration-300 ${loaded ? "opacity-0" : "animate-pulse"}`} />
      <img
        ref={imgRef}
        src={src}
        alt={compact ? "" : `Cover of ${title}`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
