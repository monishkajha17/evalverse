"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { Badge } from "@/components/ui/badge";
import { useApiMode } from "@/context/api-mode";
import {
  getEvaluation,
  getExperiment,
  listExperiments,
  rememberedEvalRuns,
  type EvaluationRun,
} from "@/lib/api";
import { statusChipClass } from "@/lib/trace-helpers";

export default function EvaluationsPage() {
  const { mode } = useApiMode();
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "live") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids = new Set(rememberedEvalRuns());
        const exps = await listExperiments();
        for (const exp of exps.slice(0, 20)) {
          try {
            const detail = await getExperiment(exp.id);
            for (const r of detail.runs || []) {
              if (r.eval_run_id) ids.add(r.eval_run_id);
            }
          } catch {
            /* skip */
          }
        }
        const loaded: EvaluationRun[] = [];
        for (const id of [...ids].slice(0, 40)) {
          try {
            loaded.push(await getEvaluation(id));
          } catch {
            /* skip missing */
          }
        }
        if (!cancelled) setRuns(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load evaluations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    <>
      <Topbar title="Evaluations" />
      <main className="space-y-3 p-4">
        {mode === "snapshot" ? (
          <EmptyBlock title="Live mode required" detail="Evaluation runs are stored on the API." />
        ) : null}
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}
        {!loading && mode === "live" && runs.length === 0 ? (
          <EmptyBlock
            title="No evaluation runs yet"
            detail="Trigger Evaluate on a trace, or run an experiment. Runs are remembered client-side (no list endpoint)."
          />
        ) : null}
        {runs.length > 0 ? (
          <div className="space-y-2">
            {runs.map((run) => {
              const p = run.progress || {};
              const total = p.total || 0;
              const done = (p.completed || 0) + (p.skipped || 0);
              const pctDone = total ? Math.round((done / total) * 100) : run.status === "completed" ? 100 : 0;
              return (
                <Link
                  key={run.id}
                  href={`/evaluations/view/?id=${encodeURIComponent(run.id)}`}
                  className="block rounded-lg border border-border bg-white p-3 hover:border-teal"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-medium">{run.id.slice(0, 12)}…</span>
                    <Badge className={statusChipClass(run.status)}>{run.status || "unknown"}</Badge>
                    <span className="text-ink/50">{run.name}</span>
                    <span className="ml-auto tabular-nums text-ink/60">
                      {done}/{total || "?"} · {pctDone}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-teal" style={{ width: `${pctDone}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : null}
      </main>
    </>
  );
}
