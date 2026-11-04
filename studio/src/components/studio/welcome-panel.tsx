"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearWelcomePending, findSampleTraceId } from "@/lib/sample-data";
import { maskKey, readSession } from "@/lib/session";

function sdkSnippet(apiKey: string) {
  return `from evalverse import EvalVerse

ev = EvalVerse(api_key="${apiKey}")
with ev.trace("my_agent") as t:
    t.log(input={"question": "…"}, output={"answer": "…"})
`;
}

export function WelcomePanel({ onDismiss }: { onDismiss?: () => void }) {
  const [traceId, setTraceId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("evk_…");

  useEffect(() => {
    const session = readSession();
    if (session?.apiKey) setApiKey(session.apiKey);
    let cancelled = false;
    void findSampleTraceId().then((id) => {
      if (!cancelled) setTraceId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    clearWelcomePending();
    onDismiss?.();
  }

  return (
    <div className="card-surface relative mx-auto max-w-3xl px-5 py-6">
      <button
        type="button"
        className="absolute right-3 top-3 rounded-md p-1 text-ink-muted hover:bg-muted hover:text-ink"
        aria-label="Dismiss welcome"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="section-title text-ink">Welcome</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Your project is ready. Here are three quick ways to start.
      </p>
      <ol className="mt-5 space-y-4">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            1
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Look at a sample trace</div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Inspect spans, media, and evaluator evidence from the sample workspace.
            </p>
            {traceId ? (
              <Button asChild size="sm" className="mt-2">
                <Link href={`/traces/view/?id=${encodeURIComponent(traceId)}`}>Open sample trace</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link href="/traces/">Browse traces</Link>
              </Button>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            2
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Send your own trace</div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Use your project key ({maskKey(apiKey)}) with the Python SDK.
            </p>
            <pre className="mono mt-2 max-h-40 overflow-auto rounded-lg border border-hairline bg-paper p-3 text-[11px] leading-relaxed text-ink">
              {sdkSnippet(apiKey)}
            </pre>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            3
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">Create an evaluator</div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Score new traces with a rubric that matches your product.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2">
              <Link href="/evaluators/">Open evaluators</Link>
            </Button>
          </div>
        </li>
      </ol>
    </div>
  );
}
