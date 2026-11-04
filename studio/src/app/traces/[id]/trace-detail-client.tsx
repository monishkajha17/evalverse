"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { OutcomeChip, VerdictChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudioEvidencePanel, ImageEvidenceOverlay } from "@/components/trace/media-panel";
import { useSuite } from "@/context/suite-context";
import { findCase, findRun, findTrace, resultsForTrace } from "@/lib/data";
import { decodeTraceId, fmtLatency, fmtTokens, pct } from "@/lib/utils";

export function TraceDetailClient({ id: rawId }: { id: string }) {
  const id = decodeTraceId(rawId);
  const { data, loading, error } = useSuite();
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);

  const trace = useMemo(() => findTrace(data, id), [data, id]);
  const run = useMemo(
    () => (trace ? findRun(data, trace.agent, trace.case_id, trace.variant) : undefined),
    [data, trace],
  );
  const caseRow = useMemo(
    () => (trace ? findCase(data, trace.case_id) : undefined),
    [data, trace],
  );
  const results = useMemo(
    () => (trace ? resultsForTrace(data, trace) : []),
    [data, trace],
  );

  const isAudio =
    caseRow?.modality === "audio" ||
    data.meta.modality === "audio" ||
    Boolean(caseRow?.audio && !caseRow?.image);

  return (
    <>
      <Topbar title="Trace detail" />
      <main className="space-y-3 p-4">
        <div className="text-xs text-ink/50">
          <Link href="/traces/" className="text-teal hover:underline">
            ← Traces
          </Link>
        </div>

        {loading ? <LoadingState /> : null}
        {error ? <EmptyState title="Could not load suite" detail={error} /> : null}
        {!loading && !error && !trace ? (
          <EmptyState
            title="Trace not found in this suite"
            detail={`No trace with id “${id}”. Switch suite in the top bar if it lives elsewhere.`}
          />
        ) : null}

        {trace ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">{trace.id}</h2>
              <Badge className="border-border bg-white text-ink/70">{trace.agent}</Badge>
              <Badge className="border-border bg-white text-ink/70">{trace.case_id}</Badge>
              <Badge className="border-border bg-white text-ink/70">{trace.variant}</Badge>
              <OutcomeChip label={run?.label} />
              {trace.variant_transform ? (
                <Badge className="border-border bg-muted text-ink/60">{trace.variant_transform}</Badge>
              ) : null}
            </div>

            <div className="grid gap-3 xl:grid-cols-[340px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Span waterfall</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {(trace.spans || []).length === 0 ? (
                    <p className="text-xs text-ink/50">No spans recorded.</p>
                  ) : (
                    (trace.spans || []).map((span) => {
                      const depth = span.parent_span_ids?.length || 0;
                      return (
                        <div
                          key={span.id}
                          className="rounded border border-border bg-paper/50 px-2 py-1.5"
                          style={{ marginLeft: depth * 12 }}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className="border-border bg-white text-[10px] uppercase text-ink/60">
                              {span.type || "span"}
                            </Badge>
                            <span className="text-xs font-medium text-ink">{span.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink/55">
                            <span>latency {fmtLatency(span.latency_s)}</span>
                            <span>tokens {fmtTokens(span.usage)}</span>
                            <span>
                              parents{" "}
                              {(span.parent_span_ids || []).length
                                ? (span.parent_span_ids || []).join(", ")
                                : "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-3">
                  <Tabs defaultValue="media">
                    <TabsList>
                      <TabsTrigger value="media">Media</TabsTrigger>
                      <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
                      <TabsTrigger value="prompt">Prompt &amp; output</TabsTrigger>
                    </TabsList>

                    <TabsContent value="media">
                      {isAudio ? (
                        <AudioEvidencePanel caseRow={caseRow} run={run} />
                      ) : (
                        <ImageEvidenceOverlay caseRow={caseRow} run={run} trace={trace} />
                      )}
                    </TabsContent>

                    <TabsContent value="evaluations">
                      <div className="overflow-auto">
                        <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
                          <thead>
                            <tr className="text-ink/60">
                              <th className="px-2 py-2">Evaluator</th>
                              <th className="px-2 py-2">Dimension</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2">Score</th>
                              <th className="px-2 py-2">Verdict</th>
                              <th className="px-2 py-2">Label</th>
                              <th className="px-2 py-2">Explanation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="px-2 py-6 text-center text-ink/50">
                                  No evaluation results for this trace.
                                </td>
                              </tr>
                            ) : (
                              results.map((r) => (
                                <Fragment key={r.id}>
                                  <tr
                                    className="cursor-pointer border-t border-border hover:bg-muted/50"
                                    onClick={() =>
                                      setOpenEvidence((cur) => (cur === r.id ? null : r.id))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setOpenEvidence((cur) => (cur === r.id ? null : r.id));
                                      }
                                    }}
                                    tabIndex={0}
                                  >
                                    <td className="px-2 py-1.5 font-medium">{r.evaluator_id}</td>
                                    <td className="px-2 py-1.5">{r.dimension || "—"}</td>
                                    <td className="px-2 py-1.5">{r.status}</td>
                                    <td className="px-2 py-1.5 tabular-nums">{pct(r.score, 0)}</td>
                                    <td className="px-2 py-1.5">
                                      <VerdictChip verdict={r.verdict} />
                                    </td>
                                    <td className="px-2 py-1.5">{r.label || "—"}</td>
                                    <td className="max-w-xs truncate px-2 py-1.5 text-ink/70">
                                      {r.explanation || "—"}
                                    </td>
                                  </tr>
                                  {openEvidence === r.id ? (
                                    <tr className="border-t border-border bg-paper/70">
                                      <td colSpan={7} className="px-3 py-2">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                                          Evidence
                                        </div>
                                        {(r.evidence || []).length === 0 ? (
                                          <p className="mt-1 text-xs text-ink/50">No evidence payload.</p>
                                        ) : (
                                          <pre className="mono mt-1 max-h-48 overflow-auto rounded border border-border bg-white p-2 text-[11px]">
                                            {JSON.stringify(r.evidence, null, 2)}
                                          </pre>
                                        )}
                                      </td>
                                    </tr>
                                  ) : null}
                                </Fragment>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </TabsContent>

                    <TabsContent value="prompt">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                            Prompt
                          </div>
                          <pre className="mono max-h-[420px] overflow-auto rounded border border-border bg-paper p-2 text-[11px] leading-relaxed">
                            {run?.prompt || "—"}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                            Raw model reply
                          </div>
                          <pre className="mono max-h-[420px] overflow-auto rounded border border-border bg-paper p-2 text-[11px] leading-relaxed">
                            {run?.raw || "—"}
                          </pre>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
