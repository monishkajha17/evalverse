import Link from "next/link";

export default function DocsNotFound() {
  return (
    <div className="mx-auto max-w-lg px-6 py-24">
      <p className="mk-label">Docs</p>
      <h1 className="mk-headline mt-3 text-4xl">Page not found</h1>
      <p className="mt-4 text-sm text-[var(--mk-muted)]">
        That documentation path is not in the tree. Try Overview or use search in the sidebar.
      </p>
      <Link href="/docs/overview/" className="mk-btn mk-btn-primary mt-8 inline-flex">
        Back to Overview
      </Link>
    </div>
  );
}
