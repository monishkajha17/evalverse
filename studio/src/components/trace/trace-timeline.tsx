"use client";

import { useMemo } from "react";
import {
  buildTimelineBars,
  fmtMsShort,
  typeColor,
  type NormalizedSpan,
} from "@/lib/trace-model";
import { cn } from "@/lib/utils";

export function TraceTimeline({
  spans,
  selectedId,
  onSelect,
}: {
  spans: NormalizedSpan[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const bars = useMemo(() => buildTimelineBars(spans), [spans]);
  const maxEnd = Math.max(...bars.map((b) => b.startMs + b.durationMs), 1);
  const lanes = Math.max(...bars.map((b) => b.lane), 0) + 1;
  const rowH = 28;
  const height = Math.max(lanes * rowH + 28, 80);

  if (!bars.length) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center text-xs text-ink/45">
        No spans for timeline.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[200px] min-w-0 flex-col overflow-hidden rounded-xl border border-hairline bg-surface">
      <div className="min-w-0 flex-1 overflow-auto p-2">
        <div className="relative min-w-[480px]" style={{ height }}>
          {/* axis */}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <div
              key={p}
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed border-border/70"
              style={{ left: `${p * 100}%` }}
            >
              <span className="absolute top-0 left-0.5 text-[9px] text-ink/40">
                {fmtMsShort(maxEnd * p)}
              </span>
            </div>
          ))}
          {bars.map((b) => {
            const colors = typeColor(b.type);
            const left = (b.startMs / maxEnd) * 100;
            const width = Math.max((b.durationMs / maxEnd) * 100, 0.8);
            return (
              <button
                key={b.id}
                type="button"
                title={`${b.label} · ${fmtMsShort(b.durationMs)}`}
                onClick={() => onSelect?.(b.id)}
                className={cn(
                  "absolute flex items-center overflow-hidden rounded px-1.5 text-left text-[10px] font-medium transition-shadow",
                  selectedId === b.id && "ring-2 ring-teal/50",
                  b.failed && "ring-1 ring-crimson",
                )}
                style={{
                  top: 18 + b.lane * rowH,
                  left: `${left}%`,
                  width: `${width}%`,
                  height: rowH - 6,
                  background: colors.bg,
                  border: `1px solid ${b.failed ? "#D4285C" : colors.border}`,
                  color: colors.fg,
                }}
              >
                <span className="truncate">{b.label}</span>
                <span className="ml-auto shrink-0 pl-1 opacity-70">{fmtMsShort(b.durationMs)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
