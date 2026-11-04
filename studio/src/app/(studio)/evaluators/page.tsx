"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { VerdictChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import {
  createEvaluator,
  listEvaluators,
  listProviders,
  listTraces,
  putEvaluatorVersion,
  testEvaluator,
  type Evaluator,
  type Provider,
  type TraceListItem,
} from "@/lib/api";
import { rubricFor, workedExample } from "@/lib/rubrics";
import { pct } from "@/lib/utils";

const OPS = [
  "equals",
  "contains",
  "regex",
  "number_within",
  "json_schema",
  "field_present",
  "max_latency_ms",
] as const;

const CHIPS = ["{{input}}", "{{output}}", "{{tool_calls}}", "{{expected}}"] as const;

export default function EvaluatorsPage() {
  const { mode } = useApiMode();
  const { data } = useSuite();
  const [evals, setEvals] = useState<Evaluator[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => {
    if (mode !== "live") {
      setEvals((data.registry || []).map((r) => ({ ...r, source: "builtin", type: "builtin" })));
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([listEvaluators(), listProviders(), listTraces({ limit: 50 })])
      .then(([e, p, t]) => {
        setEvals(e);
        setProviders(p);
        setTraces(t);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data.registry]);

  const builtins = evals.filter((e) => e.source === "builtin" || e.type === "builtin");
  const custom = evals.filter((e) => e.source !== "builtin" && e.type !== "builtin");
  const models = useMemo(
    () => providers.flatMap((p) => (p.models || []).map((m) => m.id)),
    [providers],
  );

  return (
    <>
      <Topbar title="Evaluators" />
      <main className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink/55">Built-in registry and custom rubric/rule evaluators.</p>
          <Button size="sm" onClick={() => setBuilderOpen(true)} disabled={mode !== "live"}>
            New evaluator
          </Button>
        </div>
        {msg ? <div className="rounded border border-teal/30 bg-teal/5 px-3 py-2 text-xs text-teal">{msg}</div> : null}
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Registry</CardTitle>
            <CardDescription>
              {builtins.length} built-in · {custom.length} custom
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-ink/60">
                  <th className="px-2 py-2">ID</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Category</th>
                  <th className="px-2 py-2">Dimension</th>
                  <th className="px-2 py-2">Needs ref</th>
                  <th className="px-2 py-2">Scope</th>
                  <th className="px-2 py-2">Version</th>
                </tr>
              </thead>
              <tbody>
                {evals.map((r) => (
                  <tr key={`${r.id}-${r.version}-${r.source}`} className="border-t border-border">
                    <td className="px-2 py-1.5 font-medium">{r.id}</td>
                    <td className="px-2 py-1.5">
                      <Badge className="border-border bg-muted">{r.source || "—"}</Badge>
                    </td>
                    <td className="px-2 py-1.5">{r.type || "—"}</td>
                    <td className="px-2 py-1.5">{r.category || "—"}</td>
                    <td className="px-2 py-1.5">{r.dimension || "—"}</td>
                    <td className="px-2 py-1.5">{r.needs_reference ? "yes" : "no"}</td>
                    <td className="px-2 py-1.5">{r.scope || "—"}</td>
                    <td className="px-2 py-1.5">{r.version || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid gap-3 lg:grid-cols-2">
          {evals.map((entry) => {
            const rubric = rubricFor(entry.id);
            const example = mode === "snapshot" ? workedExample(data, entry.id) : null;
            return (
              <Card key={`${entry.id}-${entry.version}-card`}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    Rubric · {entry.id}
                    <Badge className="border-border bg-muted">{entry.dimension}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {entry.type} · v{entry.version} · {entry.source}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-ink/80">
                  <p>
                    <span className="font-semibold text-ink">Checks: </span>
                    {entry.description || rubric.checks}
                  </p>
                  {entry.config?.prompt ? (
                    <pre className="mono max-h-24 overflow-auto rounded bg-paper p-2 text-[10px]">
                      {String(entry.config.prompt)}
                    </pre>
                  ) : (
                    <p>
                      <span className="font-semibold text-ink">Scores: </span>
                      {rubric.scores}
                    </p>
                  )}
                  <p>
                    <span className="font-semibold text-ink">Pass threshold: </span>
                    {entry.config?.pass_threshold != null
                      ? String(entry.config.pass_threshold)
                      : rubric.threshold}
                  </p>
                  {example ? (
                    <div className="rounded border border-border bg-paper/70 p-2">
                      <div className="text-[11px] font-semibold uppercase text-ink/45">Worked example</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <VerdictChip verdict={example.verdict} />
                        <span>score {pct(example.score, 0)}</span>
                      </div>
                      <p className="text-ink/70">{example.explanation}</p>
                    </div>
                  ) : null}
                  {mode === "live" && entry.source !== "builtin" ? (
                    <TestPanel
                      evaluatorId={entry.id}
                      traces={traces}
                      onMsg={setMsg}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {builderOpen ? (
          <Builder
            models={models}
            traces={traces}
            existingIds={evals.map((e) => e.id)}
            onClose={() => setBuilderOpen(false)}
            onSaved={(m) => {
              setMsg(m);
              setBuilderOpen(false);
              reload();
            }}
          />
        ) : null}
      </main>
    </>
  );
}

function TestPanel({
  evaluatorId,
  traces,
  onMsg,
}: {
  evaluatorId: string;
  traces: TraceListItem[];
  onMsg: (m: string) => void;
}) {
  const [traceId, setTraceId] = useState(traces[0]?.id || "");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!traceId && traces[0]) setTraceId(traces[0].id);
  }, [traces, traceId]);

  return (
    <div className="rounded border border-border p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase text-ink/45">Test on a trace</div>
      <div className="flex flex-wrap gap-2">
        <select
          className="h-8 min-w-[200px] flex-1 rounded border border-border px-2 text-xs"
          value={traceId}
          onChange={(e) => setTraceId(e.target.value)}
        >
          {traces.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || t.id}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!traceId || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await testEvaluator(evaluatorId, traceId);
              setResult(JSON.stringify(r, null, 2));
              onMsg(`Test only — not stored. verdict=${r.verdict}`);
            } catch (e) {
              setResult(e instanceof Error ? e.message : "test failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Testing…" : "Test"}
        </Button>
      </div>
      {result ? <pre className="mono mt-2 max-h-40 overflow-auto text-[10px]">{result}</pre> : null}
    </div>
  );
}

function Builder({
  models,
  traces,
  existingIds,
  onClose,
  onSaved,
}: {
  models: string[];
  traces: TraceListItem[];
  existingIds: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [dimension, setDimension] = useState("Groundedness");
  const [type, setType] = useState<"rubric" | "rule">("rubric");
  const [prompt, setPrompt] = useState(
    "Judge the agent.\nInput: {{input}}\nOutput: {{output}}\nTool calls: {{tool_calls}}\nExpected: {{expected}}\nReply JSON: {\"score\":0|1,\"label\":\"pass\"|\"fail\",\"explanation\":\"...\"}",
  );
  const [attachMedia, setAttachMedia] = useState(true);
  const [judgeModel, setJudgeModel] = useState(models[0] || "muse-spark-1.3");
  const [scale, setScale] = useState("pass_fail");
  const [threshold, setThreshold] = useState("1");
  const [rules, setRules] = useState<Array<{ field: string; op: string; value: string }>>([
    { field: "output.answer", op: "equals", value: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const insertChip = (chip: string) => setPrompt((p) => p + chip);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">New evaluator</h3>
          <button type="button" onClick={onClose} className="text-ink/50">
            ✕
          </button>
        </div>
        {err ? <ErrorBlock title="Error" detail={err} /> : null}
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <label>
            Name
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Dimension
            <Input className="mt-1" value={dimension} onChange={(e) => setDimension(e.target.value)} />
          </label>
          <label>
            Type
            <select
              className="mt-1 h-8 w-full rounded border border-border px-2"
              value={type}
              onChange={(e) => setType(e.target.value as "rubric" | "rule")}
            >
              <option value="rubric">rubric</option>
              <option value="rule">rule</option>
            </select>
          </label>
        </div>

        {type === "rubric" ? (
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex flex-wrap gap-1">
              {CHIPS.map((c) => (
                <Button key={c} size="sm" variant="outline" type="button" onClick={() => insertChip(c)}>
                  {c}
                </Button>
              ))}
            </div>
            <textarea
              className="mono h-40 w-full rounded border border-border p-2 text-[11px]"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={attachMedia} onChange={(e) => setAttachMedia(e.target.checked)} />
              Attach media to judge
            </label>
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
            <div className="grid grid-cols-2 gap-2">
              <label>
                Scale
                <select
                  className="mt-1 h-8 w-full rounded border border-border px-2"
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                >
                  <option value="pass_fail">pass_fail</option>
                  <option value="0-1">0-1</option>
                  <option value="labels">labels</option>
                </select>
              </label>
              <label>
                Pass threshold
                <Input className="mt-1" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              </label>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-xs">
            {rules.map((row, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <Input
                  placeholder="field path"
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
                  {OPS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder="value"
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
              Add row
            </Button>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name || busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const body = {
                  type,
                  name,
                  dimension,
                  ...(type === "rubric"
                    ? {
                        prompt,
                        attach_media: attachMedia,
                        judge_model: judgeModel,
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
                const id = name.replace(/\s+/g, "_").toLowerCase();
                if (existingIds.includes(id)) {
                  await putEvaluatorVersion(id, body);
                  onSaved(`Created new version of ${id}`);
                } else {
                  await createEvaluator(body);
                  onSaved(`Created evaluator ${id}`);
                }
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
        {traces.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink/45">No traces loaded for test — save first, then test from the card.</p>
        ) : null}
      </div>
    </div>
  );
}
