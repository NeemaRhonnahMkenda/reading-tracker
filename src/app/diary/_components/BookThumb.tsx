// src/app/diary/_components/BookThumb.tsx
// Small cover with the navy placeholder used across the site.

export default function BookThumb({
  title,
  coverUrl,
  className = "w-12 h-[72px]",
}: {
  title: string;
  coverUrl: string | null;
  className?: string;
}) {
  return (
    <span className={`relative shrink-0 rounded-lg overflow-hidden bg-[#0f172a] text-[#fdfaf3] flex items-end p-1.5 shadow-md ${className}`}>
      <span className="font-classical text-sm leading-none opacity-60" aria-hidden="true">
        {title.charAt(0)}
      </span>
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => (e.currentTarget.style.display = "none")}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
    </span>
  );
}
