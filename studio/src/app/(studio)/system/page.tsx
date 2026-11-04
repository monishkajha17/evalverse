"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PipelineDiagram, type PipelineCounts } from "@/components/system/pipeline-diagram";
import { SpanDag } from "@/components/system/span-dag";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  getQueue,
  listDatasets,
  listEvaluators,
  listPolicies,
  listTraces,
  type Evaluator,
  type Policy,
  type QueueStats,
} from "@/lib/api";
import { judgeTrust } from "@/lib/metrics";
import type { PlanJob, TraceRow, UmsRow } from "@/lib/types";
import { pct } from "@/lib/utils";

export default function SystemPage() {
  const { mode } = useApiMode();
  const { data, suite, loading: suiteLoading, error: suiteError } = useSuite();

  const [liveEvals, setLiveEvals] = useState<Evaluator[] | null>(null);
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [traceCount, setTraceCount] = useState<number | null>(null);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    if (mode !== "live") {
      setLiveEvals(null);
      setQueue(null);
      setTraceCount(null);
      setResultCount(null);
      setDatasetCount(null);
      setPolicies(null);
      setLiveError(null);
      return;
    }
    let cancelled = false;
    setLiveLoading(true);
    (async () => {
      try {
        const [evals, q, traces, ds, pols] = await Promise.all([
          listEvaluators(),
          getQueue(),
          listTraces({ limit: 100 }),
          listDatasets(),
          listPolicies(),
        ]);
        if (cancelled) return;
        setLiveEvals(evals);
        setQueue(q);
        setTraceCount(traces.length);
        setDatasetCount(ds.length);
        setPolicies(pols);
        // sample results from first traces (cap)
        let n = 0;
        for (const t of traces.slice(0, 20)) {
          try {
            const { getTrace } = await import("@/lib/api");
            const detail = await getTrace(t.id);
            n += (detail.results || []).length;
          } catch {
            /* skip */
          }
        }
        setResultCount(n);
        setLiveError(null);
      } catch (e) {
        if (!cancelled) setLiveError(e instanceof Error ? e.message : "Live fetch failed");
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const registry = useMemo(() => {
    if (liveEvals?.length) {
      return liveEvals.map((e) => ({
        id: e.id,
        category: e.category || e.type || "other",
        dimension: e.dimension || "—",
        needs_reference: !!e.needs_reference,
        scope: e.scope || "—",
        source: e.source,
      }));
    }
    return (data.registry || []).map((e) => ({
      id: e.id,
      category: e.category || "other",
      dimension: e.dimension || "—",
      needs_reference: !!e.needs_reference,
      scope: e.scope || "—",
      source: "snapshot",
    }));
  }, [liveEvals, data.registry]);

  const byCategory = useMemo(() => {
    const order = ["deterministic", "tool_use", "paired", "judge", "composite"];
    const map = new Map<string, typeof registry>();
    for (const e of registry) {
      const cat = (e.category || "other").toLowerCase();
      const key = order.includes(cat) ? cat : cat || "other";
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    }
    const keys = [...order.filter((k) => map.has(k)), ...[...map.keys()].filter((k) => !order.includes(k))];
    return keys.map((k) => ({ category: k, items: map.get(k) || [] }));
  }, [registry]);

  const plan = useMemo(() => data.plan || [], [data.plan]);
  const conflicts = useMemo(() => data.conflicts || [], [data.conflicts]);
  const planTable = useMemo(() => summarizePlan(plan), [plan]);

  const agents =
    (data.meta.manifest?.agents as string[] | undefined) ||
    data.meta.agents ||
    [];
  const judge =
    (data.meta.manifest?.judge as string | undefined) || data.meta.judge || null;
  const independent = Boolean(judge && agents.length && agents.every((a) => a !== judge));

  const trust = useMemo(() => judgeTrust(data.judged || []), [data.judged]);
  const judgeNoImg = useMemo(() => {
    const rows = (data.judged || []).filter((j) =>
      String(j.kind || "").includes("noimg") || String(j.kind || "").includes("no_image"),
    );
    const n = rows.length;
    const agrees = rows.filter((j) => j.agrees).length;
    return { n, agrees, rate: n ? agrees / n : null };
  }, [data.judged]);

  const [crossModalJoin, setCrossModalJoin] = useState<TraceRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { loadSuite } = await import("@/lib/data");
        const cm = await loadSuite("crossmodal");
        if (!cancelled) setCrossModalJoin(findCrossModalJoinTrace(cm.traces || []));
      } catch {
        if (!cancelled) setCrossModalJoin(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const audioExample = useMemo(
    () =>
      crossModalJoin ||
      findCrossModalJoinTrace(data.traces || []) ||
      findParallelTranscribeTrace(data.traces || []) ||
      findVideoFrameJoinTrace(data.traces || []),
    [data.traces, crossModalJoin],
  );
  const joinExampleIsCrossModal = useMemo(() => {
    const t = audioExample;
    if (!t) return false;
    const mods = new Set((t.assets || []).map((a) => a.modality));
    return mods.has("image") && mods.has("audio");
  }, [audioExample]);

  const umsRows = data.scores?.rows || [];
  const primaryUms: UmsRow | null = umsRows[0] || null;

  const counts: PipelineCounts = {
    datasets:
      mode === "live" ? datasetCount : data.cases.length ? 1 : 0,
    traces: mode === "live" ? traceCount : data.traces.length,
    queueJobs:
      mode === "live"
        ? queue
          ? (queue.depth || 0) + (queue.running || 0) + (queue.completed || 0)
          : null
        : plan.length || null,
    evaluators: registry.length,
    results:
      mode === "live" ? resultCount : data.results.length,
    policies:
      mode === "live"
        ? policies
          ? policies.filter((p) => p.enabled !== false).length
          : null
        : null,
  };

  const missingNotes: string[] = [];
  if (!plan.length) missingNotes.push("Orchestrator plan");
  if (!conflicts.length) missingNotes.push("Conflicts");
  if (!primaryUms) missingNotes.push("UMS scores");
  if (!audioExample) missingNotes.push("Cross-modal / parallel-join DAG");
  if (!judge) missingNotes.push("Judge model in manifest");
  if (mode === "live" && datasetCount === 0) missingNotes.push("Live datasets");

  return (
    <>
      <Topbar title="How EvalVerse works" />
      <main className="space-y-4 p-4">
        <p className="text-xs text-ink/60">
          System map for suite <span className="font-semibold text-ink">{suite || "—"}</span>
          {" · "}
          {mode === "live" ? "Live API counts with suite snapshot for plans/UMS/DAG" : "Snapshot-only"}
        </p>
        {(suiteLoading || liveLoading) && <LoadingBlock label="Loading system view…" />}
        {suiteError ? <ErrorBlock title="Suite error" detail={suiteError} /> : null}
        {liveError ? <ErrorBlock title="Live API partial failure" detail={liveError} /> : null}

        {/* 1. Pipeline */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">1 · Pipeline</h2>
          <PipelineDiagram counts={counts} />
        </section>

        {/* 2. Orchestrator */}
        <section className="space-y-2" id="orchestrator">
          <h2 className="text-sm font-semibold text-ink">2 · Orchestrator</h2>
          <Card>
            <CardHeader>
              <CardTitle>Last run plan</CardTitle>
              <CardDescription>
                Jobs by kind (agent / judge / judge_control) from suite <code className="text-[11px]">plan</code>
                {conflicts.length ? ` · ${conflicts.length} conflicts` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!plan.length ? (
                <EmptyBlock
                  title="No orchestrator plan in this suite"
                  detail="Export a run that records plan[] (e.g. default/wonder). Live queue counts still appear in the pipeline diagram."
                />
              ) : (
                <div className="overflow-auto">
                  <table className="sticky-table w-full min-w-[640px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="text-ink/60">
                        <th className="px-2 py-2">Kind</th>
                        <th className="px-2 py-2">Jobs</th>
                        <th className="px-2 py-2">Completed</th>
                        <th className="px-2 py-2">Error</th>
                        <th className="px-2 py-2">Other</th>
                        <th className="px-2 py-2">Retries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planTable.map((row) => (
                        <tr key={row.kind} className="border-t border-border">
                          <td className="px-2 py-1.5 font-medium">{row.kind}</td>
                          <td className="px-2 py-1.5 tabular-nums">{row.n}</td>
                          <td className="px-2 py-1.5 tabular-nums">{row.completed}</td>
                          <td className="px-2 py-1.5 tabular-nums">{row.error}</td>
                          <td className="px-2 py-1.5 tabular-nums">{row.other}</td>
                          <td className="px-2 py-1.5 tabular-nums">{row.retries}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {conflicts.length ? (
                    <p className="mt-2 text-[11px] text-ink/55">
                      Conflicts recorded: {conflicts.length} (e.g. {conflicts[0]?.kind || "—"}). See Judge / disagreements for details.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-ink/45">No conflicts[] on this suite.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* 3. Agent vs judge */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">3 · Agent vs judge</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Agent under test</CardTitle>
                <CardDescription>From run manifest / meta.agents</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {agents.length ? (
                  agents.map((a) => (
                    <Badge key={a} className="mr-1 border-border bg-paper text-ink">
                      {a}
                    </Badge>
                  ))
                ) : (
                  <EmptyBlock title="No agent models listed" detail="Select a suite with meta.agents or manifest.agents." />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Judge</CardTitle>
                  {independent ? (
                    <Badge className="border-teal/40 bg-teal/10 text-teal">Independent judge</Badge>
                  ) : judge ? (
                    <Badge className="border-amber/40 bg-amber/10 text-amber">Same family / overlapping</Badge>
                  ) : null}
                </div>
                <CardDescription>Audit + judge-without-image controls</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div>
                  Model:{" "}
                  <span className="font-semibold">{judge || "—"}</span>
                </div>
                {trust.n === 0 ? (
                  <EmptyBlock title="No agent_answer judge audit rows" />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="False accept" value={`${trust.falseAccept} (${pct(trust.falseAcceptRate, 0)})`} />
                    <Stat label="False reject" value={`${trust.falseReject} (${pct(trust.falseRejectRate, 0)})`} />
                  </div>
                )}
                <div className="rounded border border-border bg-paper/70 px-2 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-ink/45">Judge without image</div>
                  {judgeNoImg.n === 0 ? (
                    <p className="text-ink/50">No planted_*_noimg rows in judged[].</p>
                  ) : (
                    <p>
                      {judgeNoImg.agrees}/{judgeNoImg.n} agree with truth (
                      {pct(judgeNoImg.rate, 0)})
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* 4. Evaluators */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">4 · Evaluators</h2>
          <Card>
            <CardHeader>
              <CardTitle>Registry by category</CardTitle>
              <CardDescription>
                {mode === "live" && liveEvals ? "From GET /evaluators" : "From suite registry[]"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!registry.length ? (
                <EmptyBlock title="No evaluators" />
              ) : (
                byCategory.map((group) => (
                  <div key={group.category}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                      {group.category.replace(/_/g, " ")}
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="text-ink/50">
                            <th className="px-2 py-1">ID</th>
                            <th className="px-2 py-1">Dimension</th>
                            <th className="px-2 py-1">Needs reference</th>
                            <th className="px-2 py-1">Scope</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((e) => (
                            <tr key={e.id} className="border-t border-border">
                              <td className="px-2 py-1 font-medium">
                                <Link href="/evaluators/" className="text-teal hover:underline">
                                  {e.id}
                                </Link>
                              </td>
                              <td className="px-2 py-1">{e.dimension}</td>
                              <td className="px-2 py-1">{e.needs_reference ? "yes" : "no"}</td>
                              <td className="px-2 py-1">{e.scope}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        {/* 5. Multimodal vs text */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">5 · A multimodal trace vs a text trace</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Text-only trace</CardTitle>
                <CardDescription>What most LLM eval UIs stop at</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-4 text-xs text-ink/75">
                  <li>Prompt</li>
                  <li>Reply</li>
                  <li>Latency</li>
                  <li>A scalar score</li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>EvalVerse multimodal trace</CardTitle>
                <CardDescription>Evidence objects, media lineage, tool verdicts</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-4 text-xs text-ink/75">
                  <li>Media lineage with transformation chain</li>
                  <li>Cited evidence as an object (box / span)</li>
                  <li>Temporal timeline for audio turns</li>
                  <li>Tool-call verdicts (schema, order, acted_while_unsure)</li>
                  <li>Stage label (grounded_correct / misread / …)</li>
                  <li>DAG with joins (parallel work → model)</li>
                </ul>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Real example · joins from two modalities</CardTitle>
              <CardDescription>
                {audioExample
                  ? joinExampleIsCrossModal
                    ? `Trace ${audioExample.id} — voice + image roots join at model_call`
                    : `Trace ${audioExample.id} — parallel spans join into model_call`
                  : "Need a cross-modal, audio, or video suite with a join DAG"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {audioExample ? (
                <SpanDag
                  spans={audioExample.spans || []}
                  title={joinExampleIsCrossModal ? "voice + image → join" : audioExample.id}
                />
              ) : (
                <EmptyBlock
                  title="No two-modality join DAG"
                  detail="Loads the crossmodal suite when available; otherwise audio/video parallel joins."
                />
              )}
            </CardContent>
          </Card>
        </section>

        {/* 6. Score / UMS */}
        <section className="space-y-2" id="score">
          <h2 className="text-sm font-semibold text-ink">6 · Score</h2>
          <Card>
            <CardHeader>
              <CardTitle>Unified Multimodal Score (UMS)</CardTitle>
              <CardDescription>
                Profile {data.scores?.profile || "—"} · gate min{" "}
                {data.scores?.gate?.min_ums ?? "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!primaryUms ? (
                <div className="space-y-3">
                  <EmptyBlock
                    title="No UMS rows in this suite"
                    detail="scores.rows is missing (re-export a scored run into /data). Dimension means below still come from dimension_summary when present."
                  />
                  {(data.dimension_summary || []).length > 0 ? (
                    <DimensionSummaryTable
                      rows={(data.dimension_summary || []).filter((r) => r.mean_score != null)}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Stat
                      label="UMS"
                      value={primaryUms.ums == null ? "—" : primaryUms.ums.toFixed(3)}
                    />
                    <Stat label="CI 95%" value={formatCi(primaryUms.ci_95)} />
                    <Stat
                      label="Gate"
                      value={
                        primaryUms.gate?.pass == null
                          ? "—"
                          : primaryUms.gate.pass
                            ? "PASS"
                            : "FAIL"
                      }
                    />
                    <Stat
                      label="Weakest"
                      value={
                        primaryUms.weakest?.dimension
                          ? `${primaryUms.weakest.dimension} (${
                              primaryUms.weakest.score != null
                                ? primaryUms.weakest.score.toFixed(2)
                                : "—"
                            })`
                          : "—"
                      }
                    />
                  </div>
                  <p className="text-xs text-ink/70">
                    UMS is a weighted view. The dimensions beside it are the evidence.
                  </p>
                  {primaryUms.dimensions ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(primaryUms.dimensions)
                        .filter(([, v]) => {
                          const score = typeof v === "number" ? v : v?.score;
                          return score != null && Number.isFinite(score);
                        })
                        .map(([name, v]) => {
                          const score = (typeof v === "number" ? v : v?.score) as number;
                          return (
                            <div key={name}>
                              <div className="mb-0.5 flex justify-between text-[11px] text-ink/55">
                                <span>{name}</span>
                                <span className="tabular-nums">{score.toFixed(2)}</span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-teal"
                                  style={{ width: `${Math.min(100, Math.max(0, score * 100))}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                  {umsRows.length > 1 ? (
                    <div className="overflow-auto">
                      <table className="w-full min-w-[560px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="text-ink/60">
                            <th className="px-2 py-1">Agent</th>
                            <th className="px-2 py-1">Variant</th>
                            <th className="px-2 py-1">UMS</th>
                            <th className="px-2 py-1">Gate</th>
                            <th className="px-2 py-1">Weakest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {umsRows.slice(0, 12).map((r, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-2 py-1">{r.agent}</td>
                              <td className="px-2 py-1">{r.variant}</td>
                              <td className="px-2 py-1 tabular-nums">
                                {r.ums == null ? "—" : r.ums.toFixed(3)}
                              </td>
                              <td className="px-2 py-1">
                                {r.gate?.pass ? (
                                  <Badge className="border-teal/30 bg-teal/10 text-teal">pass</Badge>
                                ) : (
                                  <Badge className="border-crimson/30 bg-crimson/10 text-crimson">
                                    fail
                                  </Badge>
                                )}
                              </td>
                              <td className="px-2 py-1">{r.weakest?.dimension || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {missingNotes.length ? (
          <p className="text-[11px] text-ink/45">
            Empty / fallback sections for this selection: {missingNotes.join(" · ")}.
          </p>
        ) : null}
      </main>
    </>
  );
}

function summarizePlan(plan: PlanJob[]) {
  const kinds = new Map<
    string,
    { kind: string; n: number; completed: number; error: number; other: number; retries: number }
  >();
  for (const job of plan) {
    const kind = job.kind || "unknown";
    const row = kinds.get(kind) || {
      kind,
      n: 0,
      completed: 0,
      error: 0,
      other: 0,
      retries: 0,
    };
    row.n += 1;
    row.retries += Number(job.retries || 0);
    const st = (job.status || "").toLowerCase();
    if (st === "completed") row.completed += 1;
    else if (st === "error" || st === "failed") row.error += 1;
    else row.other += 1;
    kinds.set(kind, row);
  }
  return [...kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

function findCrossModalJoinTrace(traces: TraceRow[]): TraceRow | null {
  for (const t of traces) {
    const spans = t.spans || [];
    const mods = new Set((t.assets || []).map((a) => a.modality));
    const join = spans.some((s) => (s.parent_span_ids || []).length >= 2);
    const roots = spans.filter((s) => !(s.parent_span_ids || []).length);
    if (mods.has("image") && mods.has("audio") && join && roots.length >= 2) return t;
  }
  return null;
}

function findParallelTranscribeTrace(traces: TraceRow[]): TraceRow | null {
  let best: TraceRow | null = null;
  let bestN = 0;
  for (const t of traces) {
    const spans = t.spans || [];
    const n = spans.filter((s) => (s.name || "").toLowerCase().includes("transcribe")).length;
    const join = spans.some((s) => (s.parent_span_ids || []).length >= 3);
    if (n >= 5 && join && n > bestN) {
      best = t;
      bestN = n;
    }
  }
  if (best) return best;
  for (const t of traces) {
    const n = (t.spans || []).filter((s) => (s.name || "").toLowerCase().includes("transcribe")).length;
    if (n >= 5) return t;
  }
  return null;
}

function findVideoFrameJoinTrace(traces: TraceRow[]): TraceRow | null {
  for (const t of traces) {
    const spans = t.spans || [];
    const frames = spans.filter((s) => /^sample frame\b/i.test(s.name || ""));
    const join = spans.some((s) => (s.parent_span_ids || []).length >= 3);
    if (frames.length >= 3 && join) return t;
  }
  return null;
}

function formatCi(ci: UmsRow["ci_95"]): string {
  if (!ci) return "—";
  if (Array.isArray(ci) && ci.length >= 2) return `${ci[0].toFixed(3)}–${ci[1].toFixed(3)}`;
  if (typeof ci === "object" && ci && "lo" in ci && "hi" in ci) {
    const lo = (ci as { lo?: number }).lo;
    const hi = (ci as { hi?: number }).hi;
    if (lo != null && hi != null) return `${lo.toFixed(3)}–${hi.toFixed(3)}`;
  }
  return "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-paper/60 px-2.5 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function DimensionSummaryTable({
  rows,
}: {
  rows: Array<{ dimension?: string; variant?: string; mean_score?: number | null; n?: number }>;
}) {
  const shown = rows.filter((r) => r.mean_score != null).slice(0, 24);
  if (!shown.length) return null;
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[480px] border-collapse text-left text-xs">
        <thead>
          <tr className="text-ink/60">
            <th className="px-2 py-1">Dimension</th>
            <th className="px-2 py-1">Variant</th>
            <th className="px-2 py-1">Mean</th>
            <th className="px-2 py-1">n</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-2 py-1">{r.dimension || "—"}</td>
              <td className="px-2 py-1">{r.variant || "—"}</td>
              <td className="px-2 py-1 tabular-nums">
                {r.mean_score == null ? "—" : r.mean_score.toFixed(3)}
              </td>
              <td className="px-2 py-1 tabular-nums">{r.n ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
