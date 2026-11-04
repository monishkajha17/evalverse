#!/usr/bin/env node
/**
 * Generate Markdown API reference pages from content/openapi.json.
 * Preserves hand-written pages (generated: false / missing flag).
 * Usage: node scripts/gen-api-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OPENAPI = path.join(ROOT, "content/openapi.json");
const OUT_DIR = path.join(ROOT, "content/docs/api");

function loadOpenApi() {
  if (!fs.existsSync(OPENAPI)) {
    console.error(`Missing ${OPENAPI}. Start the server and curl /openapi.json into content/.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(OPENAPI, "utf8"));
}

function tagForPath(p) {
  const parts = p.replace(/^\//, "").split("/");
  if (parts[0] === "api" && parts[1] === "v1" && parts[2]) return parts[2];
  if (parts[0] === "v1") return "otlp";
  return parts[0] || "root";
}

function resolveRef(spec, schema) {
  if (!schema) return schema;
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    return spec.components?.schemas?.[name] || schema;
  }
  return schema;
}

function schemaType(spec, schema, depth = 0) {
  if (!schema || depth > 4) return "object";
  const s = resolveRef(spec, schema);
  if (s.oneOf) return s.oneOf.map((x) => schemaType(spec, x, depth + 1)).join(" | ");
  if (s.anyOf) return s.anyOf.map((x) => schemaType(spec, x, depth + 1)).join(" | ");
  if (s.type === "array") return `array[${schemaType(spec, s.items, depth + 1)}]`;
  if (s.enum) return `enum(${s.enum.map(String).join(", ")})`;
  if (s.type) return s.type;
  if (s.properties) return "object";
  return "any";
}

function propsTable(spec, schema) {
  const s = resolveRef(spec, schema);
  if (!s?.properties) return "_No fields._\n";
  const req = new Set(s.required || []);
  let md = `| Field | Type | Required | Description |\n| --- | --- | --- | --- |\n`;
  for (const [name, prop] of Object.entries(s.properties)) {
    const p = resolveRef(spec, prop);
    const desc = (p.description || "").replace(/\n/g, " ");
    md += `| \`${name}\` | ${schemaType(spec, p)} | ${req.has(name) ? "yes" : ""} | ${desc} |\n`;
  }
  return md + "\n";
}

function paramsTable(spec, params = []) {
  if (!params.length) return "_None._\n";
  let md = `| Name | In | Type | Required | Description |\n| --- | --- | --- | --- | --- |\n`;
  for (const p of params) {
    const schema = p.schema || {};
    md += `| \`${p.name}\` | ${p.in} | ${schemaType(spec, schema)} | ${p.required ? "yes" : ""} | ${(p.description || "").replace(/\n/g, " ")} |\n`;
  }
  return md + "\n";
}

function exampleBody(spec, op) {
  const body = op.requestBody?.content?.["application/json"]?.schema;
  if (!body) return null;
  const s = resolveRef(spec, body);
  if (s.example) return s.example;
  if (op.requestBody?.content?.["application/json"]?.example) {
    return op.requestBody.content["application/json"].example;
  }
  if (s.properties) {
    const out = {};
    for (const [k, v] of Object.entries(s.properties)) {
      const p = resolveRef(spec, v);
      if (p.example !== undefined) out[k] = p.example;
      else if (p.type === "string") out[k] = "string";
      else if (p.type === "integer" || p.type === "number") out[k] = 0;
      else if (p.type === "boolean") out[k] = true;
      else if (p.type === "array") out[k] = [];
      else if (p.type === "object" || p.properties) out[k] = {};
    }
    return out;
  }
  return {};
}

function responseExample(op) {
  const res = op.responses?.["200"] || op.responses?.["201"] || op.responses?.["204"];
  if (!res) return null;
  const content = res.content?.["application/json"];
  if (content?.example) return content.example;
  return { status: "ok" };
}

function curlExample(method, p, body) {
  const lines = [
    `curl -s -X ${method} 'http://127.0.0.1:8000${p}' \\`,
    `  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \\`,
    `  -H 'X-Project: default' \\`,
  ];
  if (body != null && method !== "GET" && method !== "DELETE") {
    lines.push(`  -H 'Content-Type: application/json' \\`);
    const json = JSON.stringify(body, null, 2)
      .split("\n")
      .map((l, i) => (i === 0 ? l : `  ${l}`))
      .join("\n");
    lines.push(`  -d '${json.replace(/'/g, "'\\''")}'`);
  } else {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, "");
  }
  return lines.join("\n");
}

function titleCase(tag) {
  return tag
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function slugify(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function isHandWritten(file) {
  if (!fs.existsSync(file)) return false;
  const raw = fs.readFileSync(file, "utf8");
  if (/^generated:\s*true/m.test(raw)) return false;
  if (/^generated:\s*false/m.test(raw)) return true;
  // Preserve known static API primers
  const base = path.basename(file);
  return ["authentication.md", "errors.md", "rate-limits.md"].includes(base);
}

function main() {
  const spec = loadOpenApi();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith(".md")) continue;
    const full = path.join(OUT_DIR, f);
    if (isHandWritten(full)) {
      console.log(`keep ${f}`);
      continue;
    }
    fs.unlinkSync(full);
  }

  const byTag = new Map();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      if (typeof op !== "object") continue;
      const tag = (op.tags && op.tags[0]) || tagForPath(p);
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ method: method.toUpperCase(), path: p, op });
    }
  }

  const tags = [...byTag.keys()].sort();
  let order = 110;
  const indexLinks = [
    "- [Authentication](/docs/api/authentication/)",
    "- [Errors](/docs/api/errors/)",
    "- [Rate limits](/docs/api/rate-limits/)",
  ];

  for (const tag of tags) {
    order += 1;
    const slug = slugify(tag);
    const title = titleCase(tag);
    indexLinks.push(`- [${title}](/docs/api/${slug}/)`);
    let md = `---\ntitle: ${title}\ndescription: ${title} endpoints from the EvalVerse OpenAPI document.\norder: ${order}\ngroup: API reference\ngenerated: true\n---\n\n`;
    md += `# ${title}\n\n`;
    md += `Generated from \`content/openapi.json\` (EvalVerse ${spec.info?.version || ""}). Every example includes \`Authorization\` and \`X-Project\`.\n\n`;

    for (const { method, path: p, op } of byTag.get(tag)) {
      const heading = `\`${method}\` ${p}`;
      const example = exampleBody(spec, op);
      const resp = responseExample(op);

      md += `:::endpoint ${heading}\n\n`;
      if (op.description) md += `${op.description}\n\n`;
      else if (op.summary) md += `${op.summary}\n\n`;

      md += `### Parameters\n\n`;
      md += paramsTable(spec, op.parameters || []);

      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchema) {
        md += `### Request body\n\n`;
        md += propsTable(spec, bodySchema);
      } else if (op.requestBody) {
        md += `### Request body\n\n_Non-JSON or multipart body (see OpenAPI)._\n\n`;
      }

      md += `\n:::examples\n\n`;
      md += `### Request\n\n`;
      md += "```bash\n" + curlExample(method, p, example) + "\n```\n\n";
      if (resp) {
        md += `### Response\n\n`;
        md += "```json\n" + JSON.stringify(resp, null, 2) + "\n```\n\n";
      }
      md += `:::\n\n`;
    }

    fs.writeFileSync(path.join(OUT_DIR, `${slug}.md`), md);
    console.log(`wrote api/${slug}.md (${byTag.get(tag).length} endpoints)`);
  }

  const index = `---
title: API reference
description: REST and OTLP surfaces for EvalVerse, generated from OpenAPI.
order: 40
group: API reference
generated: true
---

# API reference

Start with authentication, then errors and rate limits. Tag pages below are generated from \`content/openapi.json\` by \`npm run docs:gen\`.

${indexLinks.join("\n")}
`;
  fs.writeFileSync(path.join(OUT_DIR, "index.md"), index);
  console.log(`wrote api/index.md (${tags.length} tags)`);
}

main();
