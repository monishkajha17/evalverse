"use client";

import { useCallback, useMemo, useState } from "react";
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
import { OnboardingEmpty } from "@/components/studio/onboarding-empty";
import { WelcomePanel } from "@/components/studio/welcome-panel";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiTile } from "@/components/ui/kpi-tile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  compareModelsSeries,
  crossModalFailureStack,
  crossModalNoImageControl,
  crossModalOverviewKpis,
  dimensionPivotSparse,
  failureOutcomeStack,
  modelOverviewCards,
  videoByQuestionType,
  videoOverviewKpis,
} from "@/lib/metrics";
import { apiConfig, getScores, listTraces } from "@/lib/api";
import { isWelcomePending } from "@/lib/sample-data";
import { pct } from "@/lib/utils";
import { useEffect } from "react";

export default function OverviewPage() {
  const { mode } = useApiMode();
  const { data, loading, error, entry, reload } = useSuite();
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter(Boolean);
  const [agentFilter, setAgentFilter] = useState("all");
  const [variantFilter, setVariantFilter] = useState("all");
  const [liveEmpty, setLiveEmpty] = useState(false);
  const [liveChecking, setLiveChecking] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);
  const [liveScores, setLiveScores] = useState<Record<string, unknown> | null>(null);
  const modality = entry?.modality || data.meta.modality || "";
  const isDemo = mode !== "live";

  const refreshLive = useCallback(() => {
    setLiveTick((t) => t + 1);
  }, []);

  useEffect(() => {
    setShowWelcome(isWelcomePending());
  }, [mode, liveTick]);

  useEffect(() => {
    if (mode !== "live") {
      setLiveEmpty(false);
      setLiveScores(null);
      return;
    }
    let cancelled = false;
    setLiveChecking(true);
    const project = apiConfig().project;
    Promise.all([
      listTraces({ limit: 50 }),
      getScores({ suite: "sample", profile: "balanced" }).catch(() =>
        getScores({ run_id: `import:sample:${project}`, profile: "balanced" }).catch(() => null),
      ),
    ])
      .then(([rows, scores]) => {
        if (cancelled) return;
        setLiveEmpty(!rows.length);
        setLiveScores(scores);
      })
      .catch(() => {
        if (!cancelled) {
          setLiveEmpty(false);
          setLiveScores(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLiveChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, liveTick]);

  const cards = useMemo(() => modelOverviewCards(data), [data]);
  const shownCards = useMemo(() => {
    let list = cards;
    if (agentFilter !== "all") list = list.filter((c) => c.agent === agentFilter);
    return list;
  }, [cards, agentFilter]);
  const pivot = useMemo(
    () => dimensionPivotSparse(data, agentFilter === "all" ? undefined : agentFilter),
    [data, agentFilter],
  );
  const fail = useMemo(() => failureOutcomeStack(data), [data]);
  const compare = useMemo(() => compareModelsSeries(data), [data]);
  const videoKpis = useMemo(() => videoOverviewKpis(data), [data]);
  const byQ = useMemo(() => videoByQuestionType(data), [data]);
  const cmKpis = useMemo(() => crossModalOverviewKpis(data), [data]);
  const cmFail = useMemo(() => crossModalFailureStack(data), [data]);
  const cmNoImage = useMemo(() => crossModalNoImageControl(data), [data]);
  const isCrossModal = modality === "cross_modal";

  const chartColors = useMemo(() => {
    if (typeof document === "undefined") {
      return { grid: "#1B2A41", label: "#8CA0BC", tipBg: "#0F1A2E", tipBorder: "#26395A", tipFg: "#E6F1FF", bar: "#2DD4BF" };
    }
    const s = getComputedStyle(document.documentElement);
    return {
      grid: s.getPropertyValue("--st-chart-grid").trim(),
      label: s.getPropertyValue("--st-chart-label").trim(),
      tipBg: s.getPropertyValue("--st-tooltip-bg").trim(),
      tipBorder: s.getPropertyValue("--st-border").trim(),
      tipFg: s.getPropertyValue("--st-ink").trim(),
      bar: s.getPropertyValue("--st-teal").trim(),
    };
  }, []);

  const showLiveOnboarding = mode === "live" && (liveEmpty || liveChecking);

  return (
    <>
      <Topbar hideTitle />
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

        {showWelcome ? (
          <WelcomePanel onDismiss={() => setShowWelcome(false)} />
        ) : null}

        {showLiveOnboarding ? (
          liveChecking ? (
            <SkeletonBlock rows={4} />
          ) : (
            <OnboardingEmpty title="No traces in this project yet" onSeeded={refreshLive} />
          )
        ) : (
          <>
            {!isDemo && !liveEmpty && !liveChecking ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Live project</CardTitle>
                    <CardDescription>Sample and SDK traces in this workspace.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild size="sm">
                      <Link href="/traces/">Browse traces</Link>
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Sessions</CardTitle>
                    <CardDescription>Grouped conversations and sample runs.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/sessions/">Open sessions</Link>
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Scores</CardTitle>
                    <CardDescription>
                      {liveScores
                        ? `Profile ${String((liveScores as { profile?: string }).profile || "balanced")}`
                        : "Run evaluations to populate UMS scores."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-xs text-ink-muted">
                    {liveScores && Array.isArray((liveScores as { rows?: unknown }).rows) ? (
                      <span className="tabular-nums text-ink">
                        {(liveScores as { rows: unknown[] }).rows.length} scored row
                        {(liveScores as { rows: unknown[] }).rows.length === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span>No score rows yet</span>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}

            {isDemo ? (
              <>
            <FilterBar className="!py-1.5">
              <div className="w-40">
                <Select value={agentFilter} onValueChange={setAgentFilter}>
                  <SelectTrigger aria-label="Filter by model" className="h-8">
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
              <div className="w-36">
                <Select value={variantFilter} onValueChange={setVariantFilter}>
                  <SelectTrigger aria-label="Filter by variant" className="h-8">
                    <SelectValue placeholder="Variant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All variants</SelectItem>
                    {variants.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </FilterBar>

            {loading ? <SkeletonBlock rows={5} /> : null}
            {error ? (
              <ErrorState title="Could not load overview" detail={error} onRetry={reload} />
            ) : null}

            {!loading && !error && !data.runs.length ? (
              <EmptyState
                title="No evaluation results yet"
                detail="Pick a demo dataset from the data source control."
              />
            ) : null}

            {!loading && !error && data.runs.length > 0 ? (
              <>
                {shownCards.map((c) => (
                  <section key={c.agent} className="space-y-2">
                    <h2 className="section-title text-ink">{c.agent}</h2>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <KpiTile
                        label="Correct"
                        value={pct(c.correct, 0)}
                        tip="Share of runs whose answer matched the expectation"
                      />
                      <KpiTile
                        label="Confidently wrong"
                        value={pct(c.confidentlyWrong, 0)}
                        tip="Wrong answers that were not abstentions"
                      />
                      <KpiTile
                        label="Said it could not read"
                        value={pct(c.couldNotRead, 0)}
                        tip="Runs labeled abstained"
                      />
                      <KpiTile
                        label="Score (UMS)"
                        value={c.ums != null ? pct(c.ums, 0) : "Not scored yet"}
                        tip={
                          c.ums != null
                            ? "Unified Multimodal Score from scores.overall"
                            : "scores.overall is missing for this model in the current suite"
                        }
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
                    {c.confidentByVariant.length && variantFilter === "all" ? (
                      <div className="rounded-xl border border-hairline bg-raised px-3 py-2">
                        <div className="label-mono mb-1">Confident errors by variant</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] tabular-nums text-ink-muted">
                          {c.confidentByVariant.map((v) => (
                            <span key={v.variant}>
                              {v.variant}: {pct(v.rate, 0)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ))}

                {modality === "video" ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="section-title">By question type</CardTitle>
                      <CardDescription>
                        Overall grounded {pct(videoKpis.grounded, 0)} · abstained{" "}
                        {pct(videoKpis.abstained, 0)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="overflow-auto">
                      <table className="sticky-table w-full min-w-[560px] text-left text-[13px] leading-5">
                        <thead>
                          <tr>
                            <th className="px-2 py-2">Type</th>
                            <th className="px-2 py-2 text-right">Clean</th>
                            <th className="px-2 py-2 text-right">Sparse</th>
                            <th className="px-2 py-2 text-right">Blur</th>
                            <th className="px-2 py-2 text-right">No frames</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byQ.map((row) => (
                            <tr key={row.kind} className="border-t border-hairline">
                              <td className="px-2 py-1.5 font-medium">{row.kind}</td>
                              {(["clean", "sparse", "blur", "blind_guess"] as const).map((col) => {
                                const cell = row.cells[col] || { correct: 0, total: 0 };
                                return (
                                  <td key={col} className="px-2 py-1.5 text-right tabular-nums">
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
                    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <KpiTile
                        label="Verdict accuracy"
                        value={pct(cmKpis.verdictAccuracy, 0)}
                        hint={`${cmKpis.nCorrect} / ${cmKpis.n} runs`}
                      />
                      <KpiTile label="Missed contradictions" value={`${cmKpis.missedContradictions}`} />
                      <KpiTile label="False alarms" value={`${cmKpis.falseAlarms}`} />
                      <KpiTile label="Abstentions" value={`${cmKpis.abstentions}`} />
                    </section>
                    <div className="grid gap-3 xl:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <CardTitle className="section-title">Where it failed</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <StackedOutcomeBars rows={cmFail.rows} labels={cmFail.labels} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle className="section-title">No-image control</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="relative h-10 overflow-hidden rounded-lg border border-hairline bg-muted/40">
                            <div
                              className="absolute inset-y-0 left-0 bg-teal/25"
                              style={{ width: `${Math.min(100, (cmNoImage.rate ?? 0) * 100)}%` }}
                            />
                            <div className="absolute inset-y-0 w-px bg-ink/40" style={{ left: "50%" }} />
                            <div className="relative flex h-full items-center justify-between px-3 text-xs">
                              <span className="font-medium tabular-nums">
                                {cmNoImage.total
                                  ? `${cmNoImage.correct} / ${cmNoImage.total} (${pct(cmNoImage.rate ?? 0, 0)})`
                                  : "—"}
                              </span>
                              <span className="text-ink-muted">chance 50%</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle className="section-title">How each dimension scores</CardTitle>
                    <CardDescription>Means from completed evaluators. Empty dimensions are hidden.</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-auto">
                    {!pivot.dims.length ? (
                      <EmptyState title="No dimension scores yet" />
                    ) : (
                      <table className="sticky-table w-full min-w-[640px] border-collapse text-left text-[13px] leading-5">
                        <thead>
                          <tr>
                            <th className="px-2 py-2">Dimension</th>
                            {pivot.variants
                              .filter((v) => variantFilter === "all" || v === variantFilter)
                              .map((v) => (
                                <th key={v} className="px-2 py-2 text-right">
                                  {v}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pivot.dims.map((dim) => (
                            <tr key={dim} className="border-t border-hairline">
                              <td className="px-2 py-1.5 font-medium">{dim}</td>
                              {pivot.variants
                                .filter((v) => variantFilter === "all" || v === variantFilter)
                                .map((v) => (
                                  <td key={v} className="px-2 py-1.5 text-right tabular-nums">
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
                        <CardTitle className="section-title">Where it failed</CardTitle>
                        <CardDescription>Stage labels by model and variant</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <StackedOutcomeBars rows={fail.rows} labels={fail.labels} />
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="section-title">Compare models</CardTitle>
                        <CardDescription>Overall score (UMS when available)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-64 w-full min-w-0">
                          <ResponsiveContainer>
                            <BarChart data={compare} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                              <CartesianGrid stroke={chartColors.grid} vertical={false} />
                              <XAxis
                                dataKey="agent"
                                tick={{ fontSize: 10, fill: chartColors.label }}
                                interval={0}
                                angle={-20}
                                textAnchor="end"
                                height={50}
                              />
                              <YAxis
                                domain={[0, 100]}
                                tick={{ fontSize: 10, fill: chartColors.label }}
                                tickFormatter={(v) => `${v}%`}
                              />
                              <Tooltip
                                contentStyle={{
                                  fontSize: 12,
                                  borderRadius: 8,
                                  background: chartColors.tipBg,
                                  borderColor: chartColors.tipBorder,
                                  color: chartColors.tipFg,
                                }}
                                formatter={(v: number) => [`${v}%`, "Score"]}
                              />
                              <Bar dataKey="ums" fill={chartColors.bar} name="Score" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : null}
              </>
            ) : null}
              </>
            ) : null}

          </>
        )}
      </main>
    </>
  );
}
