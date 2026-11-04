import { DocShell } from "@/components/docs/doc-shell";
import {
  buildSearchIndex,
  getAdjacent,
  getDocBySlug,
  getDocTree,
} from "@/components/docs/content";

export default function DocsIndexPage() {
  const page = getDocBySlug(["overview"]);
  if (!page) {
    return (
      <div className="px-6 py-16 text-sm text-[var(--mk-muted)]">
        Overview missing. Add <code className="mk-mono">content/docs/overview.md</code>.
      </div>
    );
  }
  const { prev, next } = getAdjacent(page.slug);
  return (
    <DocShell
      page={page}
      tree={getDocTree()}
      searchIndex={buildSearchIndex()}
      prev={prev}
      next={next}
    />
  );
}
