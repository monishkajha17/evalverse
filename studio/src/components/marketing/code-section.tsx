"use client";

import { useState } from "react";
import { HighlightedCode } from "@/components/marketing/highlighted-code";
import { CURL_SNIPPET, OTEL_SNIPPET, SDK_SNIPPET } from "@/components/marketing/snippets";

const TABS = [
  { id: "sdk", label: "Python SDK", code: SDK_SNIPPET, file: "sdk.py" },
  { id: "otel", label: "OpenTelemetry", code: OTEL_SNIPPET, file: "otlp" },
  { id: "curl", label: "curl", code: CURL_SNIPPET, file: "curl" },
] as const;

export function CodeSection() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("sdk");
  const active = TABS.find((t) => t.id === tab) || TABS[0];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Code examples">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`mk-mono min-h-[44px] rounded-md px-3 text-xs ${
              tab === t.id
                ? "bg-[rgba(142,197,255,0.12)] text-[var(--mk-accent)]"
                : "text-[var(--mk-muted)] hover:text-[var(--mk-text)]"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <HighlightedCode code={active.code} label={active.file} />
    </div>
  );
}
