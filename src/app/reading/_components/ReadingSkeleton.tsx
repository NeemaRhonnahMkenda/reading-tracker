// src/app/reading/_components/ReadingSkeleton.tsx

export default function ReadingSkeleton() {
  const bar = "bg-[#0f172a]/[0.06] animate-pulse";
  return (
    <div aria-hidden="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-[104px] sm:h-[118px] rounded-2xl ${bar}`} />
        ))}
      </div>
      <div className={`mt-14 h-8 w-56 rounded-full ${bar}`} />
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 sm:gap-7">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div className={`aspect-[2/3] rounded-xl ${bar}`} />
            <div className={`mt-3 h-4 w-3/4 rounded-full ${bar}`} />
            <div className={`mt-2 h-3 w-1/2 rounded-full ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
