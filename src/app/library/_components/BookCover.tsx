// src/app/library/_components/BookCover.tsx
// Optimised, lazy cover that fades in over a placeholder, with a navy
// title card when there's no image (or it fails to load).

"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// Hosts configured in next.config images.remotePatterns
const OPTIMIZED_COVER_HOSTS = ["covers.openlibrary.org", "archive.org", "books.google.com", "books.googleusercontent.com"];

function canOptimize(src: string) {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && OPTIMIZED_COVER_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export default function BookCover({
  src,
  title,
  author,
  size = "md",
  eager = false,
  sizes = "(min-width: 1280px) 200px, (min-width: 1024px) 190px, (min-width: 640px) 30vw, 45vw",
}: {
  src: string | null;
  title: string;
  author?: string | null;
  size?: "sm" | "md" | "lg";
  eager?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setFailed(false);
    setLoaded(!!imgRef.current?.complete && (imgRef.current?.naturalWidth ?? 0) > 0);
  }, [src]);

  if (!src || failed) {
    if (size === "sm") {
      return (
        <div className="w-full h-full bg-[#0f172a] text-[#fdfaf3] flex items-center justify-center">
          <span className="font-classical text-lg opacity-60">{title.charAt(0).toUpperCase()}</span>
        </div>
      );
    }
    return (
      <div className="w-full h-full p-3 sm:p-4 flex flex-col justify-between bg-[#0f172a] text-[#fdfaf3]">
        <span className="text-[9px] sm:text-[10px] tracking-[0.2em] opacity-50">The Archive</span>
        <div>
          <p className={`font-classical leading-tight line-clamp-4 ${size === "lg" ? "text-xl" : "text-sm sm:text-base"}`}>{title}</p>
          {author && <p className="text-[11px] opacity-60 mt-1.5 line-clamp-2">{author}</p>}
        </div>
        <span className="self-end font-classical text-lg opacity-30">A</span>
      </div>
    );
  }

  const imageClass = `object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`;
  const alt = size === "sm" ? "" : `Cover of ${title}`;

  return (
    <div className="relative w-full h-full">
      <div aria-hidden="true" className={`absolute inset-0 bg-[#e9e4d9] transition-opacity duration-300 ${loaded ? "opacity-0" : "animate-pulse"}`} />
      {canOptimize(src) ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={size === "sm" ? "56px" : sizes}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={imageClass}
        />
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full ${imageClass}`}
        />
      )}
    </div>
  );
}
