"use client";

import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-8 text-sm text-ink/60">
      <Loader2 className="h-4 w-4 animate-spin text-teal" />
      {label}
    </div>
  );
}

export function EmptyBlock({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
      <Inbox className="h-6 w-6 text-grey" />
      <div className="text-sm font-medium text-ink">{title}</div>
      {detail ? <p className="max-w-md text-xs text-ink/55">{detail}</p> : null}
    </div>
  );
}

export function ErrorBlock({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-crimson/30 bg-crimson/5 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-crimson">
        <AlertTriangle className="h-4 w-4" />
        {title}
      </div>
      {detail ? <p className="text-xs text-ink/70">{detail}</p> : null}
    </div>
  );
}
