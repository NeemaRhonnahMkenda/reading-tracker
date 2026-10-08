// src/app/library/_components/StatusPill.tsx

import { normaliseStatus, STATUS_META } from "../_lib/library";

export default function StatusPill({ status, short = false }: { status: string | null; short?: boolean }) {
  const meta = STATUS_META[normaliseStatus(status)];
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${meta.pill}`}>
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {short ? meta.short : meta.label}
    </span>
  );
}
