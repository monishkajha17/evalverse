"use client";

import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function KpiTile({
  label,
  value,
  hint,
  tip,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tip?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-hairline bg-raised px-3 py-2.5",
        tip && "cursor-help",
        className,
      )}
    >
      <div className="label-mono text-[11px] !normal-case tracking-wide text-ink-muted">{label}</div>
      <div data-kpi-value className="mt-1 text-lg font-semibold tabular-nums text-ink">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-subtle">{hint}</div> : null}
    </div>
  );
  if (!tip) return body;
  return (
    <Hint label={tip}>
      <div className="min-w-0">{body}</div>
    </Hint>
  );
}
