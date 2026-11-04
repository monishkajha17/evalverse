import Link from "next/link";
import type { DocMeta } from "@/components/docs/content";

export function DocPrevNext({ prev, next }: { prev: DocMeta | null; next: DocMeta | null }) {
  if (!prev && !next) return null;
  return (
    <div className="docs-prevnext">
      {prev ? (
        <Link href={`/docs/${prev.slug}/`}>
          <div className="mk-mono text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">Previous</div>
          <div className="mt-1 text-sm">{prev.title}</div>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={`/docs/${next.slug}/`} className="text-right">
          <div className="mk-mono text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">Next</div>
          <div className="mt-1 text-sm">{next.title}</div>
        </Link>
      ) : null}
    </div>
  );
}
