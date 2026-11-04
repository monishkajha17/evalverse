"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { OutcomeChip, StatusDot } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { findCase, findRun, resultsForTrace } from "@/lib/data";
import { listTraces, type TraceListItem } from "@/lib/api";
import { fmtMs, sourceChipClass, statusChipClass, tokenTotal } from "@/lib/trace-helpers";
import { encodeTraceId, fmtLatency, fmtTokens } from "@/lib/utils";

export default function TracesPage() {
  const { mode } = useApiMode();
  if (mode === "live") return <LiveTraces />;
  return <SnapshotTraces />;
}

function LiveTraces() {
  const [rows, setRows] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [session, setSession] = useState("all");
  const [agent, setAgent] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await listTraces({
        session_id: session === "all" ? null : session,
        agent: agent === "all" ? null : agent,
        source: source === "all" ? null : source,
        status: status === "all" ? null : status,
        q: q || null,
        limit: 100,
      });
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load traces");
    } finally {
      setLoading(false);
    }
  }, [session, agent, source, status, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => load(true), 3000);
    return () => clearInterval(id);
  }, [live, load]);

  const agents = useMemo(
    () => [...new Set(rows.map((r) => r.agent).filter(Boolean) as string[])].sort(),
    [rows],
  );
  const sessions = useMemo(
    () => [...new Set(rows.map((r) => r.session_id).filter(Boolean) as string[])].sort(),
    [rows],
  );

  return (
    <>
      <Topbar title="Traces">
        <label className="flex items-center gap-1.5 text-xs text-ink/70">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="rounded border-border"
          />
          Live
          {live ? <span className="text-teal">(3s)</span> : null}
        </label>
      </Topbar>
      <main className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Filter label="Session">
            <Select value={session} onValueChange={setSession}>
              <SelectTrigger className="w-44" aria-label="Session">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {sessions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Agent">
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="w-40" aria-label="Agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Source">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-28" aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="sdk">sdk</SelectItem>
                <SelectItem value="otlp">otlp</SelectItem>
                <SelectItem value="import">import</SelectItem>
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="completed">completed</SelectItem>
                <SelectItem value="running">running</SelectItem>
                <SelectItem value="error">error</SelectItem>
              </SelectContent>
            </Select>
          </Filter>
          <div className="min-w-[200px] flex-1">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink/45">
              Search / tags
            </div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="q / tags…" />
          </div>
        </div>

        {loading && !rows.length ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Failed to load traces" detail={error} /> : null}

        <div className="overflow-auto rounded-lg border border-border bg-white">
          <table className="sticky-table w-full min-w-[960px] border-collapse text-left text-xs">
            <thead>
              <tr className="text-ink/60">
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Tool calls</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Tokens</th>
                <th className="px-3 py-2">Scores</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink/50">
                    No traces match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className="border-t border-border hover:bg-muted/60">
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/traces/view/?id=${encodeURIComponent(t.id)}`}
                        className="font-medium text-teal hover:underline"
                      >
                        {t.id.slice(0, 12)}…
                      </Link>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-1.5">{t.name || "—"}</td>
                    <td className="px-3 py-1.5">{t.agent || "—"}</td>
                    <td className="px-3 py-1.5">
                      <Badge className={sourceChipClass(t.source)}>{t.source || "unknown"}</Badge>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{t.tool_call_count ?? 0}</td>
                    <td className="px-3 py-1.5 tabular-nums">{fmtMs(t.latency_ms)}</td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {tokenTotal(t.input_tokens, t.output_tokens)}
                    </td>
                    <td className="px-3 py-1.5">
                      <ScoreDots summary={t.score_summary} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function ScoreDots({
  summary,
}: {
  summary?: { count?: number; mean?: number | null; by_dimension?: Record<string, unknown> };
}) {
  const dims = Object.entries(summary?.by_dimension || {});
  if (!dims.length) {
    return <span className="text-ink/40">{summary?.count ? `${summary.count}` : "—"}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {dims.slice(0, 6).map(([dim, val]) => {
        const mean =
          typeof val === "number"
            ? val
            : val && typeof val === "object" && "mean" in val
              ? (val as { mean?: number | null }).mean
              : null;
        const verdict = mean == null ? "n/a" : mean >= 0.5 ? "pass" : "fail";
        return <StatusDot key={dim} verdict={verdict} label={`${dim}: ${mean ?? "—"}`} />;
      })}
    </div>
  );
}

function SnapshotTraces() {
  const { data, loading, error, suite, index, setSuite } = useSuite();
  const [agent, setAgent] = useState("all");
  const [variant, setVariant] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return (data.traces || [])
      .map((trace) => {
        const run = findRun(data, trace.agent, trace.case_id, trace.variant);
        const caseRow = findCase(data, trace.case_id);
        const results = resultsForTrace(data, trace);
        return { trace, run, caseRow, results };
      })
      .filter(({ trace, run }) => {
        if (agent !== "all" && trace.agent !== agent) return false;
        if (variant !== "all" && trace.variant !== variant) return false;
        if (outcome !== "all" && (run?.label || "") !== outcome) return false;
        if (q && !trace.case_id.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      });
  }, [data, agent, variant, outcome, q]);

  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = data.meta.conditions || [];
  const outcomes = [...new Set(data.runs.map((r) => r.label).filter(Boolean) as string[])];

  return (
    <>
      <Topbar title="Traces (snapshot)" />
      <main className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Filter label="Suite">
            <Select value={suite} onValueChange={setSuite}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {index.map((e) => (
                  <SelectItem key={e.suite} value={e.suite}>
                    {e.suite}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Agent">
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Variant">
            <Select value={variant} onValueChange={setVariant}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {variants.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <Filter label="Outcome">
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {outcomes.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
          <div className="min-w-[160px] flex-1">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-ink/45">Case</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="case id…" />
          </div>
        </div>
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Snapshot load failed" detail={error} /> : null}
        <div className="overflow-auto rounded-lg border border-border bg-white">
          <table className="sticky-table w-full min-w-[900px] border-collapse text-left text-xs">
            <thead>
              <tr className="text-ink/60">
                <th className="px-3 py-2">Trace</th>
                <th className="px-3 py-2">Case</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Answer</th>
                <th className="px-3 py-2">Latency</th>
                <th className="px-3 py-2">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ trace, run, caseRow }) => (
                <tr key={trace.id} className="border-t border-border hover:bg-muted/60">
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/traces/view/?id=${encodeURIComponent(trace.id)}&suite=${encodeURIComponent(suite)}`}
                      className="font-medium text-teal hover:underline"
                    >
                      {trace.id}
                    </Link>
                    <span className="ml-2 text-ink/30">
                      <Link href={`/traces/${encodeTraceId(trace.id)}/`} className="hover:underline">
                        (legacy)
                      </Link>
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{trace.case_id}</td>
                  <td className="px-3 py-1.5">{trace.agent}</td>
                  <td className="px-3 py-1.5">{trace.variant}</td>
                  <td className="px-3 py-1.5">
                    <OutcomeChip label={run?.label} />
                  </td>
                  <td className="px-3 py-1.5">
                    {run?.answer ?? "—"} / {caseRow?.answer ?? "—"}
                  </td>
                  <td className="px-3 py-1.5">{fmtLatency(run?.latency)}</td>
                  <td className="px-3 py-1.5">{fmtTokens(run?.usage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink/45">{label}</div>
      {children}
    </div>
  );
}
