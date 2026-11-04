"use client";

import { useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { GroundedLineChart, StackedOutcomeBars } from "@/components/charts/overview-charts";
import { useSuite } from "@/context/suite-context";
import {
  agentKpis,
  dimensionPivot,
  groundedSeries,
  judgeTrust,
  outcomeStack,
} from "@/lib/metrics";
import { pct } from "@/lib/utils";

export default function OverviewPage() {
  const { data, loading, error } = useSuite();
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const kpis = useMemo(() => agentKpis(data), [data]);
  const pivot = useMemo(
    () => dimensionPivot(data, agentFilter === "all" ? undefined : agentFilter),
    [data, agentFilter],
  );
  const stack = useMemo(() => outcomeStack(data), [data]);
  const series = useMemo(() => groundedSeries(data), [data]);
  const trust = useMemo(() => judgeTrust(data.judged || []), [data]);

  return (
    <>
      <Topbar title="Overview" />
      <main className="space-y-4 p-4">
        {loading ? <LoadingState /> : null}
        {error ? (
          <EmptyState title="Could not load suite" detail={error} />
        ) : !loading && !data.runs.length ? (
          <EmptyState title="No runs in this suite" detail="Export results and re-run the studio data export." />
        ) : null}

        {!loading && !error ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
              {kpis.map((k) => (
                <Card key={k.agent}>
                  <CardHeader>
                    <CardTitle>{k.agent}</CardTitle>
                    <CardDescription>Per-agent KPIs across the selected suite</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Kpi label="Grounded" value={pct(k.grounded, 0)} hint="evidence / stage grounded share" />
                      <Kpi label="Confident error" value={pct(k.confidentError, 0)} hint="wrong, non-abstention" />
                      <Kpi label="Media required" value={pct(k.mediaRequired, 0)} hint="blind vs clean" />
                      <Kpi label="Robustness" value={pct(k.robustness, 0)} hint="survives degradation" />
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!kpis.length ? <EmptyState title="No agents found" /> : null}
            </section>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle>Scores by dimension</CardTitle>
                  <CardDescription>Mean score from dimension_summary; columns are variants</CardDescription>
                </div>
                <div className="w-40">
                  <Select value={agentFilter} onValueChange={setAgentFilter}>
                    <SelectTrigger aria-label="Filter agent">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All agents</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="overflow-auto">
                {pivot.dims.length === 0 ? (
                  <EmptyState title="No dimension summary" />
                ) : (
                  <table className="sticky-table w-full min-w-[640px] border-collapse text-left text-xs">
                    <thead>
                      <tr>
                        <th className="px-2 py-2 font-semibold text-ink/70">Dimension</th>
                        {pivot.variants.map((v) => (
                          <th key={v} className="px-2 py-2 font-semibold text-ink/70">
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
                            <td key={v} className="px-2 py-1.5 tabular-nums text-ink/80">
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

            <div className="grid gap-3 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Outcomes by agent × variant</CardTitle>
                  <CardDescription>Stacked counts — colour + label in the legend</CardDescription>
                </CardHeader>
                <CardContent>
                  <StackedOutcomeBars rows={stack.rows} labels={stack.labels} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Grounded share vs image condition</CardTitle>
                  <CardDescription>Line chart for each agent across variants</CardDescription>
                </CardHeader>
                <CardContent>
                  <GroundedLineChart series={series} agents={agents} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Judge trust</CardTitle>
                <CardDescription>
                  From judged agent answers where accept/reject can be compared to truth
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trust.n === 0 ? (
                  <EmptyState title="No judge audit rows" detail="Run with a judge to populate judged[]." />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Kpi label="False accept" value={`${trust.falseAccept}`} hint={pct(trust.falseAcceptRate, 0)} />
                    <Kpi label="False reject" value={`${trust.falseReject}`} hint={pct(trust.falseRejectRate, 0)} />
                    <Kpi label="True accept" value={`${trust.trueAccept}`} hint="judge + truth agree yes" />
                    <Kpi label="True reject" value={`${trust.trueReject}`} hint="judge + truth agree no" />
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-paper/60 px-2.5 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="text-[11px] text-ink/45">{hint}</div> : null}
    </div>
  );
}
