"use client";

import { Check, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { describeSuite, orderedDemoSuites } from "@/lib/demo-suites";
import { cn } from "@/lib/utils";

export function DataSourceControl() {
  const { mode, checking, projectLabel, signedIn } = useApiMode();
  const { index, suite, setSuite, entry } = useSuite();
  const demos = orderedDemoSuites(index);
  const current = entry ? describeSuite(entry) : demos.find((d) => d.suite === suite);

  // Never show Live while falling back to demo (mode is snapshot whenever API is down).
  const live = mode === "live";
  const statusLabel =
    checking && signedIn && !live
      ? "Checking…"
      : live
        ? `Live · ${projectLabel || "default"}`
        : "Demo data";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Badge
        data-studio-chip
        className={cn(
          "studio-chip max-w-[160px] truncate border",
          live ? "chip-pass" : "",
        )}
        title={live ? `Project ${projectLabel}` : "Browsing recorded demo suites"}
      >
        {statusLabel}
      </Badge>

      {live ? (
        <span className="hidden truncate text-xs text-ink-muted sm:inline" title={projectLabel}>
          Project {projectLabel || "default"}
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-studio-select
              className="studio-select inline-flex max-w-[220px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              aria-label="Choose demo data"
            >
              <span className="truncate">{current?.title || "Demo data"}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Demo data</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {demos.map((d) => (
              <DropdownMenuItem
                key={d.suite}
                className="flex items-start gap-2 py-2"
                onSelect={() => setSuite(d.suite)}
              >
                <span className="mt-0.5 w-3.5 shrink-0 text-teal">
                  {d.suite === suite ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{d.title}</span>
                  <span className="block text-xs text-ink-muted">{d.description}</span>
                </span>
              </DropdownMenuItem>
            ))}
            {!demos.length ? (
              <div className="px-2 py-3 text-xs text-ink-muted">No demo suites available yet.</div>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
