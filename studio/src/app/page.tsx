"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { GroundedLineChart, StackedOutcomeBars } from "@/components/charts/overview-charts";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  agentKpis,
  dimensionPivot,
  groundedSeries,
  judgeTrust,
  outcomeStack,
} from "@/lib/metrics";
import { getQueue, listSessions, listTraces, type QueueStats, type SessionSummary, type TraceListItem } from "@/lib/api";
import { pct } from "@/lib/utils";

export default function OverviewPage() {
  const { mode } = useApiMode();
  if (mode === "live") return <LiveOverview />;
  return <SnapshotOverview />;
}

function LiveOverview() {
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, s, q] = await Promise.all([listTraces({ limit: 100 }), listSessions(), getQueue()]);
        if (!cancelled) {
          setTraces(t);
          setSessions(s);
          setQueue(q);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bySource = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of traces) m[t.source || "unknown"] = (m[t.source || "unknown"] || 0) + 1;
    return m;
  }, [traces]);

  return (
    <>
      <Topbar title="Overview" />
      <main className="space-y-4 p-4">
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Live overview failed" detail={error} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Traces" value={String(traces.length)} hint="latest page" />
          <Kpi label="Sessions" value={String(sessions.length)} hint="all sessions" />
          <Kpi label="Queue depth" value={String(queue?.depth ?? "—")} hint="pending jobs" />
          <Kpi label="Tool calls" value={String(traces.reduce((a, t) => a + (t.tool_call_count || 0), 0))} hint="on listed traces" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>sdk / otlp / import mix on the latest traces</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 text-xs">
            {Object.entries(bySource).map(([k, v]) => (
              <div key={k} className="rounded border border-border bg-paper px-3 py-2">
                <div className="uppercase tracking-wide text-ink/45">{k}</div>
                <div className="text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
            {!Object.keys(bySource).length ? <EmptyBlock title="No traces yet" /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-ink/60">
                  <th className="px-2 py-1">Session</th>
                  <th className="px-2 py-1">Traces</th>
                  <th className="px-2 py-1">Agents</th>
                  <th className="px-2 py-1">Errors</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 12).map((s) => (
                  <tr key={s.session_id} className="border-t border-border">
                    <td className="px-2 py-1">
                      <Link
                        className="text-teal hover:underline"
                        href={`/sessions/view/?id=${encodeURIComponent(s.session_id)}`}
                      >
                        {s.session_id}
                      </Link>
                    </td>
                    <td className="px-2 py-1 tabular-nums">{s.trace_count}</td>
                    <td className="px-2 py-1">{(s.agents || []).join(", ")}</td>
                    <td className="px-2 py-1 tabular-nums">{s.error_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-xs text-ink/50">
          Switch suite in the top bar still powers Snapshot views for Judge / legacy KPIs when the API is down.
        </p>
      </main>
    </>
  );
}

function SnapshotOverview() {
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
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Could not load suite" detail={error} /> : null}
        {!loading && !error ? (
          <>
            <section className="grid gap-3 md:grid-cols-2">
              {kpis.map((k) => (
                <Card key={k.agent}>
                  <CardHeader>
                    <CardTitle>{k.agent}</CardTitle>
                    <CardDescription>Snapshot suite KPIs</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Kpi label="Grounded" value={pct(k.grounded, 0)} />
                      <Kpi label="Confident error" value={pct(k.confidentError, 0)} />
                      <Kpi label="Media required" value={pct(k.mediaRequired, 0)} />
                      <Kpi label="Robustness" value={pct(k.robustness, 0)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle>Scores by dimension</CardTitle>
                  <CardDescription>From dimension_summary</CardDescription>
                </div>
                <div className="w-40">
                  <Select value={agentFilter} onValueChange={setAgentFilter}>
                    <SelectTrigger>
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
                <table className="sticky-table w-full min-w-[640px] border-collapse text-left text-xs">
                  <thead>
                    <tr>
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
              </CardContent>
            </Card>
            <div className="grid gap-3 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Outcomes by agent × variant</CardTitle>
                </CardHeader>
                <CardContent>
                  <StackedOutcomeBars rows={stack.rows} labels={stack.labels} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Grounded share vs condition</CardTitle>
                </CardHeader>
                <CardContent>
                  <GroundedLineChart series={series} agents={agents} />
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Judge trust</CardTitle>
              </CardHeader>
              <CardContent>
                {trust.n === 0 ? (
                  <EmptyBlock title="No judge audit rows" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Kpi label="False accept" value={`${trust.falseAccept}`} hint={pct(trust.falseAcceptRate, 0)} />
                    <Kpi label="False reject" value={`${trust.falseReject}`} hint={pct(trust.falseRejectRate, 0)} />
                    <Kpi label="True accept" value={`${trust.trueAccept}`} />
                    <Kpi label="True reject" value={`${trust.trueReject}`} />
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
