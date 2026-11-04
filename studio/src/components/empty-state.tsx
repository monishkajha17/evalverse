import { Inbox } from "lucide-react";

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
      <Inbox className="h-6 w-6 text-grey" />
      <div className="text-sm font-medium text-ink">{title}</div>
      {detail ? <p className="max-w-sm text-xs text-ink/55">{detail}</p> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading suite…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-8 text-sm text-ink/60">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-teal border-r-transparent" />
      {label}
    </div>
  );
}
