// src/app/library/_components/Alert.tsx

import type { ReactNode } from "react";

export default function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 px-4 py-3 rounded-xl bg-[#fbefed] border border-red-200/70 text-[#a14e43] text-sm">
      <span aria-hidden="true" className="mt-0.5 font-semibold">!</span>
      <span>{children}</span>
    </div>
  );
}
