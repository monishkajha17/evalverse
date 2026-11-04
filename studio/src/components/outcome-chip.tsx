import { Badge } from "@/components/ui/badge";
import { outcomeMeta, verdictMeta } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function OutcomeChip({ label, className }: { label?: string | null; className?: string }) {
  const meta = outcomeMeta(label);
  return (
    <Badge className={cn(meta.bg, meta.fg, meta.border, className)} title={label || undefined}>
      {meta.text}
    </Badge>
  );
}

export function VerdictChip({ verdict }: { verdict?: string | null }) {
  const meta = verdictMeta(verdict);
  return <Badge className={meta.className}>{meta.text}</Badge>;
}

export function StatusDot({
  verdict,
  label,
}: {
  verdict?: string | null;
  label?: string | null;
}) {
  const v = (verdict || "").toLowerCase();
  const color =
    v === "pass"
      ? "bg-teal"
      : v === "fail"
        ? "bg-crimson"
        : v === "not_applicable"
          ? "bg-grey"
          : "bg-slateish";
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", color)}
      title={`${label || "result"}: ${verdict || "unknown"}`}
      aria-label={`${label || "result"} ${verdict || "unknown"}`}
    />
  );
}
