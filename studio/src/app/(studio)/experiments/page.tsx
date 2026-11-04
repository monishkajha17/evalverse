"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Topbar } from "@/components/layout/topbar";
import { DataTable, type ColumnDef } from "@/components/studio/data-table";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { OutcomeChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  compareExperimentRuns,
  createExperiment,
  getDataset,
  getExperiment,
  listDatasets,
  listEvaluators,
  listExperiments,
  listProviders,
  runExperiment,
  type Experiment,
  type ExperimentCompare,
  type ExperimentDetail,
  type Provider,
} from "@/lib/api";
import { encodeTraceId } from "@/lib/utils";

type ExpListRow = {
  id: string;
  name: string;
  agents: string;
  variants: string;
  runs: number;
  status: string;
  created: string;
};

export default function ExperimentsPage() {
  const { mode } = useApiMode();
  if (mode === "live") return <LiveExperiments />;
  return <DemoExperiments />;
}

function LiveExperiments() {
  const [exps, setExps] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<ExperimentDetail | null>(null);
  const [compare, setCompare] = useState<ExperimentCompare | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [runA, setRunA] = useState("");
  const [runB, setRunB] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, p] = await Promise.all([listExperiments(), listProviders()]);
      setExps(e);
      setProviders(p);
      if (selected) {
        setSelected(await getExperiment(selected.id));
      } else if (e[0]) {
        setSelected(await getExperiment(e[0].id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load experiments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listRows: ExpListRow[] = exps.map((x) => {
    const agents = (x.config?.agents || [])
      .map((a) => (typeof a === "string" ? a : (a as { name?: string; model?: string }).model || (a as { name?: string }).name || "?"))
      .join(", ");
    const variants = (x.config?.variants || []).join(", ") || "—";
    return {
      id: x.id,
      name: x.name,
      agents: agents || "—",
      variants,
      runs: 0,
      status: "ready",
      created: x.created_at ? new Date(x.created_at).toLocaleString() : "—",
    };
  });

  const filtered = listRows.filter((r) => {
    const hay = `${r.name} ${r.agents} ${r.variants}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase());
  });

  const columns: ColumnDef<ExpListRow>[] = [
    { id: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "agents", header: "Models", cell: (r) => r.agents },
    { id: "variants", header: "Variants", cell: (r) => r.variants },
    { id: "created", header: "Created", cell: (r) => r.created },
  ];

  const chartData = (compare?.dimension_deltas || []).map((d) => ({
    dimension: d.dimension,
    A: d.mean_a ?? 0,
    B: d.mean_b ?? 0,
    delta: d.delta ?? 0,
  }));

  const regressions = (compare?.case_changes || []).filter((c) => (c.delta ?? 0) < 0);
  const improvements = (compare?.case_changes || []).filter((c) => (c.delta ?? 0) > 0);

  return (
    <>
      <Topbar title="Experiments" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Experiments"
          description="Compare models and variants on the same dataset."
          action={
            <Button type="button" size="sm" onClick={() => setWizardOpen(true)}>
              New experiment
            </Button>
          }
        />

        {msg ? <p className="text-xs text-ink/55">{msg}</p> : null}

        <FilterBar>
          <Input
            className="h-8 max-w-xs"
            placeholder="Filter experiments"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
            Refresh
          </Button>
        </FilterBar>

        {loading ? <SkeletonBlock /> : null}
        {error ? <ErrorState detail={error} onRetry={() => void reload()} /> : null}

        {!loading ? (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={async (r) => {
              setCompare(null);
              setSelected(await getExperiment(r.id));
            }}
            empty={
              <EmptyState
                title="No experiments yet"
                detail="Create an experiment to compare two models on a dataset."
                action={
                  <Button type="button" size="sm" onClick={() => setWizardOpen(true)}>
                    New experiment
                  </Button>
                }
              />
            }
          />
        ) : null}

        {selected ? (
          <div className="space-y-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-sm">{selected.name}</CardTitle>
                <Button
                  type="button"
                  size="sm"
                  onClick={async () => {
                    await runExperiment(selected.id, { mock: selected.config?.mock });
                    setMsg("Run started.");
                    setSelected(await getExperiment(selected.id));
                  }}
                >
                  Run
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex flex-wrap gap-2 text-ink/60">
                  <span>
                    Models:{" "}
                    {(selected.config?.agents || [])
                      .map((a) =>
                        typeof a === "string"
                          ? a
                          : (a as { model?: string }).model || (a as { name?: string }).name,
                      )
                      .join(" · ") || "—"}
                  </span>
                  <span>·</span>
                  <span>Variants: {(selected.config?.variants || []).join(", ") || "—"}</span>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-ink/55">
                        <th className="px-2 py-1">Run</th>
                        <th className="px-2 py-1">Model</th>
                        <th className="px-2 py-1">Variant</th>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1">Results</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.runs || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-2 py-4 text-ink/50">
                            No runs yet. Start one to compare.
                          </td>
                        </tr>
                      ) : (
                        (selected.runs || []).map((r) => (
                          <tr key={r.id} className="border-t border-border">
                            <td className="px-2 py-1 font-mono text-[11px]">{r.id.slice(0, 10)}…</td>
                            <td className="px-2 py-1">{r.agent}</td>
                            <td className="px-2 py-1">{r.variant}</td>
                            <td className="px-2 py-1">
                              <Badge className="border-border bg-muted">{r.status || "—"}</Badge>
                            </td>
                            <td className="px-2 py-1">
                              {r.eval_run_id ? (
                                <Link
                                  className="text-teal hover:underline"
                                  href={`/evaluations/view/?id=${encodeURIComponent(r.eval_run_id)}`}
                                >
                                  Open
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Compare two runs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex flex-wrap gap-2">
                  <select
                    className="h-8 rounded border border-border px-2"
                    value={runA}
                    onChange={(e) => setRunA(e.target.value)}
                  >
                    <option value="">Run A</option>
                    {(selected.runs || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.agent} · {r.variant}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-8 rounded border border-border px-2"
                    value={runB}
                    onChange={(e) => setRunB(e.target.value)}
                  >
                    <option value="">Run B</option>
                    {(selected.runs || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.agent} · {r.variant}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!runA || !runB}
                    onClick={async () => {
                      setCompare(await compareExperimentRuns(selected.id, runA, runB));
                    }}
                  >
                    Compare
                  </Button>
                </div>

                {compare ? (
                  <div className="space-y-4">
                    {chartData.length ? (
                      <div className="h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E6EAF0" />
                            <XAxis dataKey="dimension" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                            <RechartsTooltip />
                            <Bar dataKey="A" fill="#0B8F7A" name="Run A" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="B" fill="#6A7B93" name="Run B" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-1 font-medium">Dimension deltas</div>
                      <table className="w-full">
                        <thead>
                          <tr className="text-ink/55">
                            <th className="px-2 py-1 text-left">Dimension</th>
                            <th className="px-2 py-1 text-left">A</th>
                            <th className="px-2 py-1 text-left">B</th>
                            <th className="px-2 py-1 text-left">Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(compare.dimension_deltas || []).map((d) => (
                            <tr key={d.dimension} className="border-t border-border">
                              <td className="px-2 py-1">{d.dimension}</td>
                              <td className="px-2 py-1 tabular-nums">{d.mean_a?.toFixed(2) ?? "—"}</td>
                              <td className="px-2 py-1 tabular-nums">{d.mean_b?.toFixed(2) ?? "—"}</td>
                              <td className="px-2 py-1 tabular-nums">
                                {d.delta != null
                                  ? `${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(2)}`
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 font-medium text-crimson">
                          Regressions ({regressions.length})
                        </div>
                        <CaseChangeTable rows={regressions} />
                      </div>
                      <div>
                        <div className="mb-1 font-medium text-teal">
                          Improvements ({improvements.length})
                        </div>
                        <CaseChangeTable rows={improvements} />
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>

      <Sheet open={wizardOpen} onOpenChange={(o) => !o && setWizardOpen(false)}>
        <SheetContent className="w-full max-w-lg sm:max-w-xl" title="New experiment">
          <NewExperimentWizard
            providers={providers}
            onClose={() => setWizardOpen(false)}
            onCreated={async (id) => {
              setWizardOpen(false);
              setMsg("Experiment created.");
              await reload();
              setSelected(await getExperiment(id));
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function CaseChangeTable({
  rows,
}: {
  rows: NonNullable<ExperimentCompare["case_changes"]>;
}) {
  if (!rows.length) {
    return <p className="text-ink/50">None</p>;
  }
  return (
    <table className="w-full">
      <thead>
        <tr className="text-ink/55">
          <th className="px-2 py-1 text-left">Case</th>
          <th className="px-2 py-1 text-left">Δ</th>
          <th className="px-2 py-1 text-left">Labels</th>
          <th className="px-2 py-1 text-left">Traces</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 40).map((c, i) => (
          <tr key={i} className="border-t border-border">
            <td className="px-2 py-1">{c.case_id}</td>
            <td className="px-2 py-1 tabular-nums">
              {c.delta != null ? `${c.delta >= 0 ? "+" : ""}${c.delta.toFixed(2)}` : "—"}
            </td>
            <td className="px-2 py-1">
              {c.label_a || "—"} → {c.label_b || "—"}
            </td>
            <td className="px-2 py-1">
              {c.trace_a ? (
                <Link
                  className="text-teal hover:underline"
                  href={`/traces/view/?id=${encodeURIComponent(c.trace_a)}`}
                >
                  A
                </Link>
              ) : null}{" "}
              {c.trace_b ? (
                <Link
                  className="text-teal hover:underline"
                  href={`/traces/view/?id=${encodeURIComponent(c.trace_b)}`}
                >
                  B
                </Link>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NewExperimentWizard({
  providers,
  onClose,
  onCreated,
}: {
  providers: Provider[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const models = providers.flatMap((p) => (p.models || []).map((m) => m.id));
  const [step, setStep] = useState(0);
  const [name, setName] = useState("Model comparison");
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; versionId: string }>>([]);
  const [versionId, setVersionId] = useState("");
  const [modelA, setModelA] = useState(models[0] || "");
  const [modelB, setModelB] = useState(models[1] || models[0] || "");
  const [variants, setVariants] = useState("clean");
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>([]);
  const [mock, setMock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const ds = await listDatasets();
        const rows = [];
        for (const d of ds) {
          const detail = await getDataset(d.id);
          const v = detail.versions?.[detail.versions.length - 1];
          if (v) rows.push({ id: d.id, name: d.name, versionId: v.id });
        }
        setDatasets(rows);
        if (rows[0]) setVersionId(rows[0].versionId);
        const evs = await listEvaluators();
        const preferred = evs.filter((e) => e.id === "evidence_grounding").map((e) => e.id);
        setEvaluatorIds(preferred.length ? preferred : evs[0] ? [evs[0].id] : []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load wizard data");
      }
    })();
  }, []);

  useEffect(() => {
    if (!modelA && models[0]) setModelA(models[0]);
    if (!modelB && (models[1] || models[0])) setModelB(models[1] || models[0]);
  }, [models, modelA, modelB]);

  return (
    <div className="space-y-4 text-xs">
      {err ? <ErrorState detail={err} /> : null}
      <div className="flex gap-2 text-[11px] text-ink/45">
        {["Dataset", "Models", "Run"].map((label, i) => (
          <span key={label} className={i === step ? "font-medium text-ink" : ""}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {step === 0 ? (
        <div className="space-y-2">
          <label className="block">
            Name
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            Dataset
            <select
              className="mt-1 h-8 w-full rounded border border-border px-2"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {datasets.length === 0 ? <option value="">No datasets yet</option> : null}
              {datasets.map((d) => (
                <option key={d.versionId} value={d.versionId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label>
              Model A
              <select
                className="mt-1 h-8 w-full rounded border border-border px-2"
                value={modelA}
                onChange={(e) => setModelA(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model B
              <select
                className="mt-1 h-8 w-full rounded border border-border px-2"
                value={modelB}
                onChange={(e) => setModelB(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            Variants (comma-separated)
            <Input className="mt-1" value={variants} onChange={(e) => setVariants(e.target.value)} />
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
            <span>Dry run first</span>
            <Switch checked={mock} onCheckedChange={setMock} />
          </label>
          <p className="text-ink/55">
            Creates the experiment with {(variants.split(",").filter(Boolean).length || 1) * 2}{" "}
            scheduled runs, then you can compare results.
          </p>
        </div>
      ) : null}

      <div className="flex justify-between gap-2 pt-2">
        <Button type="button" size="sm" variant="outline" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)}>
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        {step < 2 ? (
          <Button
            type="button"
            size="sm"
            disabled={step === 0 && !versionId}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={!versionId || !modelA || !modelB || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const exp = await createExperiment({
                  name: name.trim() || "Model comparison",
                  dataset_version_id: versionId,
                  agents: [
                    { name: "a", model: modelA },
                    { name: "b", model: modelB },
                  ],
                  variants: variants
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                  evaluator_ids: evaluatorIds.length ? evaluatorIds : ["evidence_grounding"],
                  mock,
                });
                if (!mock) {
                  try {
                    await runExperiment(exp.id, { mock: false });
                  } catch {
                    /* created; run can be started from detail */
                  }
                } else {
                  await runExperiment(exp.id, { mock: true });
                }
                onCreated(exp.id);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not create experiment");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create and run"}
          </Button>
        )}
      </div>
    </div>
  );
}

function DemoExperiments() {
  const { data, loading, error, entry } = useSuite();
  const agents = data.meta.agents?.length
    ? data.meta.agents
    : [...new Set((data.runs || []).map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter((v) => v !== "blind");
  const [a, setA] = useState(agents[0] || "");
  const [b, setB] = useState(agents[1] || agents[0] || "");
  const [selectedPair, setSelectedPair] = useState<string | null>(null);

  useEffect(() => {
    if (!a && agents[0]) setA(agents[0]);
    if (!b && (agents[1] || agents[0])) setB(agents[1] || agents[0]);
  }, [agents, a, b]);

  const demoList: ExpListRow[] = useMemo(() => {
    if (agents.length < 2) {
      return [
        {
          id: "suite-self",
          name: `${entry?.suite || "Suite"} baseline`,
          agents: agents[0] || "model",
          variants: variants.join(", ") || "clean",
          runs: (data.runs || []).length,
          status: "completed",
          created: data.meta.created ? new Date(data.meta.created).toLocaleString() : "—",
        },
      ];
    }
    const pairs: ExpListRow[] = [];
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        pairs.push({
          id: `${agents[i]}-vs-${agents[j]}`,
          name: `${agents[i]} vs ${agents[j]}`,
          agents: `${agents[i]}, ${agents[j]}`,
          variants: variants.join(", ") || "clean",
          runs: (data.runs || []).filter((r) => r.agent === agents[i] || r.agent === agents[j])
            .length,
          status: "completed",
          created: data.meta.created ? new Date(data.meta.created).toLocaleString() : "—",
        });
      }
    }
    return pairs;
  }, [agents, variants, data.runs, data.meta.created, entry?.suite]);

  const diffs = useMemo(() => {
    const out: Array<{
      case_id: string;
      variant: string;
      left: string;
      right: string;
      kind: "regression" | "improvement" | "change";
    }> = [];
    for (const c of data.cases || []) {
      for (const v of variants) {
        const lr = data.runs.find((r) => r.agent === a && r.case_id === c.id && r.condition === v);
        const rr = data.runs.find((r) => r.agent === b && r.case_id === c.id && r.condition === v);
        if (lr && rr && lr.label !== rr.label) {
          const leftGood = lr.label === "grounded_correct" || lr.correct === true;
          const rightGood = rr.label === "grounded_correct" || rr.correct === true;
          let kind: "regression" | "improvement" | "change" = "change";
          if (leftGood && !rightGood) kind = "regression";
          if (!leftGood && rightGood) kind = "improvement";
          out.push({
            case_id: c.id,
            variant: v,
            left: lr.label || "—",
            right: rr.label || "—",
            kind,
          });
        }
      }
    }
    return out;
  }, [data.cases, data.runs, a, b, variants]);

  const scoreByAgent = useMemo(() => {
    const dims = [...new Set((data.dimension_summary || []).map((r) => r.dimension))];
    return dims.slice(0, 8).map((dimension) => {
      const rowA = (data.dimension_summary || []).find(
        (r) => r.dimension === dimension && (r.agent === a || r.agent === "*"),
      );
      const rowB = (data.dimension_summary || []).find(
        (r) => r.dimension === dimension && (r.agent === b || r.agent === "*"),
      );
      return {
        dimension,
        A: rowA?.mean_score ?? 0,
        B: rowB?.mean_score ?? 0,
      };
    });
  }, [data.dimension_summary, a, b]);

  const columns: ColumnDef<ExpListRow>[] = [
    { id: "name", header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "agents", header: "Models", cell: (r) => r.agents },
    { id: "variants", header: "Variants", cell: (r) => r.variants },
    {
      id: "runs",
      header: "Runs",
      cell: (r) => <span className="tabular-nums">{r.runs}</span>,
    },
    { id: "status", header: "Status", cell: (r) => <Badge className="border-border bg-muted">{r.status}</Badge> },
  ];

  return (
    <>
      <Topbar title="Experiments" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Experiments"
          description="Compare models and variants on the same dataset."
          action={
            <Button type="button" size="sm" variant="outline" disabled>
              New experiment
            </Button>
          }
        />
        <p className="text-xs text-ink/55">Sign in to create and run new experiments.</p>

        {loading ? <SkeletonBlock /> : null}
        {error ? <ErrorState detail={error} /> : null}

        {!loading ? (
          <DataTable
            columns={columns}
            rows={demoList}
            rowKey={(r) => r.id}
            onRowClick={(r) => {
              setSelectedPair(r.id);
              const parts = r.id.split("-vs-");
              if (parts.length === 2) {
                setA(parts[0]);
                setB(parts[1]);
              }
            }}
            empty={
              <EmptyState
                title="No model comparisons in this suite"
                detail="Load a suite with at least one agent to explore outcome differences."
              />
            }
          />
        ) : null}

        {!loading && agents.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {selectedPair ? `Compare · ${a} vs ${b}` : "Compare models"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex flex-wrap gap-2">
                <select
                  className="h-8 rounded border border-border px-2"
                  value={a}
                  onChange={(e) => setA(e.target.value)}
                >
                  {agents.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                <select
                  className="h-8 rounded border border-border px-2"
                  value={b}
                  onChange={(e) => setB(e.target.value)}
                >
                  {agents.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              {scoreByAgent.length ? (
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={scoreByAgent} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E6EAF0" />
                      <XAxis dataKey="dimension" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
                      <RechartsTooltip />
                      <Bar dataKey="A" fill="#0B8F7A" name={a || "A"} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="B" fill="#6A7B93" name={b || "B"} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 text-ink/60">
                <span>
                  Changes: <strong className="text-ink">{diffs.length}</strong>
                </span>
                <span>
                  Regressions:{" "}
                  <strong className="text-crimson">
                    {diffs.filter((d) => d.kind === "regression").length}
                  </strong>
                </span>
                <span>
                  Improvements:{" "}
                  <strong className="text-teal">
                    {diffs.filter((d) => d.kind === "improvement").length}
                  </strong>
                </span>
              </div>

              {diffs.length === 0 ? (
                <EmptyState
                  title="No outcome differences"
                  detail="These models agree on labels for the compared variants."
                />
              ) : (
                <div className="overflow-auto">
                  <table className="sticky-table w-full min-w-[640px] border-collapse text-left">
                    <thead>
                      <tr className="text-ink/55">
                        <th className="px-2 py-2">Case</th>
                        <th className="px-2 py-2">Variant</th>
                        <th className="px-2 py-2">{a || "A"}</th>
                        <th className="px-2 py-2">{b || "B"}</th>
                        <th className="px-2 py-2">Change</th>
                        <th className="px-2 py-2">Trace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffs.slice(0, 80).map((d) => (
                        <tr key={`${d.case_id}-${d.variant}`} className="border-t border-border">
                          <td className="px-2 py-1.5">{d.case_id}</td>
                          <td className="px-2 py-1.5">{d.variant}</td>
                          <td className="px-2 py-1.5">
                            <OutcomeChip label={d.left} />
                          </td>
                          <td className="px-2 py-1.5">
                            <OutcomeChip label={d.right} />
                          </td>
                          <td className="px-2 py-1.5 capitalize">{d.kind}</td>
                          <td className="px-2 py-1.5">
                            <Link
                              className="text-teal hover:underline"
                              href={`/traces/view/?id=${encodeURIComponent(
                                encodeTraceId(`${a}|${d.case_id}|${d.variant}`),
                              )}`}
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </main>
    </>
  );
}
