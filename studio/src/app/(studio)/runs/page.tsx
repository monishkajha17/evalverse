"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { DataTable, type ColumnDef } from "@/components/studio/data-table";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  getEvaluation,
  getExperiment,
  listExperiments,
  rememberedEvalRuns,
  type EvaluationRun,
} from "@/lib/api";
import { statusChipClass } from "@/lib/trace-helpers";

type RunRow = {
  id: string;
  title: string;
  evaluators: string;
  status: string;
  progress: string;
  started: string;
  raw: EvaluationRun | null;
};

export default function RunsPage() {
  const { mode } = useApiMode();
  const { data, entry } = useSuite();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<RunRow | null>(null);

  const demoRuns = useMemo<RunRow[]>(() => {
    const agents = data.meta.agents || [];
    const created = data.meta.created || entry?.created || null;
    const eids = [...new Set((data.results || []).map((r) => r.evaluator_id))].slice(0, 8);
    if (!data.results?.length) return [];
    return [
      {
        id: `suite-${entry?.suite || "demo"}`,
        title: `${entry?.suite || "Demo suite"} · ${agents.join(", ") || "models"}`,
        evaluators: eids.join(", ") || "registry",
        status: "completed",
        progress: `${data.results.length}/${data.results.length}`,
        started: created ? new Date(created).toLocaleString() : "—",
        raw: null,
      },
    ];
  }, [data, entry]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode !== "live") {
        setRuns(demoRuns);
        return;
      }
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
      const loaded: RunRow[] = [];
      for (const id of [...ids].slice(0, 40)) {
        try {
          const run = await getEvaluation(id);
          const p = run.progress;
          const done = (p?.completed || 0) + (p?.failed || 0) + (p?.skipped || 0);
          const total = p?.total || done || (run.results || []).length;
          loaded.push({
            id: run.id,
            title: run.name || run.id,
            evaluators: ((run.config?.evaluator_ids as string[]) || [])
              .slice(0, 4)
              .join(", ") || "—",
            status: run.status || "unknown",
            progress: `${done}/${total || "—"}`,
            started: run.created_at ? new Date(run.created_at).toLocaleString() : "—",
            raw: run,
          });
        } catch {
          /* skip */
        }
      }
      setRuns(loaded.length ? loaded : demoRuns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load runs");
      setRuns(demoRuns);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, demoRuns]);

  const filtered = runs.filter((r) => {
    const hay = `${r.title} ${r.evaluators} ${r.status}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });

  const columns: ColumnDef<RunRow>[] = [
    { id: "what", header: "What was evaluated", cell: (r) => <span className="font-medium">{r.title}</span> },
    { id: "evals", header: "Evaluators", cell: (r) => r.evaluators },
    {
      id: "status",
      header: "Status",
      cell: (r) => <Badge className={statusChipClass(r.status)}>{r.status}</Badge>,
    },
    { id: "progress", header: "Progress", cell: (r) => <span className="tabular-nums">{r.progress}</span> },
    { id: "started", header: "Started", cell: (r) => r.started },
  ];

  return (
    <>
      <Topbar title="Runs" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Runs"
          description="Batch evaluations over traces or datasets, with progress and outcomes."
          action={
            <Button type="button" size="sm" variant="outline" onClick={reload}>
              Refresh
            </Button>
          }
        />
        <FilterBar>
          <Input
            className="h-8 max-w-xs"
            placeholder="Filter runs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </FilterBar>
        {loading ? <SkeletonBlock /> : null}
        {error ? <ErrorState detail={error} onRetry={reload} /> : null}
        {!loading ? (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={setSelected}
            empty={
              <EmptyState
                title="No runs yet"
                detail="Start an evaluation from a trace, or run an experiment to see progress here."
              />
            }
          />
        ) : null}
      </main>

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full max-w-md sm:max-w-lg" title="Run detail">
          {selected ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">{selected.title}</h2>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-ink/45">Status</dt>
                  <dd>{selected.status}</dd>
                </div>
                <div>
                  <dt className="text-ink/45">Progress</dt>
                  <dd className="tabular-nums">{selected.progress}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink/45">Evaluators</dt>
                  <dd>{selected.evaluators}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink/45">Started</dt>
                  <dd>{selected.started}</dd>
                </div>
              </dl>
              {selected.raw?.results?.length ? (
                <div className="rounded border border-border">
                  <div className="border-b border-border px-3 py-2 text-xs font-medium">
                    Recent results
                  </div>
                  <ul className="max-h-64 overflow-auto text-xs">
                    {selected.raw.results.slice(0, 30).map((r) => (
                      <li key={r.id} className="border-t border-border px-3 py-2">
                        <div className="font-medium">{r.evaluator_id}</div>
                        <div className="text-ink/55">
                          {r.verdict || "—"} · {r.label || "—"} · score{" "}
                          {r.score != null ? r.score.toFixed(2) : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-ink/55">
                  Suite snapshot run — open Overview for dimension scores and outcomes.
                </p>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
