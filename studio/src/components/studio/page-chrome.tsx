"use client";

import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink/60">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SkeletonBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-white p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-muted" style={{ width: `${88 - i * 8}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-white px-6 py-14 text-center">
      <Inbox className="h-7 w-7 text-grey" />
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        {detail ? <p className="mt-1 max-w-md text-xs text-ink/55">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-crimson/25 bg-crimson/5 px-4 py-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crimson" />
        <div>
          <div className="text-sm font-medium text-crimson">{title}</div>
          {detail ? <p className="mt-1 text-xs text-ink/65">{detail}</p> : null}
        </div>
      </div>
      {onRetry ? (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-8 text-sm text-ink/55">
      <Loader2 className="h-4 w-4 animate-spin text-teal" />
      {label}
    </div>
  );
}

export function OfflineBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/30 bg-amber/10 px-4 py-2 text-xs text-ink">
      <span>
        <span className="font-medium">Server offline.</span> Showing demo data until the connection returns.
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
