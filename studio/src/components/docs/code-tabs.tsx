"use client";

import { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "@/components/docs/code-block";

const STORAGE_KEY = "evalverse.docs.lang";

export function CodeTabs({
  languages,
  panes,
}: {
  languages: string[];
  panes: Record<string, string>;
}) {
  const [lang, setLang] = useState(languages[0] || "text");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && languages.includes(saved)) setLang(saved);
    } catch {
      /* ignore */
    }
  }, [languages]);

  const code = useMemo(() => panes[lang] || panes[languages[0]] || "", [panes, lang, languages]);

  function select(next: string) {
    setLang(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="docs-code" style={{ marginBottom: "1.5rem" }}>
      <div className="docs-tabs-bar" role="tablist" aria-label="Language">
        {languages.map((l) => (
          <button
            key={l}
            type="button"
            role="tab"
            aria-selected={l === lang}
            className={`docs-tab${l === lang ? " is-active" : ""}`}
            onClick={() => select(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <CodeBlock code={code.replace(/\n$/, "")} language={lang} bare />
    </div>
  );
}
