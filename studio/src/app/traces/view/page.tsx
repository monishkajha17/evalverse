"use client";

import Link from "next/link";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { OutcomeChip, VerdictChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudioEvidencePanel, ImageEvidenceOverlay } from "@/components/trace/media-panel";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { findCase, findRun, findTrace, loadSuite, resultsForTrace } from "@/lib/data";
import {
  createEvaluation,
  createReview,
  getTrace,
  listDatasets,
  listEvaluators,
  pollEvaluation,
  promoteTrace,
  rememberEvalRun,
  type Dataset,
  type EvalResult,
  type Evaluator,
  type TraceDetail,
} from "@/lib/api";
import {
  buildMediaLineage,
  extractBoxes,
  fmtMs,
  modelPromptOutput,
  parseToolArgs,
  resolveMediaSrc,
  sourceChipClass,
  stageLabel,
  statusChipClass,
  toolResultsForSpan,
  toolSpans,
} from "@/lib/trace-helpers";
import { pct } from "@/lib/utils";
import type { CaseRow, RunRow, SuiteData } from "@/lib/types";

function TraceViewInner() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const suiteParam = params.get("suite");
  const { mode } = useApiMode();
  const suiteCtx = useSuite();

  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [snap, setSnap] = useState<{
    data: SuiteData;
    run?: RunRow;
    caseRow?: CaseRow;
    results: EvalResult[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "live") {
        const t = await getTrace(id);
        setTrace(t);
        setSnap(null);
      } else {
        const suite = suiteParam || suiteCtx.suite || "default";
        const data = suite === suiteCtx.suite ? suiteCtx.data : await loadSuite(suite);
        const t = findTrace(data, id);
        if (!t) throw new Error(`Trace ${id} not in suite ${suite}`);
        const run = findRun(data, t.agent, t.case_id, t.variant);
        const caseRow = findCase(data, t.case_id);
        const results = resultsForTrace(data, t) as unknown as EvalResult[];
        setSnap({ data, run, caseRow, results });
        setTrace({
          id: t.id,
          agent: t.agent,
          name: t.id,
          status: "completed",
          source: "import",
          tags: [t.variant],
          spans: (t.spans || []).map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            parent_ids: s.parent_span_ids,
            latency_ms: s.latency_s != null ? s.latency_s * 1000 : null,
            usage: s.usage,
            input: s.input,
            output: s.output,
            error: s.error,
          })),
          media: (t.assets || []).map((a, i) => ({
            id: a.id || `asset-${i}`,
            url: a.path || undefined,
            modality: a.modality,
            transformation: a.transformation,
            mime: a.modality === "audio" ? "audio/wav" : "image/jpeg",
          })),
          results,
          output: run ? { answer: run.answer, box: run.box, span_ms: run.span_ms } : undefined,
          metadata: { case_id: t.case_id, variant: t.variant },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trace");
      setTrace(null);
    } finally {
      setLoading(false);
    }
  }, [id, mode, suiteParam, suiteCtx.suite, suiteCtx.data]);

  useEffect(() => {
    reload();
  }, [reload]);

  const boxes = useMemo(() => extractBoxes(trace?.results || []), [trace]);
  const stage = useMemo(() => stageLabel(trace?.results || []), [trace]);
  const lineages = useMemo(() => buildMediaLineage(trace?.media || []), [trace]);
  const tools = useMemo(() => toolSpans(trace?.spans || []), [trace]);
  const promptOut = useMemo(() => (trace ? modelPromptOutput(trace) : { prompt: "—", output: "—" }), [trace]);

  const isAudio =
    snap?.caseRow?.modality === "audio" ||
    (trace?.media || []).some((m) => (m.modality || "").includes("audio") || (m.mime || "").startsWith("audio/"));

  const imageSrc =
    resolveMediaSrc((trace?.media || []).find((m) => (m.modality || "image").includes("image") || (m.mime || "").startsWith("image/"))) ||
    snap?.caseRow?.image ||
    "";

  return (
    <>
      <Topbar title="Trace" />
      <main className="space-y-3 p-4">
        <div className="text-xs text-ink/50">
          <Link href="/traces/" className="text-teal hover:underline">
            ← Traces
          </Link>
        </div>
        {!id ? <EmptyBlock title="Missing trace id" /> : null}
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Could not load trace" detail={error} /> : null}
        {actionMsg ? (
          <div className="rounded border border-teal/30 bg-teal/5 px-3 py-2 text-xs text-teal">{actionMsg}</div>
        ) : null}

        {trace && !loading ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-sm font-semibold">{trace.id}</h2>
              <Badge className="border-border bg-white">{trace.agent || "—"}</Badge>
              <Badge className={sourceChipClass(trace.source)}>{trace.source || "unknown"}</Badge>
              <Badge className={statusChipClass(trace.status)}>{trace.status || "unknown"}</Badge>
              {stage ? <OutcomeChip label={stage} /> : null}
              {(trace.tags || []).slice(0, 4).map((t) => (
                <Badge key={t} className="border-border bg-muted text-ink/60">
                  {t}
                </Badge>
              ))}
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setEvalOpen(true)} disabled={mode !== "live"}>
                  Evaluate
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPromoteOpen(true)} disabled={mode !== "live"}>
                  Add to dataset
                </Button>
                <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)} disabled={mode !== "live"}>
                  Review
                </Button>
              </div>
            </div>

            <Card>
              <CardHeader className="py-2">
                <CardTitle className="text-xs uppercase tracking-wide text-ink/50">Media lineage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {(trace.media || []).length === 0 ? (
                  <p className="text-xs text-ink/50">No media attached to this trace.</p>
                ) : (
                  (lineages.length ? lineages : [(trace.media || [])]).map((chain, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                      {chain.map((m, j) => (
                        <div key={m.id} className="flex items-center gap-2">
                          {j > 0 ? <span className="text-ink/30">→</span> : null}
                          <div className="rounded border border-border bg-paper px-2 py-1">
                            <div className="font-medium text-ink">
                              {j === 0 ? "original" : m.transformation || "transform"}
                              {j === chain.length - 1 ? " · model saw" : ""}
                            </div>
                            <div className="flex flex-wrap gap-1 text-[10px] text-ink/55">
                              <Badge className="border-border bg-white font-mono text-[10px]">
                                sha {(m.sha256 || m.id).slice(0, 12)}
                              </Badge>
                              <span>{m.mime || m.modality || "—"}</span>
                              <span>{m.size != null ? `${m.size} B` : ""}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-left text-xs hover:bg-muted/40"
              onClick={() => setHelpOpen((v) => !v)}
            >
              {helpOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              How this trace differs from a text trace
            </button>
            {helpOpen ? (
              <ul className="list-disc space-y-1 rounded-lg border border-border bg-white px-6 py-3 text-xs text-ink/75">
                <li>Media lineage — original asset, transforms, and what the model actually saw</li>
                <li>Cited evidence as an object — boxes/spans, not just free text</li>
                <li>Temporal timeline — audio turns and true vs cited spans</li>
                <li>Tool-call verdicts — did the tool act while unsure?</li>
                <li>Stage label — grounded_correct / misread / mislocated / …</li>
              </ul>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Span DAG</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {(trace.spans || []).length === 0 ? (
                    <p className="text-xs text-ink/50">No spans.</p>
                  ) : (
                    (trace.spans || []).map((span) => {
                      const depth = span.parent_ids?.length || 0;
                      return (
                        <div
                          key={span.id}
                          className="rounded border border-border bg-paper/60 px-2 py-1.5"
                          style={{ marginLeft: depth * 12 }}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className="border-border bg-white text-[10px] uppercase">
                              {span.type || "span"}
                            </Badge>
                            <span className="text-xs font-medium">{span.name}</span>
                            {span.error ? (
                              <Badge className="border-crimson/30 bg-crimson/10 text-crimson">error</Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-ink/55">
                            <span>{fmtMs(span.latency_ms)}</span>
                            <span>
                              tokens{" "}
                              {span.usage
                                ? (span.usage.input_tokens || 0) + (span.usage.output_tokens || 0)
                                : "—"}
                            </span>
                            <span>parents {(span.parent_ids || []).join(", ") || "—"}</span>
                          </div>
                          {span.error ? <div className="mt-1 text-[11px] text-crimson">{span.error}</div> : null}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-3">
                  <Tabs defaultValue="evidence">
                    <TabsList>
                      <TabsTrigger value="evidence">Evidence</TabsTrigger>
                      <TabsTrigger value="tools">Tool calls</TabsTrigger>
                      <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
                      <TabsTrigger value="prompt">Prompt &amp; output</TabsTrigger>
                      <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                    </TabsList>

                    <TabsContent value="evidence">
                      {isAudio ? (
                        <AudioEvidencePanel
                          caseRow={
                            snap?.caseRow || {
                              id: trace.id,
                              modality: "audio",
                              audio: resolveMediaSrc((trace.media || [])[0]),
                              truth_span: undefined,
                              turns: [],
                            }
                          }
                          run={
                            snap?.run ||
                            ({
                              span_ms:
                                trace.output &&
                                typeof trace.output === "object" &&
                                "span_ms" in (trace.output as object)
                                  ? (trace.output as { span_ms?: [number, number] }).span_ms
                                  : undefined,
                              asr_turns: undefined,
                            } as RunRow)
                          }
                        />
                      ) : (
                        <ImageEvidenceOverlay
                          caseRow={{
                            id: trace.id,
                            image: imageSrc,
                            truth_box: boxes.expected || snap?.caseRow?.truth_box || null,
                          }}
                          run={{
                            agent: trace.agent || "",
                            case_id: "",
                            condition: "",
                            box: boxes.claimed || snap?.run?.box || null,
                          }}
                          trace={{
                            id: trace.id,
                            agent: trace.agent || "",
                            case_id: "",
                            variant: "",
                            assets: (trace.media || []).map((m) => ({
                              path: resolveMediaSrc(m),
                              modality: m.modality || "image",
                            })),
                          }}
                        />
                      )}
                    </TabsContent>

                    <TabsContent value="tools">
                      {tools.length === 0 ? (
                        <EmptyBlock title="No tool spans" />
                      ) : (
                        <div className="space-y-2">
                          {tools.map((span) => {
                            const parsed = parseToolArgs(span);
                            const related = toolResultsForSpan(trace.results || [], span);
                            const unsure = related.some(
                              (r) => (r.label || "").toLowerCase() === "acted_while_unsure",
                            );
                            return (
                              <div
                                key={span.id}
                                className={`rounded border p-3 ${
                                  unsure ? "border-crimson bg-crimson/5" : "border-border bg-white"
                                }`}
                              >
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                  {parsed.name}
                                  {unsure ? (
                                    <Badge className="border-crimson/40 bg-crimson/10 text-crimson">
                                      acted_while_unsure
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                  <pre className="mono max-h-40 overflow-auto rounded bg-paper p-2 text-[11px]">
                                    {JSON.stringify(parsed.args, null, 2)}
                                  </pre>
                                  <pre className="mono max-h-40 overflow-auto rounded bg-paper p-2 text-[11px]">
                                    {JSON.stringify(parsed.result, null, 2)}
                                  </pre>
                                </div>
                                <div className="mt-2 space-y-1">
                                  {related.length === 0 ? (
                                    <p className="text-[11px] text-ink/45">No tool_* evaluator results linked.</p>
                                  ) : (
                                    related.map((r) => {
                                      const pass = (r.verdict || "").toLowerCase() === "pass";
                                      return (
                                        <div key={r.id} className="flex items-start gap-2 text-xs">
                                          {pass ? (
                                            <Check className="mt-0.5 h-3.5 w-3.5 text-teal" />
                                          ) : (
                                            <X className="mt-0.5 h-3.5 w-3.5 text-crimson" />
                                          )}
                                          <div>
                                            <span className="font-medium">{r.evaluator_id}</span>{" "}
                                            <VerdictChip verdict={r.verdict} />{" "}
                                            <span className="text-ink/60">{r.explanation || r.label}</span>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="evaluations">
                      <EvaluationsTable results={trace.results || []} />
                    </TabsContent>

                    <TabsContent value="prompt">
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase text-ink/45">Prompt</div>
                          <pre className="mono max-h-[420px] overflow-auto rounded border border-border bg-paper p-2 text-[11px]">
                            {promptOut.prompt}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase text-ink/45">Output</div>
                          <pre className="mono max-h-[420px] overflow-auto rounded border border-border bg-paper p-2 text-[11px]">
                            {promptOut.output}
                          </pre>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="raw">
                      <pre className="mono max-h-[560px] overflow-auto rounded border border-border bg-paper p-2 text-[11px]">
                        {JSON.stringify(trace, null, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </div>

            {evalOpen ? (
              <EvaluateModal
                traceId={trace.id}
                onClose={() => setEvalOpen(false)}
                onDone={(msg) => {
                  setActionMsg(msg);
                  setEvalOpen(false);
                  reload();
                }}
              />
            ) : null}
            {promoteOpen ? (
              <PromoteModal
                traceId={trace.id}
                onClose={() => setPromoteOpen(false)}
                onDone={(msg) => {
                  setActionMsg(msg);
                  setPromoteOpen(false);
                }}
              />
            ) : null}
            {reviewOpen ? (
              <ReviewModal
                results={trace.results || []}
                onClose={() => setReviewOpen(false)}
                onDone={(msg) => {
                  setActionMsg(msg);
                  setReviewOpen(false);
                }}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}

function EvaluationsTable({ results }: { results: EvalResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!results.length) return <EmptyBlock title="No evaluation results" />;
  return (
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
          {results.map((r) => (
            <Fragment key={r.id}>
              <tr
                className="cursor-pointer border-t border-border hover:bg-muted/50"
                onClick={() => setOpen((c) => (c === r.id ? null : r.id))}
              >
                <td className="px-2 py-1.5 font-medium">{r.evaluator_id}</td>
                <td className="px-2 py-1.5">{r.dimension || "—"}</td>
                <td className="px-2 py-1.5">{r.status}</td>
                <td className="px-2 py-1.5 tabular-nums">{pct(r.score, 0)}</td>
                <td className="px-2 py-1.5">
                  <VerdictChip verdict={r.verdict} />
                </td>
                <td className="px-2 py-1.5">{r.label || "—"}</td>
                <td className="max-w-xs truncate px-2 py-1.5 text-ink/70">{r.explanation || "—"}</td>
              </tr>
              {open === r.id ? (
                <tr className="bg-paper/70">
                  <td colSpan={7} className="px-3 py-2">
                    <pre className="mono max-h-40 overflow-auto text-[11px]">
                      {JSON.stringify(r.evidence ?? [], null, 2)}
                    </pre>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvaluateModal({
  traceId,
  onClose,
  onDone,
}: {
  traceId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [evals, setEvals] = useState<Evaluator[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listEvaluators().then(setEvals).catch((e) => setErr(String(e)));
  }, []);

  return (
    <Modal title="Evaluate trace" onClose={onClose}>
      {err ? <ErrorBlock title="Error" detail={err} /> : null}
      <div className="max-h-64 space-y-1 overflow-auto">
        {evals.map((e) => (
          <label key={`${e.id}-${e.version}`} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={picked.includes(e.id)}
              onChange={(ev) =>
                setPicked((p) => (ev.target.checked ? [...p, e.id] : p.filter((x) => x !== e.id)))
              }
            />
            <span className="font-medium">{e.id}</span>
            <span className="text-ink/50">
              {e.dimension} · {e.type}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!picked.length || busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const run = await createEvaluation({ trace_ids: [traceId], evaluator_ids: picked });
              rememberEvalRun(run.id);
              const done = await pollEvaluation(run.id);
              onDone(`Evaluation ${done.id} → ${done.status}`);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Evaluate failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Running…" : "Run"}
        </Button>
      </div>
    </Modal>
  );
}

function PromoteModal({
  traceId,
  onClose,
  onDone,
}: {
  traceId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listDatasets()
      .then((d) => {
        setDatasets(d);
        if (d[0]) setDatasetId(d[0].id);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <Modal title="Add to dataset" onClose={onClose}>
      {err ? <ErrorBlock title="Error" detail={err} /> : null}
      <div className="space-y-2 text-xs">
        <label className="block">
          Dataset
          <select
            className="mt-1 h-8 w-full rounded border border-border px-2"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Expected answer
          <Input className="mt-1" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </label>
        <label className="block">
          Evidence (JSON or text)
          <Input className="mt-1" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!datasetId || busy}
          onClick={async () => {
            setBusy(true);
            try {
              let ev: unknown = evidence;
              try {
                ev = evidence ? JSON.parse(evidence) : undefined;
              } catch {
                /* keep string */
              }
              const item = await promoteTrace(traceId, {
                dataset_id: datasetId,
                expectation: { answer: answer || undefined, evidence: ev || undefined },
              });
              onDone(`Promoted as item ${item.id}`);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Promote failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Promote"}
        </Button>
      </div>
    </Modal>
  );
}

function ReviewModal({
  results,
  onClose,
  onDone,
}: {
  results: EvalResult[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [resultId, setResultId] = useState(results[0]?.id || "");
  const [verdict, setVerdict] = useState("pass");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal title="Human review" onClose={onClose}>
      {err ? <ErrorBlock title="Error" detail={err} /> : null}
      <div className="space-y-2 text-xs">
        <label className="block">
          Result
          <select
            className="mt-1 h-8 w-full rounded border border-border px-2"
            value={resultId}
            onChange={(e) => setResultId(e.target.value)}
          >
            {results.map((r) => (
              <option key={r.id} value={r.id}>
                {r.evaluator_id} · {r.verdict}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Verdict
          <select
            className="mt-1 h-8 w-full rounded border border-border px-2"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value)}
          >
            <option value="pass">pass</option>
            <option value="fail">fail</option>
            <option value="unsure">unsure</option>
          </select>
        </label>
        <label className="block">
          Label
          <Input className="mt-1" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block">
          Notes
          <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!resultId || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await createReview({
                result_id: resultId,
                verdict,
                label: label || null,
                notes: notes || null,
              });
              onDone("Review submitted");
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Review failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Submit"}
        </Button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border border-border bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" className="text-ink/50 hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TraceViewPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading trace…" />}>
      <TraceViewInner />
    </Suspense>
  );
}
