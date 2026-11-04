import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { slugifyHeading } from "@/components/docs/slug";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
  group: string;
  generated?: boolean;
  filePath: string;
  lastUpdated: string;
};

export type DocPage = DocMeta & {
  body: string;
  headings: Array<{ id: string; text: string; level: number }>;
};

export { slugifyHeading };

const DOCS_ROOT = path.join(process.cwd(), "content/docs");

const GROUP_ORDER = ["Start", "Concepts", "Guides", "SDK", "API reference", "Reference"];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function extractHeadings(body: string): DocPage["headings"] {
  const headings: DocPage["headings"] = [];
  let endpointPrefix = "";
  let inExamples = false;
  for (const line of body.split("\n")) {
    const ep = line.match(/^:::endpoint(?:\s+(.*))?$/);
    if (ep) {
      endpointPrefix = slugifyHeading((ep[1] || "endpoint").trim());
      inExamples = false;
      if (ep[1]?.trim()) {
        headings.push({ id: endpointPrefix, text: ep[1].trim(), level: 2 });
      }
      continue;
    }
    if (line.startsWith(":::examples")) {
      inExamples = true;
      continue;
    }
    if (line.trim() === ":::") {
      endpointPrefix = "";
      inExamples = false;
      continue;
    }
    const m = line.match(/^(#{2,4})\s+(.+)$/);
    if (!m) continue;
    const text = m[2].replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    const base = slugifyHeading(text);
    const id = endpointPrefix
      ? `${endpointPrefix}-${inExamples ? "right" : "left"}--${base}`
      : base;
    headings.push({ id, text, level: m[1].length });
  }
  return headings;
}

function firstParagraph(body: string): string {
  const lines = body.split("\n");
  const buf: string[] = [];
  let started = false;
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (!line.trim()) {
      if (started) break;
      continue;
    }
    if (line.startsWith("```") || line.startsWith("|") || line.startsWith(">")) {
      if (started) break;
      continue;
    }
    started = true;
    buf.push(line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, ""));
    if (buf.join(" ").length > 220) break;
  }
  return buf.join(" ").trim().slice(0, 240);
}

function fileToSlug(file: string): string {
  let rel = path.relative(DOCS_ROOT, file).replace(/\\/g, "/").replace(/\.md$/, "");
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  return rel;
}

function isoDate(file: string, fromFm?: string): string {
  if (fromFm) return fromFm;
  try {
    return fs.statSync(file).mtime.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export function listDocFiles(): string[] {
  return walk(DOCS_ROOT).sort();
}

export function getAllDocs(): DocPage[] {
  const pages: DocPage[] = [];
  for (const file of listDocFiles()) {
    const raw = fs.readFileSync(file, "utf8");
    const { data, content } = matter(raw);
    const slug = fileToSlug(file);
    const rel = path.relative(DOCS_ROOT, file).replace(/\\/g, "/");
    pages.push({
      slug,
      title: String(data.title || slug),
      description: String(data.description || firstParagraph(content) || ""),
      order: Number(data.order ?? 999),
      group: String(data.group || "Docs"),
      generated: Boolean(data.generated),
      filePath: rel,
      lastUpdated: isoDate(file, data.updated ? String(data.updated) : undefined),
      body: content,
      headings: extractHeadings(content),
    });
  }
  return pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getDocBySlug(slugParts: string[]): DocPage | null {
  const slug = slugParts.join("/");
  return getAllDocs().find((d) => d.slug === slug) || null;
}

export function getDocTree(): Array<{ group: string; items: DocMeta[] }> {
  const all = getAllDocs();
  const groups: string[] = [];
  const map = new Map<string, DocMeta[]>();
  for (const d of all) {
    if (!map.has(d.group)) {
      map.set(d.group, []);
      groups.push(d.group);
    }
    map.get(d.group)!.push({
      slug: d.slug,
      title: d.title,
      description: d.description,
      order: d.order,
      group: d.group,
      generated: d.generated,
      filePath: d.filePath,
      lastUpdated: d.lastUpdated,
    });
  }
  groups.sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return groups.map((g) => ({
    group: g,
    items: (map.get(g) || []).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  }));
}

export function getAdjacent(slug: string): { prev: DocMeta | null; next: DocMeta | null } {
  const all = getAllDocs();
  const i = all.findIndex((d) => d.slug === slug);
  if (i < 0) return { prev: null, next: null };
  return {
    prev: i > 0 ? all[i - 1] : null,
    next: i < all.length - 1 ? all[i + 1] : null,
  };
}

export type SearchItem = {
  slug: string;
  title: string;
  heading?: string;
  headingId?: string;
  excerpt?: string;
};

export function buildSearchIndex(): SearchItem[] {
  const items: SearchItem[] = [];
  for (const d of getAllDocs()) {
    items.push({
      slug: d.slug,
      title: d.title,
      excerpt: d.description || firstParagraph(d.body),
    });
    for (const h of d.headings) {
      items.push({
        slug: d.slug,
        title: d.title,
        heading: h.text,
        headingId: h.id,
        excerpt: d.description,
      });
    }
  }
  return items;
}

export function githubEditUrl(filePath: string): string {
  return `https://github.com/monishkajha17/evalverse/edit/main/studio/content/docs/${filePath}`;
}
