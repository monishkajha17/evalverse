#!/usr/bin/env node
// Verify internal /docs links in content/docs Markdown files resolve to a page.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "content/docs");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function slugFromFile(file) {
  let rel = path.relative(DOCS, file).replace(/\\/g, "/").replace(/\.md$/, "");
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);
  return rel;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { body: raw, data: {} };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { body: raw, data: {} };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4);
  const data = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { body, data };
}

function headings(body) {
  const ids = new Set();
  for (const line of body.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (!m) continue;
    const id = m[1]
      .toLowerCase()
      .replace(/[`*_]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    ids.add(id);
  }
  return ids;
}

function main() {
  const files = walk(DOCS);
  const pages = new Map();
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf8");
    const { body } = parseFrontmatter(raw);
    const slug = slugFromFile(f);
    const hs = headings(body);
    pages.set(slug, hs);
    pages.set(slug + "/", hs);
  }
  pages.set("", pages.get("overview") || new Set());
  pages.set("index", pages.get("overview") || new Set());

  const linkRe = /\]\((\/docs\/[^)#\s]+)(?:#([^)]+))?\)/g;
  let errors = 0;
  let checked = 0;
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf8");
    let m;
    while ((m = linkRe.exec(raw))) {
      if (/\.(png|jpe?g|gif|svg|webp|pdf|txt)$/i.test(m[1])) continue;
      checked += 1;
      let target = m[1].replace(/\/$/, "");
      target = target.replace(/^\/docs\/?/, "") || "overview";
      const hash = m[2];
      const ok =
        pages.has(target) ||
        pages.has(target + "/") ||
        pages.has(target + "/index") ||
        pages.has(target.replace(/\/index$/, ""));
      if (!ok) {
        console.error(`BROKEN ${path.relative(ROOT, f)} -> /docs/${target}/`);
        errors += 1;
        continue;
      }
      if (hash) {
        const hs =
          pages.get(target) ||
          pages.get(target.replace(/\/index$/, "")) ||
          new Set();
        if (hs.size && ![...hs].some((h) => h === hash || h.includes(hash))) {
          console.warn(`WARN  ${path.relative(ROOT, f)} -> #${hash} (heading not found in ${target})`);
        }
      }
    }
  }
  console.log(`Checked ${checked} internal /docs links across ${files.length} pages.`);
  if (errors) {
    console.error(`${errors} broken link(s).`);
    process.exit(1);
  }
  console.log("All internal /docs page links resolve.");
}

main();
