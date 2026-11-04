"use client";

import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: SegmentOption<T>[];
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full flex-wrap rounded-lg border border-border bg-muted p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              selected
                ? "bg-raised text-ink shadow-sm"
                : "text-ink-muted hover:text-ink",
            )}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
