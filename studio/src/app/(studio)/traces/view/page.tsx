"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { OutcomeChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TraceGraph } from "@/components/trace/trace-graph";
import { TraceTimeline } from "@/components/trace/trace-timeline";
import { TraceInspector } from "@/components/trace/trace-inspector";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { findTrace, loadSuite } from "@/lib/data";
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
} from "@/lib/api";
import { fmtMs, sourceChipClass } from "@/lib/trace-helpers";
import {
  apiDetailToViewModel,
  fetchTraceEvents,
  suiteTraceToDetail,
  type TraceViewModel,
} from "@/lib/trace-model";
import { cn } from "@/lib/utils";

function TraceViewInner() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const suiteParam = params.get("suite");
  const { mode } = useApiMode();
  const suiteCtx = useSuite();
  const router = useRouter();

  const [vm, setVm] = useState<TraceViewModel | null>(null);
  const [neighborIds, setNeighborIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [evalOpen, setEvalOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [panelPct, setPanelPct] = useState(52);
  const [stack, setStack] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1099px)");
    const apply = () => setStack(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === "live") {
        const [t, events] = await Promise.all([getTrace(id), fetchTraceEvents(id)]);
        setVm(apiDetailToViewModel(t, { events }));
        setNeighborIds([]);
      } else {
        const suite = suiteParam || suiteCtx.suite || "default";
        const data = suite === suiteCtx.suite ? suiteCtx.data : await loadSuite(suite);
        const t = findTrace(data, id);
        if (!t) throw new Error(`Trace ${id} not in suite ${suite}`);
        setVm(suiteTraceToDetail(t, data, suite));
        setNeighborIds((data.traces || []).map((x) => x.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trace");
      setVm(null);
    } finally {
      setLoading(false);
    }
  }, [id, mode, suiteParam, suiteCtx.suite, suiteCtx.data]);

  useEffect(() => {
    reload();
  }, [reload]);

  const nav = useMemo(() => {
    if (!id || !neighborIds.length) return { prev: null as string | null, next: null as string | null };
    const i = neighborIds.indexOf(id);
    return {
      prev: i > 0 ? neighborIds[i - 1] : null,
      next: i >= 0 && i < neighborIds.length - 1 ? neighborIds[i + 1] : null,
    };
  }, [id, neighborIds]);

  const goNeighbor = (nid: string | null) => {
    if (!nid) return;
    const suiteQ = suiteParam || vm?.suite;
    router.push(
      `/traces/view/?id=${encodeURIComponent(nid)}${
        suiteQ ? `&suite=${encodeURIComponent(suiteQ)}` : ""
      }`,
    );
  };

  const onDrag = useCallback((e: MouseEvent) => {
    if (!dragging.current || !layoutRef.current) return;
    const rect = layoutRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setPanelPct(Math.min(72, Math.max(28, pct)));
  }, []);

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", onDrag);
      window.removeEventListener("mouseup", up);
    };
  }, [onDrag]);

  return (
    <>
      <Topbar title="Trace" />
      <main className="min-w-0 space-y-3 overflow-x-hidden p-3 sm:p-4">
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

        {vm && !loading ? (
          <>
            <header className="flex min-w-0 flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <h1 className="truncate text-base font-semibold text-ink sm:text-lg">{vm.title}</h1>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <OutcomeChip label={vm.outcome} />
                  <Badge className="border-border bg-white">{vm.model}</Badge>
                  <Badge className={sourceChipClass(vm.source)}>{vm.source}</Badge>
                  <span className="text-xs tabular-nums text-ink/55">{fmtMs(vm.latencyMs)}</span>
                  <span className="text-xs tabular-nums text-ink/55">
                    {vm.tokens != null ? `${vm.tokens} tok` : "—"}
                  </span>
                  {vm.tags.map((t) => (
                    <Badge key={t} className="border-border bg-muted text-[10px] text-ink/60">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEvalOpen(true)}
                  disabled={mode !== "live"}
                >
                  Evaluate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPromoteOpen(true)}
                  disabled={mode !== "live"}
                >
                  Add to dataset
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReviewOpen(true)}
                  disabled={mode !== "live"}
                >
                  Review
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => navigator.clipboard.writeText(vm.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  id
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!nav.prev}
                  onClick={() => goNeighbor(nav.prev)}
                  aria-label="Previous trace"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!nav.next}
                  onClick={() => goNeighbor(nav.next)}
                  aria-label="Next trace"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div
              ref={layoutRef}
              className={cn(
                "min-w-0",
                stack ? "flex flex-col gap-3" : "flex gap-0",
              )}
              style={stack ? undefined : { minHeight: "min(70vh, 720px)" }}
            >
              <section
                className={cn(
                  "min-w-0 overflow-hidden rounded-lg border border-border bg-white",
                  stack ? "min-h-[320px]" : "flex flex-col",
                )}
                style={stack ? undefined : { width: `${panelPct}%`, minHeight: 420 }}
              >
                <Tabs defaultValue="graph" className="flex h-full min-h-0 min-w-0 flex-col">
                  <div className="border-b border-border px-2 pt-1">
                    <TabsList>
                      <TabsTrigger value="graph">Graph</TabsTrigger>
                      <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="graph" className="mt-0 min-h-0 flex-1 p-2">
                    <div className="h-[min(56vh,560px)] min-h-[260px] w-full min-w-0">
                      <TraceGraph
                        spans={vm.spans}
                        media={vm.media}
                        selectedId={selectedSpanId}
                        onSelect={(sid) => setSelectedSpanId(sid)}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="timeline" className="mt-0 min-h-0 flex-1 p-2">
                    <div className="h-[min(56vh,560px)] min-h-[260px] w-full min-w-0">
                      <TraceTimeline
                        spans={vm.spans}
                        selectedId={selectedSpanId}
                        onSelect={setSelectedSpanId}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </section>

              {!stack ? (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  className="mx-0.5 w-1.5 shrink-0 cursor-col-resize rounded bg-border hover:bg-teal/40"
                  onMouseDown={() => {
                    dragging.current = true;
                  }}
                />
              ) : null}

              <section
                className={cn(
                  "min-w-0 overflow-hidden rounded-lg border border-border bg-white p-3",
                  stack ? "min-h-[360px]" : "flex-1",
                )}
                style={stack ? undefined : { minHeight: 420 }}
              >
                <TraceInspector vm={vm} selectedSpanId={selectedSpanId} />
              </section>
            </div>

            {evalOpen ? (
              <EvaluateModal
                traceId={vm.id}
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
                traceId={vm.id}
                onClose={() => setPromoteOpen(false)}
                onDone={(msg) => {
                  setActionMsg(msg);
                  setPromoteOpen(false);
                }}
              />
            ) : null}
            {reviewOpen ? (
              <ReviewModal
                results={vm.results}
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
    listEvaluators()
      .then(setEvals)
      .catch((e) => setErr(String(e)));
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
