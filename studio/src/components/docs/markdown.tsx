"use client";

import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { CodeBlock } from "@/components/docs/code-block";
import { CodeTabs } from "@/components/docs/code-tabs";
import { slugifyHeading } from "@/components/docs/slug";

type Segment =
  | { kind: "md"; text: string }
  | { kind: "tabs"; languages: string[]; panes: Record<string, string> }
  | { kind: "endpoint"; left: string; right: string; title: string };

/** Expand [!NOTE]/[!TIP]/[!WARNING] blockquotes into @@@callout markers. */
function transformCallouts(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^>\s*\[!(NOTE|TIP|WARNING)\]\s*$/i);
    if (!m) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const kind = m[1].toLowerCase();
    i += 1;
    const body: string[] = [];
    while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
      body.push(lines[i].replace(/^>\s?/, ""));
      i += 1;
    }
    out.push(`@@@callout:${kind}`);
    out.push(...body);
    out.push("@@@");
  }
  return out.join("\n");
}

/** Split ```tabs and :::endpoint blocks. */
export function splitDocBody(body: string): Segment[] {
  const segments: Segment[] = [];
  const re =
    /```tabs\s+([^\n]+)\n([\s\S]*?)```|:::endpoint(?:\s+([^\n]*))?\n([\s\S]*?):::/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) segments.push({ kind: "md", text: body.slice(last, m.index) });
    if (m[0].startsWith("```tabs")) {
      const languages = m[1]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      const panes: Record<string, string> = {};
      const paneRe = /<<<(\w+)\n([\s\S]*?)>>>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paneRe.exec(m[2]))) {
        panes[pm[1]] = pm[2].replace(/^\n/, "");
      }
      if (!Object.keys(panes).length) {
        const parts = m[2].split(/\n---\n/);
        languages.forEach((lang, i) => {
          panes[lang] = (parts[i] || "").trim() + "\n";
        });
      }
      segments.push({ kind: "tabs", languages, panes });
    } else {
      const title = (m[3] || "").trim();
      const inner = m[4] || "";
      const parts = inner.split(/\n:::examples\n/);
      segments.push({
        kind: "endpoint",
        title,
        left: (parts[0] || "").trim(),
        right: (parts[1] || "").trim(),
      });
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) segments.push({ kind: "md", text: body.slice(last) });
  return segments;
}

function heading(level: 2 | 3 | 4, idPrefix = "") {
  return function Heading({ children }: { children?: ReactNode }) {
    const text = flattenText(children);
    const base = slugifyHeading(text);
    const id = idPrefix ? `${idPrefix}--${base}` : base;
    const Tag = level === 2 ? "h2" : level === 3 ? "h3" : "h4";
    return (
      <Tag id={id} className="docs-heading">
        <a href={`#${id}`} className="docs-anchor" aria-label={`Link to ${text}`}>
          #
        </a>
        {children}
      </Tag>
    );
  };
}

function flattenText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return flattenText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

function makeComponents(idPrefix = ""): Components {
  return {
    h2: heading(2, idPrefix),
    h3: heading(3, idPrefix),
    h4: heading(4, idPrefix),
    a: ({ href, children }) => (
      <a
        href={href}
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noreferrer" : undefined}
      >
        {children}
      </a>
    ),
    img: ({ src, alt }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src || ""} alt={alt || ""} className="my-4 max-w-full rounded-lg border border-[var(--mk-line)]" />
    ),
    blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    code: ({ className, children, ...props }) => {
      const text = String(children).replace(/\n$/, "");
      const match = /language-([\w-]+)/.exec(className || "");
      const inline = !className && !String(children).includes("\n");
      if (inline) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return <CodeBlock code={text} language={match?.[1] || "text"} />;
    },
    pre: ({ children }) => <>{children}</>,
  };
}

const components = makeComponents();

/** Parse @@@callout markers into React (avoid rehype-raw dependency). */
function renderWithCallouts(text: string, idPrefix = "") {
  const comps = idPrefix ? makeComponents(idPrefix) : components;
  const re = /@@@callout:(note|tip|warning)\n([\s\S]*?)@@@/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      nodes.push(
        <ReactMarkdown key={`m-${key++}`} remarkPlugins={[remarkGfm]} components={comps}>
          {text.slice(last, m.index)}
        </ReactMarkdown>,
      );
    }
    nodes.push(
      <aside key={`c-${key++}`} className={`docs-callout docs-callout-${m[1]}`} data-callout={m[1]}>
        <div className="docs-callout-label">{m[1]}</div>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={comps}>
          {m[2].trim()}
        </ReactMarkdown>
      </aside>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(
      <ReactMarkdown key={`m-${key++}`} remarkPlugins={[remarkGfm]} components={comps}>
        {text.slice(last)}
      </ReactMarkdown>,
    );
  }
  return nodes;
}

function MdChunk({ text, idPrefix = "" }: { text: string; idPrefix?: string }) {
  return <>{renderWithCallouts(transformCallouts(text), idPrefix)}</>;
}

function EndpointBlock({ title, left, right }: { title: string; left: string; right: string }) {
  const prefix = slugifyHeading(title || "endpoint");
  return (
    <div className="docs-api-endpoint">
      {title ? (
        <h2 id={prefix} className="docs-heading docs-api-title">
          <a href={`#${prefix}`} className="docs-anchor" aria-label={`Link to ${title}`}>
            #
          </a>
          {title}
        </h2>
      ) : null}
      <div className="docs-api-grid">
        <div className="docs-api-left">
          <MdChunk text={left} idPrefix={`${prefix}-left`} />
        </div>
        <div className="docs-api-right">
          <div className="docs-api-sticky">
            <div className="mk-label mb-2">Try it</div>
            <MdChunk text={right} idPrefix={`${prefix}-right`} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DocMarkdown({ body }: { body: string }) {
  const segments = splitDocBody(body);
  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.kind === "md") return <MdChunk key={i} text={seg.text} />;
        if (seg.kind === "tabs")
          return <CodeTabs key={i} languages={seg.languages} panes={seg.panes} />;
        return <EndpointBlock key={i} title={seg.title} left={seg.left} right={seg.right} />;
      })}
    </div>
  );
}
