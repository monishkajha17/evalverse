"use client";

import { useMemo } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerdictChip } from "@/components/outcome-chip";
import { useSuite } from "@/context/suite-context";
import { rubricFor, workedExample } from "@/lib/rubrics";
import { pct } from "@/lib/utils";

export default function EvaluatorsPage() {
  const { data, loading, error } = useSuite();

  const registry = useMemo(() => data.registry || [], [data.registry]);
  const cards = useMemo(
    () =>
      registry.map((entry) => ({
        entry,
        rubric: rubricFor(entry.id),
        example: workedExample(data, entry.id),
      })),
    [registry, data],
  );

  return (
    <>
      <Topbar title="Evaluators" />
      <main className="space-y-4 p-4">
        {loading ? <LoadingState /> : null}
        {error ? <EmptyState title="Could not load suite" detail={error} /> : null}

        {!loading && !error ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Registry</CardTitle>
                <CardDescription>Evaluators declared in the suite payload</CardDescription>
              </CardHeader>
              <CardContent className="overflow-auto">
                {registry.length === 0 ? (
                  <EmptyState title="No registry entries" />
                ) : (
                  <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="text-ink/60">
                        <th className="px-2 py-2">ID</th>
                        <th className="px-2 py-2">Category</th>
                        <th className="px-2 py-2">Dimension</th>
                        <th className="px-2 py-2">Needs reference</th>
                        <th className="px-2 py-2">Scope</th>
                        <th className="px-2 py-2">Version</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registry.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-2 py-1.5 font-medium">{r.id}</td>
                          <td className="px-2 py-1.5">{r.category || "—"}</td>
                          <td className="px-2 py-1.5">{r.dimension || "—"}</td>
                          <td className="px-2 py-1.5">{r.needs_reference ? "yes" : "no"}</td>
                          <td className="px-2 py-1.5">{r.scope || "—"}</td>
                          <td className="px-2 py-1.5">{r.version || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-3 lg:grid-cols-2">
              {cards.map(({ entry, rubric, example }) => (
                <Card key={entry.id}>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      Rubric · {entry.id}
                      <Badge className="border-border bg-muted text-ink/60">{entry.dimension}</Badge>
                    </CardTitle>
                    <CardDescription>{entry.category} · scope {entry.scope}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-ink/80">
                    <p>
                      <span className="font-semibold text-ink">Checks: </span>
                      {rubric.checks}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Scores: </span>
                      {rubric.scores}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Pass threshold: </span>
                      {rubric.threshold}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <span className="font-semibold text-ink">Labels:</span>
                      {(rubric.labels.length ? rubric.labels : ["—"]).map((l) => (
                        <Badge key={l} className="border-border bg-white text-ink/70">
                          {l}
                        </Badge>
                      ))}
                    </div>
                    <div className="rounded border border-border bg-paper/70 p-2">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                        Worked example
                      </div>
                      {example ? (
                        <div className="space-y-1">
                          <div>
                            {example.target.agent} · {example.target.case_id} · {example.target.variant}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <VerdictChip verdict={example.verdict} />
                            <span>score {pct(example.score, 0)}</span>
                            <span>label {example.label || "—"}</span>
                          </div>
                          <p className="text-ink/70">{example.explanation || "No explanation."}</p>
                        </div>
                      ) : (
                        <p className="text-ink/50">No completed result for this evaluator in the loaded suite.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}
