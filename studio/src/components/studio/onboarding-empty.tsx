"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useApiMode } from "@/context/api-mode";
import { seedDemo } from "@/lib/api";
import { friendlySampleError } from "@/lib/sample-data";
import { maskKey, readSession } from "@/lib/session";

export function OnboardingEmpty({
  title = "No traces in this project yet",
  onSeeded,
}: {
  title?: string;
  onSeeded?: () => void;
}) {
  const { switchToDemo, refresh } = useApiMode();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const session = typeof window !== "undefined" ? readSession() : null;
  const apiKey = session?.apiKey;

  async function onLoadSample() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await seedDemo();
      if (result.added === 0 && result.skipped > 0) {
        setMessage("Sample data is already loaded.");
      } else {
        setMessage("Sample data loaded.");
      }
      refresh();
      onSeeded?.();
    } catch (err) {
      setMessage(friendlySampleError(err, "Couldn’t load sample data. Try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card-surface mx-auto max-w-2xl px-5 py-8">
      <h2 className="section-title text-ink">{title}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Load curated sample traces, or send your own with the SDK.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onLoadSample} disabled={loading}>
          {loading ? "Loading…" : "Load sample data"}
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/settings/">Open Settings</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/evaluators/">Create an evaluator</Link>
        </Button>
      </div>
      {message ? <p className="mt-3 text-xs text-ink-muted">{message}</p> : null}
      {apiKey ? (
        <div className="mt-5">
          <div className="text-sm font-medium text-ink">Send a trace</div>
          <p className="mt-0.5 text-xs text-ink-muted">
            Use your project key ({maskKey(apiKey)}) with the Python SDK.
          </p>
          <pre className="mono mt-2 max-h-36 overflow-auto rounded-lg border border-hairline bg-paper p-3 text-[11px] leading-relaxed text-ink">
            {`from evalverse import EvalVerse

ev = EvalVerse(api_key="${apiKey}")
with ev.trace("my_agent") as t:
    t.log(input={"question": "…"}, output={"answer": "…"})
`}
          </pre>
        </div>
      ) : null}
      <div className="mt-6 border-t border-hairline pt-4">
        <button
          type="button"
          className="text-sm font-medium text-accent hover:text-accent-hover hover:underline"
          onClick={switchToDemo}
        >
          Explore demo data
        </button>
      </div>
    </div>
  );
}
