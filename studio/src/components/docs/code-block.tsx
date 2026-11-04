"use client";

import { useMemo, useState } from "react";

type Tok = { t: "kw" | "str" | "num" | "cm" | "fn" | "op" | "plain"; v: string };

const KW =
  /\b(from|import|as|with|def|class|return|True|False|None|const|let|var|await|async|new|curl|export|function|if|else|for|while|try|except|raise|pass|yield|and|or|not|in|is)\b/g;

function highlight(src: string): Tok[] {
  const out: Tok[] = [];
  const lines = src.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.trimStart().startsWith("#") || line.trimStart().startsWith("//")) {
      out.push({ t: "cm", v: line });
    } else {
      let i = 0;
      while (i < line.length) {
        if (line[i] === '"' || line[i] === "'") {
          const q = line[i];
          let j = i + 1;
          while (j < line.length && line[j] !== q) {
            if (line[j] === "\\") j++;
            j++;
          }
          out.push({ t: "str", v: line.slice(i, j + 1) });
          i = j + 1;
          continue;
        }
        if (/[0-9]/.test(line[i]) && (i === 0 || /[\s([{,=:]/.test(line[i - 1] || " "))) {
          let j = i;
          while (j < line.length && /[0-9._]/.test(line[j])) j++;
          out.push({ t: "num", v: line.slice(i, j) });
          i = j;
          continue;
        }
        if (/[A-Za-z_]/.test(line[i])) {
          let j = i;
          while (j < line.length && /[A-Za-z0-9_.]/.test(line[j])) j++;
          const word = line.slice(i, j);
          if (line[j] === "(") out.push({ t: "fn", v: word });
          else if (KW.test(word)) {
            KW.lastIndex = 0;
            out.push({ t: "kw", v: word });
          } else {
            KW.lastIndex = 0;
            out.push({ t: "plain", v: word });
          }
          i = j;
          continue;
        }
        out.push({ t: /[{}[\]().,=:\\/<>]/.test(line[i]) ? "op" : "plain", v: line[i] });
        i++;
      }
    }
    if (li < lines.length - 1) out.push({ t: "plain", v: "\n" });
  }
  return out;
}

export function CodeBlock({
  code,
  language = "text",
  bare = false,
}: {
  code: string;
  language?: string;
  bare?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlight(code), [code]);

  const copyBtn = (
    <button
      type="button"
      className="mk-btn mk-btn-secondary min-h-[32px] px-2 text-[11px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );

  const pre = (
    <pre className="mk-code docs-code-pre">
      <code>
        {tokens.map((tok, i) =>
          tok.t === "plain" ? (
            <span key={i}>{tok.v}</span>
          ) : (
            <span key={i} className={`tok-${tok.t}`}>
              {tok.v}
            </span>
          ),
        )}
      </code>
    </pre>
  );

  if (bare) {
    return (
      <div>
        <div className="docs-code-bar" style={{ borderBottom: "1px solid var(--mk-line)" }}>
          <span className="mk-mono text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">
            {language || "code"}
          </span>
          {copyBtn}
        </div>
        {pre}
      </div>
    );
  }

  return (
    <div className="docs-code">
      <div className="docs-code-bar">
        <span className="mk-mono text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">
          {language || "code"}
        </span>
        {copyBtn}
      </div>
      {pre}
    </div>
  );
}
