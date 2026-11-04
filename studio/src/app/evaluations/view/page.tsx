"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { VerdictChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { useApiMode } from "@/context/api-mode";
import { getEvaluation, type EvaluationRun } from "@/lib/api";
import { statusChipClass } from "@/lib/trace-helpers";
import { pct } from "@/lib/utils";

function Inner() {
  const id = useSearchParams().get("id") || "";
  const { mode } = useApiMode();
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "live" || !id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getEvaluation(id)
      .then((r) => {
        if (!cancelled) setRun(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, id]);

  return (
    <>
      <Topbar title="Evaluation run" />
      <main className="space-y-3 p-4">
        <Link href="/evaluations/" className="text-xs text-teal hover:underline">
          ← Evaluations
        </Link>
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}
        {!id ? <EmptyBlock title="Missing run id" /> : null}
        {run ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-sm font-semibold">{run.id}</h2>
              <Badge className={statusChipClass(run.status)}>{run.status}</Badge>
            </div>
            <div className="overflow-auto rounded-lg border border-border bg-white">
              <table className="sticky-table w-full min-w-[800px] border-collapse text-left text-xs">
                <thead>
                  <tr className="text-ink/60">
                    <th className="px-3 py-2">Trace</th>
                    <th className="px-3 py-2">Evaluator</th>
                    <th className="px-3 py-2">Dimension</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Verdict</th>
                    <th className="px-3 py-2">Label</th>
                    <th className="px-3 py-2">Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {(run.results || []).map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        {r.trace_id ? (
                          <Link
                            className="text-teal hover:underline"
                            href={`/traces/view/?id=${encodeURIComponent(r.trace_id)}`}
                          >
                            {r.trace_id.slice(0, 16)}…
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5">{r.evaluator_id}</td>
                      <td className="px-3 py-1.5">{r.dimension || "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{pct(r.score, 0)}</td>
                      <td className="px-3 py-1.5">
                        <VerdictChip verdict={r.verdict} />
                      </td>
                      <td className="px-3 py-1.5">{r.label || "—"}</td>
                      <td className="max-w-sm truncate px-3 py-1.5 text-ink/70">{r.explanation || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

export default function EvaluationViewPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Inner />
    </Suspense>
  );
}
