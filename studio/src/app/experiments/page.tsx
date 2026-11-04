"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { OutcomeChip } from "@/components/outcome-chip";
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

export default function ExperimentsPage() {
  const { mode } = useApiMode();
  if (mode === "live") return <LiveExperiments />;
  return <SnapshotExperiments />;
}

function LiveExperiments() {
  const [exps, setExps] = useState<Experiment[]>([]);
  const [selected, setSelected] = useState<ExperimentDetail | null>(null);
  const [compare, setCompare] = useState<ExperimentCompare | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [runA, setRunA] = useState("");
  const [runB, setRunB] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [e, p] = await Promise.all([listExperiments(), listProviders()]);
      setExps(e);
      setProviders(p);
      if (e[0]) setSelected(await getExperiment(e[0].id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <>
      <Topbar title="Experiments" />
      <main className="space-y-3 p-4">
        {msg ? <div className="rounded border border-teal/30 bg-teal/5 px-3 py-2 text-xs text-teal">{msg}</div> : null}
        <div className="flex items-center justify-between">
          <select
            className="h-8 rounded border border-border px-2 text-xs"
            value={selected?.id || ""}
            onChange={async (e) => {
              setSelected(await getExperiment(e.target.value));
              setCompare(null);
            }}
          >
            {exps.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
              New experiment
            </Button>
            <Button
              size="sm"
              disabled={!selected}
              onClick={async () => {
                if (!selected) return;
                await runExperiment(selected.id, { mock: selected.config?.mock });
                setMsg("Run started");
                setSelected(await getExperiment(selected.id));
              }}
            >
              Run
            </Button>
          </div>
        </div>
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}
        {selected ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{selected.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs">
                <pre className="mono overflow-auto rounded bg-paper p-2 text-[11px]">
                  {JSON.stringify(selected.config, null, 2)}
                </pre>
                <div className="mt-3 overflow-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-ink/60">
                        <th className="px-2 py-1">Run</th>
                        <th className="px-2 py-1">Agent</th>
                        <th className="px-2 py-1">Variant</th>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1">Eval run</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.runs || []).map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-2 py-1 font-mono">{r.id.slice(0, 10)}…</td>
                          <td className="px-2 py-1">{r.agent}</td>
                          <td className="px-2 py-1">{r.variant}</td>
                          <td className="px-2 py-1">
                            <Badge className="border-border bg-muted">{r.status}</Badge>
                          </td>
                          <td className="px-2 py-1">
                            {r.eval_run_id ? (
                              <Link
                                className="text-teal hover:underline"
                                href={`/evaluations/view/?id=${encodeURIComponent(r.eval_run_id)}`}
                              >
                                open
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Compare two runs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
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
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1 font-semibold">Dimension deltas</div>
                      <table className="w-full">
                        <thead>
                          <tr className="text-ink/60">
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
                              <td className="px-2 py-1 tabular-nums">{d.mean_a?.toFixed(2)}</td>
                              <td className="px-2 py-1 tabular-nums">{d.mean_b?.toFixed(2)}</td>
                              <td className="px-2 py-1 tabular-nums">
                                {d.delta != null ? (d.delta >= 0 ? "+" : "") + d.delta.toFixed(2) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="mb-1 font-semibold">Regressions &amp; improvements</div>
                      <table className="w-full">
                        <thead>
                          <tr className="text-ink/60">
                            <th className="px-2 py-1 text-left">Case</th>
                            <th className="px-2 py-1 text-left">Δ</th>
                            <th className="px-2 py-1 text-left">Labels</th>
                            <th className="px-2 py-1 text-left">Traces</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(compare.case_changes || []).map((c, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-2 py-1">{c.case_id}</td>
                              <td className="px-2 py-1 tabular-nums">
                                {c.delta != null ? (c.delta >= 0 ? "+" : "") + c.delta.toFixed(2) : "—"}
                                <span className="ml-1 text-ink/45">
                                  {c.delta != null && c.delta < 0 ? "regression" : "improvement"}
                                </span>
                              </td>
                              <td className="px-2 py-1">
                                {c.label_a} → {c.label_b}
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
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : null}

        {newOpen ? (
          <NewExperimentModal
            providers={providers}
            onClose={() => setNewOpen(false)}
            onCreated={async (id) => {
              setNewOpen(false);
              setMsg(`Created experiment ${id}`);
              await reload();
              setSelected(await getExperiment(id));
            }}
          />
        ) : null}
      </main>
    </>
  );
}

function NewExperimentModal({
  providers,
  onClose,
  onCreated,
}: {
  providers: Provider[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const models = providers.flatMap((p) => (p.models || []).map((m) => m.id));
  const [name, setName] = useState("studio-exp");
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; versionId: string }>>([]);
  const [versionId, setVersionId] = useState("");
  const [modelA, setModelA] = useState(models[0] || "muse-spark-1.1");
  const [modelB, setModelB] = useState(models[1] || models[0] || "muse-spark-1.3");
  const [variants, setVariants] = useState("clean");
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>([]);
  const [mock, setMock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
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
      setEvaluatorIds(evs.filter((e) => e.id === "evidence_grounding").map((e) => e.id));
      if (!evaluatorIds.length && evs[0]) setEvaluatorIds([evs[0].id]);
    })().catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-white p-4 shadow-xl">
        <div className="mb-3 flex justify-between">
          <h3 className="text-sm font-semibold">New experiment</h3>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        {err ? <ErrorBlock title="Error" detail={err} /> : null}
        <div className="space-y-2 text-xs">
          <label className="block">
            Name
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            Dataset version
            <select
              className="mt-1 h-8 w-full rounded border border-border px-2"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {datasets.map((d) => (
                <option key={d.versionId} value={d.versionId}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>
              Agent A model
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
              Agent B model
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
            Variants (comma)
            <Input className="mt-1" value={variants} onChange={(e) => setVariants(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} />
            Mock
          </label>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!versionId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const exp = await createExperiment({
                  name,
                  dataset_version_id: versionId,
                  agents: [
                    { name: "a", model: modelA },
                    { name: "b", model: modelB },
                  ],
                  variants: variants.split(",").map((v) => v.trim()).filter(Boolean),
                  evaluator_ids: evaluatorIds.length ? evaluatorIds : ["evidence_grounding"],
                  mock,
                });
                onCreated(exp.id);
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Create failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SnapshotExperiments() {
  const { data, loading, error } = useSuite();
  const agents = data.meta.agents || [];
  const [a, setA] = useState(agents[0] || "");
  const [b, setB] = useState(agents[1] || agents[0] || "");
  const variants = (data.meta.conditions || []).filter((v) => v !== "blind");

  const diffs = [];
  for (const c of data.cases) {
    for (const v of variants) {
      const lr = data.runs.find((r) => r.agent === a && r.case_id === c.id && r.condition === v);
      const rr = data.runs.find((r) => r.agent === b && r.case_id === c.id && r.condition === v);
      if (lr && rr && lr.label !== rr.label) {
        diffs.push({ case_id: c.id, variant: v, left: lr.label, right: rr.label });
      }
    }
  }

  return (
    <>
      <Topbar title="Experiments (snapshot)" />
      <main className="space-y-3 p-4">
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}
        <div className="flex gap-2 text-xs">
          <select className="h-8 rounded border px-2" value={a} onChange={(e) => setA(e.target.value)}>
            {agents.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select className="h-8 rounded border px-2" value={b} onChange={(e) => setB(e.target.value)}>
            {agents.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {diffs.length === 0 ? <EmptyBlock title="No outcome differences" /> : null}
        <table className="w-full border-collapse text-left text-xs">
          <tbody>
            {diffs.map((d) => (
              <tr key={`${d.case_id}-${d.variant}`} className="border-t border-border">
                <td className="px-2 py-1">{d.case_id}</td>
                <td className="px-2 py-1">{d.variant}</td>
                <td className="px-2 py-1">
                  <OutcomeChip label={d.left} />
                </td>
                <td className="px-2 py-1">
                  <OutcomeChip label={d.right} />
                </td>
                <td className="px-2 py-1">
                  <Link
                    className="text-teal hover:underline"
                    href={`/traces/view/?id=${encodeURIComponent(`${a}|${d.case_id}|${d.variant}`)}`}
                  >
                    open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
