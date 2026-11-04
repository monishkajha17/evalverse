"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSuite } from "@/context/suite-context";
import { judgeTrust } from "@/lib/metrics";
import { encodeTraceId, pct } from "@/lib/utils";

export default function JudgePage() {
  const { data, loading, error } = useSuite();
  const trust = useMemo(() => judgeTrust(data.judged || []), [data.judged]);

  const planted = useMemo(() => {
    const rows = data.judged || [];
    const right = rows.filter((j) => j.kind === "planted_right");
    const wrong = rows.filter((j) => j.kind === "planted_wrong");
    const rightOk = right.filter((j) => j.judge_accepts === true).length;
    const wrongOk = wrong.filter((j) => j.judge_accepts === false).length;
    return {
      rightN: right.length,
      wrongN: wrong.length,
      rightOk,
      wrongOk,
    };
  }, [data.judged]);

  return (
    <>
      <Topbar title="Judge" />
      <main className="space-y-4 p-4">
        {loading ? <LoadingState /> : null}
        {error ? <EmptyState title="Could not load suite" detail={error} /> : null}

        {!loading && !error ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Audit stats</CardTitle>
                  <CardDescription>Agent-answer judgments vs ground truth</CardDescription>
                </CardHeader>
                <CardContent>
                  {trust.n === 0 ? (
                    <EmptyState title="No judged agent answers" />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Compared" value={`${trust.n}`} />
                      <Stat label="False accept" value={`${trust.falseAccept} (${pct(trust.falseAcceptRate, 0)})`} />
                      <Stat label="False reject" value={`${trust.falseReject} (${pct(trust.falseRejectRate, 0)})`} />
                      <Stat label="True accept" value={`${trust.trueAccept}`} />
                      <Stat label="True reject" value={`${trust.trueReject}`} />
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Planted probes</CardTitle>
                  <CardDescription>Known-right / known-wrong answers shown to the judge</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2">
                  <Stat
                    label="Planted right accepted"
                    value={`${planted.rightOk}/${planted.rightN || 0}`}
                  />
                  <Stat
                    label="Planted wrong rejected"
                    value={`${planted.wrongOk}/${planted.wrongN || 0}`}
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Disagreements</CardTitle>
                <CardDescription>Judge vs truth mismatches — open the related trace</CardDescription>
              </CardHeader>
              <CardContent className="overflow-auto">
                {(data.disagreements || []).length === 0 ? (
                  <EmptyState title="No disagreements" detail="Judge and truth agree on compared agent answers." />
                ) : (
                  <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="text-ink/60">
                        <th className="px-2 py-2">Kind</th>
                        <th className="px-2 py-2">Agent</th>
                        <th className="px-2 py-2">Case</th>
                        <th className="px-2 py-2">Variant</th>
                        <th className="px-2 py-2">Judge</th>
                        <th className="px-2 py-2">Truth</th>
                        <th className="px-2 py-2">Proposed</th>
                        <th className="px-2 py-2">Trace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.disagreements.map((d, i) => {
                        const variant = d.variant || "clean";
                        const traceId =
                          d.agent && d.case_id ? `${d.agent}|${d.case_id}|${variant}` : null;
                        return (
                          <tr key={`${d.case_id}-${d.agent}-${i}`} className="border-t border-border">
                            <td className="px-2 py-1.5">{d.kind || "—"}</td>
                            <td className="px-2 py-1.5">{d.agent || "—"}</td>
                            <td className="px-2 py-1.5 font-medium">{d.case_id || "—"}</td>
                            <td className="px-2 py-1.5">{variant}</td>
                            <td className="px-2 py-1.5">
                              <Badge
                                className={
                                  d.judge_accepts
                                    ? "border-teal/30 bg-teal/10 text-teal"
                                    : "border-crimson/30 bg-crimson/10 text-crimson"
                                }
                              >
                                {d.judge_accepts ? "accept" : "reject"}
                              </Badge>
                            </td>
                            <td className="px-2 py-1.5">
                              <Badge
                                className={
                                  d.truth_correct
                                    ? "border-teal/30 bg-teal/10 text-teal"
                                    : "border-crimson/30 bg-crimson/10 text-crimson"
                                }
                              >
                                {d.truth_correct ? "correct" : "incorrect"}
                              </Badge>
                            </td>
                            <td className="px-2 py-1.5">{String(d.proposed ?? "—")}</td>
                            <td className="px-2 py-1.5">
                              {traceId ? (
                                <Link
                                  href={`/traces/${encodeTraceId(traceId)}/`}
                                  className="text-teal hover:underline"
                                >
                                  open
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-paper/60 px-2.5 py-2">
      <div className="text-[11px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
