"use client";

import { useMemo, useState } from "react";

type Tok = { t: "kw" | "str" | "num" | "cm" | "fn" | "op" | "plain"; v: string };

const KW =
  /\b(from|import|as|with|def|class|return|True|False|None|const|let|var|await|async|new|curl|POST|GET|Authorization|X-Project|Content-Type)\b/g;

/** Lightweight highlighter — no syntax-highlighter dependency. */
export function highlight(src: string): Tok[] {
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
          const next = line[j];
          if (next === "(") out.push({ t: "fn", v: word });
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

export function HighlightedCode({ code, label }: { code: string; label?: string }) {
  const tokens = useMemo(() => highlight(code), [code]);
  const [copied, setCopied] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--mk-line)] bg-[#070d18]">
      <div className="flex items-center justify-between border-b border-[var(--mk-line)] px-3 py-2">
        <span className="mk-mono text-[11px] uppercase tracking-wide text-[var(--mk-muted)]">
          {label || "code"}
        </span>
        <button
          type="button"
          className="mk-btn mk-btn-secondary min-h-[36px] px-3 text-[11px]"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mk-code max-h-[380px] overflow-auto p-4">
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
    </div>
  );
}
