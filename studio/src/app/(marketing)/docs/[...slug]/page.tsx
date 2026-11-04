import { notFound } from "next/navigation";
import { DocShell } from "@/components/docs/doc-shell";
import {
  buildSearchIndex,
  getAdjacent,
  getAllDocs,
  getDocBySlug,
  getDocTree,
} from "@/components/docs/content";

export function generateStaticParams() {
  return getAllDocs().map((d) => ({ slug: d.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = getDocBySlug(slug || []);
  return { title: page ? `${page.title} · EvalVerse Docs` : "Docs · EvalVerse" };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = getDocBySlug(slug || []);
  if (!page) notFound();
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
