// src/app/reading/_components/ProgressBar.tsx

export default function ProgressBar({
  value,
  tone = "sage",
  className = "h-1.5",
  label,
}: {
  value: number; // 0 to 100
  tone?: "sage" | "gold" | "lilac" | "light";
  className?: string;
  label?: string;
}) {
  const fill = {
    sage: "bg-[#7a947c]",
    gold: "bg-[#c69a3d]",
    lilac: "bg-[#9a86b9]",
    light: "bg-[#fdfaf3]",
  }[tone];
  const track = tone === "light" ? "bg-white/25" : "bg-[#0f172a]/[0.07]";
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      className={`w-full rounded-full overflow-hidden ${track} ${className}`}
    >
      <div className={`h-full rounded-full ${fill} transition-[width] duration-700 ease-out`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
