"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { DataTable, type ColumnDef } from "@/components/studio/data-table";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  createEvaluator,
  listEvaluators,
  listProviders,
  putEvaluatorVersion,
  type Evaluator,
  type Provider,
} from "@/lib/api";
import { judgeTrust } from "@/lib/metrics";
import { rubricFor } from "@/lib/rubrics";
import { encodeTraceId, pct } from "@/lib/utils";

type EvalKind = "rule" | "model-judged" | "composite";

type EvalRow = {
  id: string;
  name: string;
  description: string;
  kind: EvalKind;
  dimension: string;
  needsReference: boolean;
  lastScore: number | null;
  version: string;
  category?: string | null;
  source?: string | null;
};

const TEMPLATES = {
  hallucination: {
    name: "Hallucination check",
    dimension: "Hallucination",
    type: "rubric" as const,
    prompt:
      "Decide whether the output invents facts not supported by the input or media.\nInput: {{input}}\nOutput: {{output}}\nExpected: {{expected}}\nReply JSON: {\"score\":0|1,\"label\":\"pass\"|\"fail\",\"explanation\":\"...\"}",
  },
  groundedness: {
    name: "Groundedness check",
    dimension: "Groundedness",
    type: "rubric" as const,
    prompt:
      "Decide whether claims in the output are grounded in the provided evidence.\nInput: {{input}}\nOutput: {{output}}\nTool calls: {{tool_calls}}\nExpected: {{expected}}\nReply JSON: {\"score\":0|1,\"label\":\"pass\"|\"fail\",\"explanation\":\"...\"}",
  },
  custom: {
    name: "Custom rubric",
    dimension: "Custom",
    type: "rubric" as const,
    prompt:
      "Judge the agent against your rubric.\nInput: {{input}}\nOutput: {{output}}\nTool calls: {{tool_calls}}\nExpected: {{expected}}\nReply JSON: {\"score\":0|1,\"label\":\"pass\"|\"fail\",\"explanation\":\"...\"}",
  },
} as const;

function kindFromCategory(category?: string | null, type?: string | null): EvalKind {
  const c = (category || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (c === "composite" || c === "paired") return "composite";
  if (c === "judge" || t === "rubric" || t === "model") return "model-judged";
  if (c === "deterministic" || c === "tool_use" || t === "rule" || t === "builtin") return "rule";
  if (t === "composite") return "composite";
  return "rule";
}

function kindChipClass(kind: EvalKind) {
  if (kind === "model-judged") return "border-teal/30 bg-teal/10 text-teal";
  if (kind === "composite") return "border-amber/30 bg-amber/10 text-amber";
  return "border-border bg-muted text-ink/70";
}

function meanScoreFor(
  evaluatorId: string,
  dimensionSummary: Array<{ evaluator_id?: string; mean_score?: number | null }>,
  results: Array<{ evaluator_id: string; score?: number | null; status?: string }>,
): number | null {
  const fromSummary = dimensionSummary.filter((r) => r.evaluator_id === evaluatorId);
  const summaryVals = fromSummary
    .map((r) => r.mean_score)
    .filter((n): n is number => n != null && !Number.isNaN(n));
  if (summaryVals.length) {
    return summaryVals.reduce((a, b) => a + b, 0) / summaryVals.length;
  }
  const scored = results.filter(
    (r) => r.evaluator_id === evaluatorId && r.score != null && r.status !== "skipped",
  );
  if (!scored.length) return null;
  return scored.reduce((a, r) => a + (r.score || 0), 0) / scored.length;
}

function toRow(
  e: Evaluator,
  dimensionSummary: Array<{ evaluator_id?: string; mean_score?: number | null }>,
  results: Array<{ evaluator_id: string; score?: number | null; status?: string }>,
): EvalRow {
  const rubric = rubricFor(e.id);
  return {
    id: e.id,
    name: e.name || e.id.replace(/_/g, " "),
    description: (e.description || rubric.checks).split("\n")[0],
    kind: kindFromCategory(e.category, e.type),
    dimension: e.dimension || "Other",
    needsReference: Boolean(e.needs_reference),
    lastScore: meanScoreFor(e.id, dimensionSummary, results),
    version: e.version || "—",
    category: e.category,
    source: e.source,
  };
}

export default function EvaluatorsPage() {
  const { mode } = useApiMode();
  const { data, loading: suiteLoading, error: suiteError } = useSuite();
  const [tab, setTab] = useState("evaluators");
  const [evals, setEvals] = useState<Evaluator[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [template, setTemplate] = useState<keyof typeof TEMPLATES | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const readTab = () => {
      try {
        const params =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search)
            : null;
        if (params?.get("tab") === "judge") setTab("judge");
      } catch {
        /* ignore */
      }
    };
    readTab();
  }, []);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode !== "live") {
        setEvals(
          (data.registry || []).map((r) => ({
            ...r,
            name: r.id.replace(/_/g, " "),
            source: "builtin",
            type: "builtin",
          })),
        );
        setProviders([]);
        return;
      }
      const [e, p] = await Promise.all([listEvaluators(), listProviders()]);
      setEvals(e);
      setProviders(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load evaluators");
      setEvals(
        (data.registry || []).map((r) => ({
          ...r,
          name: r.id.replace(/_/g, " "),
          source: "builtin",
          type: "builtin",
        })),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data.registry]);

  const rows = useMemo(
    () =>
      evals.map((e) => toRow(e, data.dimension_summary || [], data.results || [])),
    [evals, data.dimension_summary, data.results],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      `${r.name} ${r.id} ${r.dimension} ${r.description}`.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const byDimension = useMemo(() => {
    const map = new Map<string, EvalRow[]>();
    for (const r of filtered) {
      const key = r.dimension || "Other";
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const trust = useMemo(() => judgeTrust(data.judged || []), [data.judged]);
  const planted = useMemo(() => {
    const rowsJ = data.judged || [];
    const right = rowsJ.filter((j) => j.kind === "planted_right");
    const wrong = rowsJ.filter((j) => j.kind === "planted_wrong");
    return {
      rightN: right.length,
      wrongN: wrong.length,
      rightOk: right.filter((j) => j.judge_accepts === true).length,
      wrongOk: wrong.filter((j) => j.judge_accepts === false).length,
    };
  }, [data.judged]);

  const models = useMemo(
    () => providers.flatMap((p) => (p.models || []).map((m) => m.id)),
    [providers],
  );

  const openBuilder = (key: keyof typeof TEMPLATES | null = null) => {
    setTemplate(key);
    setBuilderOpen(true);
  };

  const columns: ColumnDef<EvalRow>[] = [
    {
      id: "name",
      header: "Name",
      cell: (r) => <span className="font-medium capitalize">{r.name}</span>,
    },
    {
      id: "description",
      header: "Description",
      cell: (r) => <span className="text-ink/70">{r.description}</span>,
      className: "max-w-md",
    },
    {
      id: "type",
      header: "Type",
      cell: (r) => <Badge className={kindChipClass(r.kind)}>{r.kind}</Badge>,
    },
    {
      id: "ref",
      header: "Needs reference",
      cell: (r) => (r.needsReference ? "Yes" : "No"),
    },
    {
      id: "score",
      header: "Last-run score",
      cell: (r) => (
        <span className="tabular-nums">
          {r.lastScore != null ? r.lastScore.toFixed(2) : "—"}
        </span>
      ),
    },
    {
      id: "version",
      header: "Version",
      cell: (r) => r.version,
    },
  ];

  const busy = loading || (mode !== "live" && suiteLoading);

  return (
    <>
      <Topbar title="Evaluators" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Evaluators"
          description="Checks that score answers, evidence, and judge reliability."
          action={
            <Button type="button" size="sm" onClick={() => openBuilder(null)}>
              New evaluator
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink/45">Templates</span>
            <Button type="button" size="sm" variant="outline" onClick={() => openBuilder("hallucination")}>
              Hallucination
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openBuilder("groundedness")}>
              Groundedness
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openBuilder("custom")}>
              Custom rubric
            </Button>
          </div>
        </PageHeader>

        {msg ? <p className="text-xs text-ink/55">{msg}</p> : null}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="evaluators">Evaluators</TabsTrigger>
            <TabsTrigger value="judge">Judge trust</TabsTrigger>
          </TabsList>

          <TabsContent value="evaluators" className="space-y-3">
            <FilterBar>
              <Input
                className="h-8 max-w-xs"
                placeholder="Filter evaluators"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
                Refresh
              </Button>
            </FilterBar>
            {busy ? <SkeletonBlock /> : null}
            {error || suiteError ? (
              <ErrorState detail={error || suiteError || undefined} onRetry={() => void reload()} />
            ) : null}
            {!busy && !filtered.length ? (
              <EmptyState
                title="No evaluators yet"
                detail="Create an evaluator or start from a template above."
                action={
                  <Button type="button" size="sm" onClick={() => openBuilder("custom")}>
                    New evaluator
                  </Button>
                }
              />
            ) : null}
            {!busy
              ? byDimension.map(([dimension, dimRows]) => {
                  const closed = collapsed[dimension];
                  return (
                    <div key={dimension} className="space-y-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left text-sm font-medium text-ink"
                        onClick={() =>
                          setCollapsed((prev) => ({ ...prev, [dimension]: !prev[dimension] }))
                        }
                      >
                        {closed ? (
                          <ChevronRight className="h-4 w-4 text-ink/45" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-ink/45" />
                        )}
                        <span>{dimension}</span>
                        <span className="text-xs font-normal text-ink/45">{dimRows.length}</span>
                      </button>
                      {!closed ? (
                        <DataTable
                          columns={columns}
                          rows={dimRows}
                          rowKey={(r) => `${r.id}-${r.version}`}
                          empty={<EmptyState title="No evaluators in this dimension" />}
                        />
                      ) : null}
                    </div>
                  );
                })
              : null}
          </TabsContent>

          <TabsContent value="judge" className="space-y-3">
            {suiteLoading ? <SkeletonBlock rows={3} /> : null}
            {suiteError ? <ErrorState detail={suiteError} /> : null}
            {!suiteLoading ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Audit stats</CardTitle>
                      <CardDescription>Agent-answer judgments vs ground truth</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {trust.n === 0 ? (
                        <EmptyState
                          title="No judged agent answers"
                          detail="Run a suite with judge controls to compare the judge against known answers."
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <Stat label="Compared" value={`${trust.n}`} />
                          <Stat
                            label="False accept"
                            value={`${trust.falseAccept} (${pct(trust.falseAcceptRate, 0)})`}
                          />
                          <Stat
                            label="False reject"
                            value={`${trust.falseReject} (${pct(trust.falseRejectRate, 0)})`}
                          />
                          <Stat label="True accept" value={`${trust.trueAccept}`} />
                          <Stat label="True reject" value={`${trust.trueReject}`} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Planted probes</CardTitle>
                      <CardDescription>
                        Known-right and known-wrong answers shown to the judge
                      </CardDescription>
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
                    <CardTitle className="text-sm">Disagreements</CardTitle>
                    <CardDescription>Where the judge and truth disagree</CardDescription>
                  </CardHeader>
                  <CardContent className="overflow-auto p-0">
                    {(data.disagreements || []).length === 0 ? (
                      <div className="p-4">
                        <EmptyState
                          title="No disagreements"
                          detail="The judge and truth agree on compared agent answers."
                        />
                      </div>
                    ) : (
                      <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="text-ink/55">
                            <th className="px-3 py-2">Kind</th>
                            <th className="px-3 py-2">Agent</th>
                            <th className="px-3 py-2">Case</th>
                            <th className="px-3 py-2">Variant</th>
                            <th className="px-3 py-2">Judge</th>
                            <th className="px-3 py-2">Truth</th>
                            <th className="px-3 py-2">Proposed</th>
                            <th className="px-3 py-2">Trace</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.disagreements.map((d, i) => {
                            const variant = d.variant || "clean";
                            const traceId =
                              d.agent && d.case_id ? `${d.agent}|${d.case_id}|${variant}` : null;
                            return (
                              <tr key={`${d.case_id}-${d.agent}-${i}`} className="border-t border-border">
                                <td className="px-3 py-2">{d.kind || "—"}</td>
                                <td className="px-3 py-2">{d.agent || "—"}</td>
                                <td className="px-3 py-2 font-medium">{d.case_id || "—"}</td>
                                <td className="px-3 py-2">{variant}</td>
                                <td className="px-3 py-2">
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
                                <td className="px-3 py-2">
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
                                <td className="px-3 py-2">{String(d.proposed ?? "—")}</td>
                                <td className="px-3 py-2">
                                  {traceId ? (
                                    <Link
                                      href={`/traces/view/?id=${encodeURIComponent(encodeTraceId(traceId))}`}
                                      className="text-teal hover:underline"
                                    >
                                      Open
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
          </TabsContent>
        </Tabs>
      </main>

      <Sheet open={builderOpen} onOpenChange={(o) => !o && setBuilderOpen(false)}>
        <SheetContent className="w-full max-w-lg sm:max-w-xl" title="New evaluator">
          <Builder
            mode={mode}
            models={models}
            template={template}
            existingIds={evals.map((e) => e.id)}
            onClose={() => setBuilderOpen(false)}
            onSaved={(m) => {
              setMsg(m);
              setBuilderOpen(false);
              void reload();
            }}
          />
        </SheetContent>
      </Sheet>
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

function Builder({
  mode,
  models,
  template,
  existingIds,
  onClose,
  onSaved,
}: {
  mode: string;
  models: string[];
  template: keyof typeof TEMPLATES | null;
  existingIds: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const seed = template ? TEMPLATES[template] : TEMPLATES.custom;
  const [name, setName] = useState<string>(seed.name);
  const [dimension, setDimension] = useState<string>(seed.dimension);
  const [type, setType] = useState<"rubric" | "rule">(seed.type);
  const [prompt, setPrompt] = useState<string>(seed.prompt);
  const [attachMedia, setAttachMedia] = useState(true);
  const [judgeModel, setJudgeModel] = useState(models[0] || "");
  const [scale, setScale] = useState("pass_fail");
  const [threshold, setThreshold] = useState("1");
  const [rules, setRules] = useState<Array<{ field: string; op: string; value: string }>>([
    { field: "output.answer", op: "equals", value: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const next = template ? TEMPLATES[template] : TEMPLATES.custom;
    setName(next.name);
    setDimension(next.dimension);
    setType(next.type);
    setPrompt(next.prompt);
  }, [template]);

  useEffect(() => {
    if (!judgeModel && models[0]) setJudgeModel(models[0]);
  }, [models, judgeModel]);

  const canSaveLive = mode === "live";

  return (
    <div className="space-y-3 text-xs">
      {!canSaveLive ? (
        <p className="rounded border border-amber/30 bg-amber/10 px-3 py-2 text-ink/80">
          Sign in to save
        </p>
      ) : null}
      {err ? <ErrorState detail={err} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          Name
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          Dimension
          <Input className="mt-1" value={dimension} onChange={(e) => setDimension(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          Type
          <select
            className="mt-1 h-8 w-full rounded border border-border px-2"
            value={type}
            onChange={(e) => setType(e.target.value as "rubric" | "rule")}
          >
            <option value="rubric">Model-judged rubric</option>
            <option value="rule">Rule</option>
          </select>
        </label>
      </div>

      {type === "rubric" ? (
        <div className="space-y-2">
          <label className="block">
            Rubric prompt
            <textarea
              className="mt-1 h-40 w-full rounded border border-border p-2 text-[11px] leading-relaxed"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={attachMedia}
              onChange={(e) => setAttachMedia(e.target.checked)}
            />
            Attach media when judging
          </label>
          {models.length ? (
            <label className="block">
              Judge model
              <select
                className="mt-1 h-8 w-full rounded border border-border px-2"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label>
              Scale
              <select
                className="mt-1 h-8 w-full rounded border border-border px-2"
                value={scale}
                onChange={(e) => setScale(e.target.value)}
              >
                <option value="pass_fail">Pass / fail</option>
                <option value="0-1">0–1</option>
                <option value="labels">Labels</option>
              </select>
            </label>
            <label>
              Pass threshold
              <Input className="mt-1" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((row, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <Input
                placeholder="Field path"
                value={row.field}
                onChange={(e) =>
                  setRules((rs) => rs.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)))
                }
              />
              <select
                className="h-8 rounded border border-border px-2"
                value={row.op}
                onChange={(e) =>
                  setRules((rs) => rs.map((r, j) => (j === i ? { ...r, op: e.target.value } : r)))
                }
              >
                {["equals", "contains", "regex", "number_within", "json_schema", "field_present", "max_latency_ms"].map(
                  (op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ),
                )}
              </select>
              <Input
                placeholder="Value"
                value={row.value}
                onChange={(e) =>
                  setRules((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                }
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => setRules((r) => [...r, { field: "", op: "equals", value: "" }])}
          >
            Add rule
          </Button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!name.trim() || busy || !canSaveLive}
          onClick={async () => {
            if (!canSaveLive) {
              onSaved("Sign in to save");
              return;
            }
            setBusy(true);
            setErr(null);
            try {
              const body = {
                type,
                name: name.trim(),
                dimension,
                description: type === "rubric" ? prompt.slice(0, 160) : undefined,
                ...(type === "rubric"
                  ? {
                      prompt,
                      attach_media: attachMedia,
                      judge_model: judgeModel || undefined,
                      scale,
                      pass_threshold: Number(threshold),
                    }
                  : {
                      rules: rules.map((r) => ({
                        field: r.field,
                        operator: r.op,
                        value: r.value,
                      })),
                      checks: rules.map((r) => ({
                        field: r.field,
                        operator: r.op,
                        value: r.value,
                      })),
                    }),
              };
              const id = name.trim().replace(/\s+/g, "_").toLowerCase();
              if (existingIds.includes(id)) {
                await putEvaluatorVersion(id, body);
                onSaved(`Updated ${name.trim()}`);
              } else {
                await createEvaluator(body);
                onSaved(`Created ${name.trim()}`);
              }
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Could not save evaluator");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
