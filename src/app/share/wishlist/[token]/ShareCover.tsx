"use client";

// src/app/share/wishlist/[token]/ShareCover.tsx

import { useState } from "react";

export default function ShareCover({
  src,
  title,
  author,
}: {
  src: string | null;
  title: string;
  author: string | null;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="w-20 sm:w-24 aspect-[2/3] rounded-lg overflow-hidden bg-[#e9e4d9] shadow-md shrink-0">
      {src && !failed ? (
        <img
          src={src}
          alt={`Cover of ${title}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full p-2.5 flex flex-col justify-between bg-[#0f172a] text-[#Fdfaf3]">
          <span className="text-[7px] tracking-[0.2em] opacity-50">The Archive</span>
          <div>
            <p className="font-classical text-xs leading-tight line-clamp-4">{title}</p>
            {author && <p className="text-[9px] opacity-70 mt-1 line-clamp-2">{author}</p>}
          </div>
          <span className="self-end font-classical text-sm opacity-40">A</span>
        </div>
      )}
    </div>
  );
}