// src/app/components/ui/Spinner.tsx

export default function Spinner({ light = true, size = 16 }: { light?: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-full border-2 animate-spin ${
        light ? "border-white/30 border-t-white" : "border-[#0f172a]/20 border-t-[#0f172a]"
      }`}
    />
  );
}
