import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function SampleChip({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        "border-teal/35 bg-teal/10 text-[10px] font-semibold uppercase tracking-wide text-teal",
        className,
      )}
      title="Sample workspace data"
    >
      Sample
    </Badge>
  );
}
