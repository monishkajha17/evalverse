import Link from "next/link";
import { DocMarkdown } from "@/components/docs/markdown";
import { DocPrevNext } from "@/components/docs/prev-next";
import { DocSidebar } from "@/components/docs/sidebar";
import { DocToc } from "@/components/docs/toc";
import {
  githubEditUrl,
  type DocPage,
  type DocMeta,
  type SearchItem,
} from "@/components/docs/content";

function Breadcrumb({ slug, title }: { slug: string; title: string }) {
  const parts = slug.split("/").filter(Boolean);
  const crumbs: Array<{ href: string; label: string }> = [{ href: "/docs/overview/", label: "Docs" }];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    const last = i === parts.length - 1;
    crumbs.push({
      href: `/docs/${acc}/`,
      label: last ? title : parts[i].replace(/-/g, " "),
    });
  }
  return (
    <nav className="docs-breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.href + i} className="docs-breadcrumb-item">
          {i > 0 ? <span className="docs-breadcrumb-sep" aria-hidden>/</span> : null}
          {i === crumbs.length - 1 ? (
            <span aria-current="page">{c.label}</span>
          ) : (
            <Link href={c.href}>{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export function DocShell({
  page,
  tree,
  searchIndex,
  prev,
  next,
}: {
  page: DocPage;
  tree: Array<{ group: string; items: DocMeta[] }>;
  searchIndex: SearchItem[];
  prev: DocMeta | null;
  next: DocMeta | null;
}) {
  // Prefer frontmatter title; strip a leading H1 from body so we don't double-render.
  const body = page.body.replace(/^#\s+.+\n+/, "");

  return (
    <div className="docs-shell">
      <DocSidebar tree={tree} searchIndex={searchIndex} />
      <div className="docs-main-wrap">
        <article className="docs-article">
          <Breadcrumb slug={page.slug} title={page.title} />
          <h1>{page.title}</h1>
          {page.description ? <p className="docs-desc">{page.description}</p> : null}
          <DocMarkdown body={body} />
          <div className="docs-meta-row">
            <a
              href={githubEditUrl(page.filePath)}
              target="_blank"
              rel="noreferrer"
              className="docs-edit-link"
            >
              Edit this page on GitHub
            </a>
            {page.lastUpdated ? (
              <span className="docs-updated">Last updated {page.lastUpdated}</span>
            ) : null}
          </div>
          <DocPrevNext prev={prev} next={next} />
        </article>
        <DocToc headings={page.headings} />
      </div>
    </div>
  );
}
