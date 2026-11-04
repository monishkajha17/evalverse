import "@/components/docs/docs.css";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <div className="docs-root border-t border-[var(--mk-line)]">{children}</div>;
}
