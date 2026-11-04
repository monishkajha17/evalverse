"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { OutcomeChip, StatusDot } from "@/components/outcome-chip";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSuite } from "@/context/suite-context";
import { findCase, findRun, resultsForTrace } from "@/lib/data";
import { encodeTraceId, fmtLatency, fmtTokens } from "@/lib/utils";

export default function TracesPage() {
  const { data, loading, error, suite, index, setSuite } = useSuite();
  const [agent, setAgent] = useState("all");
  const [variant, setVariant] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [needsReview, setNeedsReview] = useState(false);
  const [q, setQ] = useState("");

  const reviewCases = useMemo(() => {
    const s = new Set<string>();
    for (const d of data.disagreements || []) {
      if (d.case_id) s.add(d.case_id);
    }
    return s;
  }, [data.disagreements]);

  const outcomes = useMemo(
    () => [...new Set(data.runs.map((r) => r.label).filter(Boolean) as string[])].sort(),
    [data.runs],
  );
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter(Boolean);

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
        if (needsReview && !reviewCases.has(trace.case_id)) return false;
        if (q && !trace.case_id.toLowerCase().includes(q.toLowerCase()) && !trace.id.toLowerCase().includes(q.toLowerCase()))
          return false;
        return true;
      });
  }, [data, agent, variant, outcome, needsReview, reviewCases, q]);

  return (
    <>
      <Topbar title="Traces" />
      <main className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Filter label="Suite">
            <Select value={suite} onValueChange={setSuite}>
              <SelectTrigger className="w-36" aria-label="Suite filter">
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
              <SelectTrigger className="w-40" aria-label="Agent filter">
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
              <SelectTrigger className="w-32" aria-label="Variant filter">
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
              <SelectTrigger className="w-40" aria-label="Outcome filter">
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
          <label className="mb-1 flex items-center gap-1.5 text-xs text-ink/70">
            <input
              type="checkbox"
              checked={needsReview}
              onChange={(e) => setNeedsReview(e.target.checked)}
              className="rounded border-border"
            />
            Needs review
          </label>
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink/45">Search case</div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="case id…"
              aria-label="Search by case id"
            />
          </div>
        </div>

        {loading ? <LoadingState /> : null}
        {error ? <EmptyState title="Could not load suite" detail={error} /> : null}

        {!loading && !error ? (
          <div className="overflow-auto rounded-lg border border-border bg-white">
            <table className="sticky-table w-full min-w-[960px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-ink/60">
                  <th className="px-3 py-2 font-semibold">Trace</th>
                  <th className="px-3 py-2 font-semibold">Case</th>
                  <th className="px-3 py-2 font-semibold">Agent</th>
                  <th className="px-3 py-2 font-semibold">Variant</th>
                  <th className="px-3 py-2 font-semibold">Outcome</th>
                  <th className="px-3 py-2 font-semibold">Answer vs expected</th>
                  <th className="px-3 py-2 font-semibold">Latency</th>
                  <th className="px-3 py-2 font-semibold">Tokens</th>
                  <th className="px-3 py-2 font-semibold">Evals</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-ink/50">
                      No traces match these filters.
                    </td>
                  </tr>
                ) : (
                  rows.map(({ trace, run, caseRow, results }) => (
                    <tr key={trace.id} className="border-t border-border hover:bg-muted/60">
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/traces/${encodeTraceId(trace.id)}/`}
                          className="font-medium text-teal hover:underline focus-visible:outline-none"
                        >
                          {trace.id}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5">{trace.case_id}</td>
                      <td className="px-3 py-1.5">{trace.agent}</td>
                      <td className="px-3 py-1.5">{trace.variant}</td>
                      <td className="px-3 py-1.5">
                        <OutcomeChip label={run?.label} />
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{run?.answer ?? "—"}</span>
                        <span className="text-ink/40"> / </span>
                        <span className="text-ink/60">{caseRow?.answer ?? "—"}</span>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{fmtLatency(run?.latency)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{fmtTokens(run?.usage)}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {results.slice(0, 8).map((r) => (
                            <StatusDot key={r.id} verdict={r.verdict} label={r.evaluator_id} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
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
