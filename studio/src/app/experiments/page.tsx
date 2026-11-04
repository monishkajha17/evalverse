"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, LoadingState } from "@/components/empty-state";
import { OutcomeChip } from "@/components/outcome-chip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSuite } from "@/context/suite-context";
import { encodeTraceId } from "@/lib/utils";

export default function ExperimentsPage() {
  const { data, loading, error } = useSuite();
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter((v) => v !== "blind");
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");

  const agentA = a || agents[0] || "";
  const agentB = b || agents.find((x) => x !== agentA) || agents[1] || agents[0] || "";

  const sideBySide = useMemo(() => {
    if (!agentA || !agentB) return [];
    return variants.map((variant) => {
      const left = data.runs.filter((r) => r.agent === agentA && r.condition === variant);
      const right = data.runs.filter((r) => r.agent === agentB && r.condition === variant);
      const leftGc = left.filter((r) => r.label === "grounded_correct").length;
      const rightGc = right.filter((r) => r.label === "grounded_correct").length;
      return {
        variant,
        leftN: left.length,
        rightN: right.length,
        leftGc,
        rightGc,
        leftRate: left.length ? leftGc / left.length : null,
        rightRate: right.length ? rightGc / right.length : null,
      };
    });
  }, [data.runs, agentA, agentB, variants]);

  const diffs = useMemo(() => {
    if (!agentA || !agentB) return [];
    const cases = data.cases.map((c) => c.id);
    const out: Array<{
      case_id: string;
      variant: string;
      left?: string;
      right?: string;
      leftTrace?: string;
      rightTrace?: string;
    }> = [];
    for (const caseId of cases) {
      for (const variant of variants) {
        const lr = data.runs.find(
          (r) => r.agent === agentA && r.case_id === caseId && r.condition === variant,
        );
        const rr = data.runs.find(
          (r) => r.agent === agentB && r.case_id === caseId && r.condition === variant,
        );
        if (!lr || !rr) continue;
        if ((lr.label || "") === (rr.label || "")) continue;
        out.push({
          case_id: caseId,
          variant,
          left: lr.label,
          right: rr.label,
          leftTrace: `${agentA}|${caseId}|${variant}`,
          rightTrace: `${agentB}|${caseId}|${variant}`,
        });
      }
    }
    return out;
  }, [data, agentA, agentB, variants]);

  return (
    <>
      <Topbar title="Experiments" />
      <main className="space-y-4 p-4">
        {loading ? <LoadingState /> : null}
        {error ? <EmptyState title="Could not load suite" detail={error} /> : null}

        {!loading && !error ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Compare agents</CardTitle>
                <CardDescription>Side-by-side grounded rates per variant, then outcome diffs</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <div className="w-48">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-ink/45">Agent A</div>
                  <Select value={agentA} onValueChange={setA}>
                    <SelectTrigger aria-label="Agent A">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((x) => (
                        <SelectItem key={x} value={x}>
                          {x}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-48">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-ink/45">Agent B</div>
                  <Select value={agentB} onValueChange={setB}>
                    <SelectTrigger aria-label="Agent B">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((x) => (
                        <SelectItem key={x} value={x}>
                          {x}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Per variant</CardTitle>
              </CardHeader>
              <CardContent className="overflow-auto">
                <table className="sticky-table w-full min-w-[560px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-ink/60">
                      <th className="px-2 py-2">Variant</th>
                      <th className="px-2 py-2">{agentA || "A"} grounded</th>
                      <th className="px-2 py-2">{agentB || "B"} grounded</th>
                      <th className="px-2 py-2">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sideBySide.map((row) => {
                      const delta =
                        row.leftRate != null && row.rightRate != null
                          ? row.rightRate - row.leftRate
                          : null;
                      return (
                        <tr key={row.variant} className="border-t border-border">
                          <td className="px-2 py-1.5 font-medium">{row.variant}</td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {row.leftGc}/{row.leftN}
                            {row.leftRate != null ? ` (${Math.round(row.leftRate * 100)}%)` : ""}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {row.rightGc}/{row.rightN}
                            {row.rightRate != null ? ` (${Math.round(row.rightRate * 100)}%)` : ""}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pp`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outcome disagreements</CardTitle>
                <CardDescription>
                  Cases where {agentA} and {agentB} land in different buckets
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-auto">
                {diffs.length === 0 ? (
                  <EmptyState title="No outcome differences" detail="These agents agree on every compared case × variant." />
                ) : (
                  <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="text-ink/60">
                        <th className="px-2 py-2">Case</th>
                        <th className="px-2 py-2">Variant</th>
                        <th className="px-2 py-2">{agentA}</th>
                        <th className="px-2 py-2">{agentB}</th>
                        <th className="px-2 py-2">Traces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffs.map((d) => (
                        <tr key={`${d.case_id}-${d.variant}`} className="border-t border-border">
                          <td className="px-2 py-1.5 font-medium">{d.case_id}</td>
                          <td className="px-2 py-1.5">{d.variant}</td>
                          <td className="px-2 py-1.5">
                            <OutcomeChip label={d.left} />
                          </td>
                          <td className="px-2 py-1.5">
                            <OutcomeChip label={d.right} />
                          </td>
                          <td className="px-2 py-1.5">
                            <Link
                              className="text-teal hover:underline"
                              href={`/traces/${encodeTraceId(d.leftTrace!)}/`}
                            >
                              A
                            </Link>
                            <span className="text-ink/30"> · </span>
                            <Link
                              className="text-teal hover:underline"
                              href={`/traces/${encodeTraceId(d.rightTrace!)}/`}
                            >
                              B
                            </Link>
                          </td>
                        </tr>
                      ))}
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
