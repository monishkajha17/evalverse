"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Topbar } from "@/components/layout/topbar";
import { StackedOutcomeBars } from "@/components/charts/overview-charts";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { useSuite } from "@/context/suite-context";
import {
  compareModelsSeries,
  crossModalByVariant,
  crossModalFailureStack,
  crossModalNoImageControl,
  crossModalOverviewKpis,
  dimensionPivotSparse,
  failureOutcomeStack,
  modelOverviewCards,
  videoByQuestionType,
  videoOverviewKpis,
} from "@/lib/metrics";
import { pct } from "@/lib/utils";

export default function OverviewPage() {
  const { data, loading, error, entry, reload } = useSuite();
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const [agentFilter, setAgentFilter] = useState("all");
  const modality = entry?.modality || data.meta.modality || "";

  const cards = useMemo(() => modelOverviewCards(data), [data]);
  const shownCards = agentFilter === "all" ? cards : cards.filter((c) => c.agent === agentFilter);
  const pivot = useMemo(
    () => dimensionPivotSparse(data, agentFilter === "all" ? undefined : agentFilter),
    [data, agentFilter],
  );
  const fail = useMemo(() => failureOutcomeStack(data), [data]);
  const compare = useMemo(() => compareModelsSeries(data), [data]);
  const videoKpis = useMemo(() => videoOverviewKpis(data), [data]);
  const byQ = useMemo(() => videoByQuestionType(data), [data]);
  const cmKpis = useMemo(() => crossModalOverviewKpis(data), [data]);
  const cmByVar = useMemo(() => crossModalByVariant(data), [data]);
  const cmFail = useMemo(() => crossModalFailureStack(data), [data]);
  const cmNoImage = useMemo(() => crossModalNoImageControl(data), [data]);
  const isCrossModal = modality === "cross_modal";

  return (
    <>
      <Topbar title="Home" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Overview"
          description="See how each model answered, where it failed, and how each dimension scored."
          action={
            <Button asChild size="sm">
              <Link href="/traces/">Browse traces</Link>
            </Button>
          }
        />

        <FilterBar>
          <div className="w-44">
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger aria-label="Filter by model">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FilterBar>

        {loading ? <SkeletonBlock rows={5} /> : null}
        {error ? <ErrorState title="Could not load overview" detail={error} onRetry={reload} /> : null}

        {!loading && !error && !data.runs.length ? (
          <EmptyState
            title="No evaluation results yet"
            detail="Pick a demo dataset from the data source control, or connect a live project."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/datasets/">Open datasets</Link>
              </Button>
            }
          />
        ) : null}

        {!loading && !error && data.runs.length ? (
          <>
            <section className="grid gap-3 lg:grid-cols-2">
              {shownCards.map((c) => (
                <Card key={c.agent}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{c.agent}</CardTitle>
                    <CardDescription>Per-model outcome mix</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Kpi
                        label="Correct"
                        value={pct(c.correct, 0)}
                        tip="Share of runs whose answer matched the expectation"
                      />
                      <Kpi
                        label="Confidently wrong"
                        value={pct(c.confidentlyWrong, 0)}
                        tip="Wrong answers that were not abstentions, averaged across variants"
                      />
                      <Kpi
                        label="Said it could not read"
                        value={pct(c.couldNotRead, 0)}
                        tip="Runs labeled abstained"
                      />
                      <Kpi
                        label="Score (UMS)"
                        value={c.ums != null ? pct(c.ums, 0) : "—"}
                        tip="Unified Multimodal Score"
                        hint={
                          [
                            c.ci ? `${pct(c.ci[0], 0)}–${pct(c.ci[1], 0)}` : null,
                            c.gatePass == null ? null : c.gatePass ? "Gate pass" : "Gate fail",
                          ]
                            .filter(Boolean)
                            .join(" · ") || undefined
                        }
                      />
                    </div>
                    {c.confidentByVariant.length ? (
                      <div className="rounded-md border border-border bg-paper/70 px-2.5 py-2">
                        <div className="mb-1 text-[11px] font-medium text-ink/50">
                          Confident errors by variant
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-ink/70">
                          {c.confidentByVariant.map((v) => (
                            <span key={v.variant}>
                              {v.variant}: {pct(v.rate, 0)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </section>

            {modality === "video" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">By question type</CardTitle>
                  <CardDescription>
                    Overall grounded {pct(videoKpis.grounded, 0)} · abstained {pct(videoKpis.abstained, 0)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-auto">
                  <table className="sticky-table w-full min-w-[560px] text-left text-xs">
                    <thead>
                      <tr className="text-ink/55">
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Clean</th>
                        <th className="px-2 py-2">Sparse</th>
                        <th className="px-2 py-2">Blur</th>
                        <th className="px-2 py-2">No frames</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byQ.map((row) => (
                        <tr key={row.kind} className="border-t border-border">
                          <td className="px-2 py-1.5 font-medium">{row.kind}</td>
                          {(["clean", "sparse", "blur", "blind_guess"] as const).map((col) => {
                            const cell = row.cells[col] || { correct: 0, total: 0 };
                            return (
                              <td key={col} className="px-2 py-1.5 tabular-nums">
                                {cell.total ? `${cell.correct}/${cell.total}` : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null}

            {isCrossModal ? (
              <>
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Kpi
                    label="Verdict accuracy"
                    value={pct(cmKpis.verdictAccuracy, 0)}
                    hint={`${cmKpis.nCorrect} / ${cmKpis.n} runs`}
                  />
                  <Kpi label="Missed contradictions" value={`${cmKpis.missedContradictions}`} />
                  <Kpi label="False alarms" value={`${cmKpis.falseAlarms}`} />
                  <Kpi label="Abstentions" value={`${cmKpis.abstentions}`} />
                </section>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">By variant</CardTitle>
                    <CardDescription>clean · blur · noisy voice · no image</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-auto">
                    <table className="sticky-table w-full min-w-[400px] text-left text-xs">
                      <thead>
                        <tr className="text-ink/55">
                          <th className="px-2 py-2">Variant</th>
                          <th className="px-2 py-2">Correct / n</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cmByVar.map((v) => (
                          <tr key={v.variant} className="border-t border-border">
                            <td className="px-2 py-1.5 font-medium">{v.variant}</td>
                            <td className="px-2 py-1.5 tabular-nums">
                              {v.total ? `${v.correct} / ${v.total}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
                <div className="grid gap-3 xl:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Where it failed</CardTitle>
                      <CardDescription>
                        heard wrong · misread image · comparison error · abstained
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <StackedOutcomeBars rows={cmFail.rows} labels={cmFail.labels} />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">No-image control</CardTitle>
                      <CardDescription>Chance line at 50%</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="relative h-10 overflow-hidden rounded border border-border bg-muted/40">
                        <div
                          className="absolute inset-y-0 left-0 bg-teal/25"
                          style={{ width: `${Math.min(100, (cmNoImage.rate ?? 0) * 100)}%` }}
                        />
                        <div className="absolute inset-y-0 w-px bg-ink/50" style={{ left: "50%" }} />
                        <div className="relative flex h-full items-center justify-between px-3 text-xs">
                          <span className="font-medium tabular-nums">
                            {cmNoImage.total
                              ? `${cmNoImage.correct} / ${cmNoImage.total} (${pct(cmNoImage.rate ?? 0, 0)})`
                              : "—"}
                          </span>
                          <span className="text-ink/45">chance 50%</span>
                        </div>
                      </div>
                      <p className="text-xs text-ink/55">
                        A control near 50% means the answer needed the receipt.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">How each dimension scores</CardTitle>
                <CardDescription>Means from completed evaluators. Empty dimensions are hidden.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-auto">
                {!pivot.dims.length ? (
                  <EmptyState title="No dimension scores yet" detail="Run an evaluation to populate this table." />
                ) : (
                  <table className="sticky-table w-full min-w-[640px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="text-ink/55">
                        <th className="px-2 py-2">Dimension</th>
                        {pivot.variants.map((v) => (
                          <th key={v} className="px-2 py-2">
                            {v}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pivot.dims.map((dim) => (
                        <tr key={dim} className="border-t border-border">
                          <td className="px-2 py-1.5 font-medium">{dim}</td>
                          {pivot.variants.map((v) => (
                            <td key={v} className="px-2 py-1.5 tabular-nums">
                              {pct(pivot.cell(dim, v), 0)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {!isCrossModal ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Where it failed</CardTitle>
                  <CardDescription>Stage labels by model and variant</CardDescription>
                </CardHeader>
                <CardContent>
                  <StackedOutcomeBars rows={fail.rows} labels={fail.labels} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Compare models</CardTitle>
                  <CardDescription>Overall score (UMS when available)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64 w-full">
                    <ResponsiveContainer>
                      <BarChart data={compare} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                        <CartesianGrid stroke="#E4E9F0" vertical={false} />
                        <XAxis dataKey="agent" tick={{ fontSize: 10, fill: "#6A7B93" }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#6A7B93" }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [`${v}%`, "Score"]} />
                        <Bar dataKey="ums" fill="#0B8F7A" name="Score" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}

function Kpi({
  label,
  value,
  hint,
  tip,
}: {
  label: string;
  value: string;
  hint?: string;
  tip?: string;
}) {
  const body = (
    <div className="rounded-md border border-border bg-paper/70 px-2.5 py-2">
      <div className="text-[11px] text-ink/45">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="text-[10px] text-ink/45">{hint}</div> : null}
    </div>
  );
  if (!tip) return body;
  return (
    <Hint label={tip}>
      <div className="cursor-help">{body}</div>
    </Hint>
  );
}
