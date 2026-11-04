"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, X } from "lucide-react";
import { EmptyBlock } from "@/components/state-block";
import { OutcomeChip, VerdictChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AudioEvidencePanel, ImageEvidenceOverlay } from "@/components/trace/media-panel";
import { CrossModalMediaPanel } from "@/components/trace/cross-modal-media-panel";
import { VideoMediaPanel } from "@/components/trace/video-media-panel";
import type { EvalResult, Span } from "@/lib/api";
import {
  fmtMs,
  parseToolArgs,
  resolveMediaSrc,
  toolResultsForSpan,
  toolSpans,
} from "@/lib/trace-helpers";
import {
  isNotApplicableResult,
  type TraceViewModel,
} from "@/lib/trace-model";
import { cn, pct } from "@/lib/utils";
import type { RunRow, TraceRow } from "@/lib/types";

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1 text-[11px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      <Copy className="h-3 w-3" />
      {ok ? "Copied" : "Copy"}
    </Button>
  );
}

function CollapsibleText({
  title,
  text,
  defaultOpen = true,
  truncateAt = 1200,
}: {
  title: string;
  text: string;
  defaultOpen?: boolean;
  truncateAt?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [more, setMore] = useState(false);
  const long = text.length > truncateAt;
  const shown = !long || more ? text : `${text.slice(0, truncateAt)}…`;
  return (
    <div className="min-w-0 rounded border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/55"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{title}</span>
        </button>
        <CopyBtn text={text} />
      </div>
      {open ? (
        <div className="min-w-0 p-2">
          <pre className="mono max-h-[360px] min-w-0 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">
            {shown || "—"}
          </pre>
          {long ? (
            <button
              type="button"
              className="mt-1 text-[11px] font-medium text-teal hover:underline"
              onClick={() => setMore((v) => !v)}
            >
              {more ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function JsonViewer({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  let text = "";
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <div className="min-w-0 overflow-hidden rounded border border-border">
      <button
        type="button"
        className="flex w-full items-center gap-1 bg-muted/40 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/55"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Raw JSON
      </button>
      {open ? (
        <pre className="mono max-h-[420px] min-w-0 overflow-auto whitespace-pre-wrap break-words p-2 text-[11px]">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function OverviewTab({ vm }: { vm: TraceViewModel }) {
  return (
    <div className="min-w-0 space-y-3 text-sm">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">Question</div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-ink">{vm.question || "—"}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">Expected</div>
          <p className="mt-0.5 break-words font-mono text-xs">{vm.expected || "—"}</p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">Answer</div>
          <p className="mt-0.5 break-words font-mono text-xs">{vm.answer || "—"}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">Outcome</span>
        <OutcomeChip label={vm.outcome} />
      </div>
      {vm.stageSentence ? (
        <p className="rounded border border-border bg-paper px-3 py-2 text-xs text-ink/75">{vm.stageSentence}</p>
      ) : null}
    </div>
  );
}

function EvidenceTab({ vm }: { vm: TraceViewModel }) {
  const boxes = useMemo(() => {
    for (const r of vm.results) {
      const evidence = Array.isArray(r.evidence) ? r.evidence : [];
      let expected: [number, number, number, number] | undefined;
      let claimed: [number, number, number, number] | undefined;
      for (const e of evidence) {
        if (!e || typeof e !== "object") continue;
        const row = e as { type?: string; role?: string; locator?: unknown };
        if (row.type !== "image_region" || !Array.isArray(row.locator) || row.locator.length < 4)
          continue;
        const box = row.locator.slice(0, 4).map(Number) as [number, number, number, number];
        if (row.role === "expected") expected = box;
        if (row.role === "claimed") claimed = box;
      }
      if (expected || claimed) return { expected, claimed };
    }
    return {
      expected: vm.caseRow?.truth_box || undefined,
      claimed: vm.run?.box || undefined,
    };
  }, [vm]);

  const dagSpans = vm.spans.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    parent_span_ids: s.parentIds,
    attributes: s.attributes,
    error: s.error,
  }));

  if (vm.modality === "cross-modal") {
    return (
      <CrossModalMediaPanel
        caseRow={vm.caseRow}
        run={vm.run}
        perceptionLabel={vm.outcome}
      />
    );
  }
  if (vm.modality === "video") {
    return (
      <VideoMediaPanel
        caseRow={vm.caseRow}
        run={
          vm.run ||
          ({
            agent: vm.agent || "",
            case_id: vm.caseId || "",
            condition: vm.variant || "",
            answer: vm.answer,
            span_ms:
              vm.raw &&
              typeof vm.raw === "object" &&
              "output" in (vm.raw as object)
                ? ((vm.raw as { output?: { span_ms?: [number, number] } }).output?.span_ms)
                : undefined,
            label: vm.outcome || undefined,
          } as RunRow)
        }
        trace={
          {
            id: vm.id,
            agent: vm.agent || "",
            case_id: vm.caseId || vm.caseRow?.id || "",
            variant: vm.variant || "",
            spans: dagSpans,
          } as TraceRow
        }
        stageLabel={vm.outcome}
      />
    );
  }
  if (vm.modality === "voice") {
    return (
      <AudioEvidencePanel
        caseRow={
          vm.caseRow || {
            id: vm.id,
            modality: "audio",
            audio: resolveMediaSrc(vm.media[0]),
            truth_span: undefined,
            turns: [],
          }
        }
        run={
          vm.run ||
          ({
            span_ms:
              vm.raw &&
              typeof vm.raw === "object" &&
              "output" in (vm.raw as object)
                ? ((vm.raw as { output?: { span_ms?: [number, number] } }).output?.span_ms)
                : undefined,
          } as RunRow)
        }
      />
    );
  }

  const imageSrc =
    resolveMediaSrc(
      vm.media.find(
        (m) => (m.modality || "image").includes("image") || (m.mime || "").startsWith("image/"),
      ),
    ) ||
    vm.caseRow?.image ||
    "";

  return (
    <ImageEvidenceOverlay
      caseRow={{
        id: vm.caseId || vm.id,
        image: imageSrc,
        truth_box: boxes.expected || null,
      }}
      run={{
        agent: vm.agent || "",
        case_id: vm.caseId || "",
        condition: vm.variant || "",
        box: boxes.claimed || null,
      }}
      trace={{
        id: vm.id,
        agent: vm.agent || "",
        case_id: vm.caseId || "",
        variant: vm.variant || "",
        assets: vm.media.map((m) => ({
          path: resolveMediaSrc(m),
          modality: m.modality || "image",
        })),
      }}
    />
  );
}

function ToolCallsTab({ vm }: { vm: TraceViewModel }) {
  const spans = toolSpans(
    vm.spans.map(
      (s) =>
        ({
          id: s.id,
          name: s.name,
          type: s.type,
          input: s.input,
          output: s.output,
          attributes: s.attributes,
          latency_ms: s.latencyMs,
          error: s.error,
        }) as Span,
    ),
  );
  if (!spans.length) return <EmptyBlock title="No tool spans" />;
  return (
    <div className="min-w-0 space-y-2">
      {spans.map((span) => {
        const parsed = parseToolArgs(span);
        const related = toolResultsForSpan(vm.results, span);
        return (
          <div key={span.id} className="min-w-0 overflow-hidden rounded border border-border bg-white p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span className="truncate">{parsed.name}</span>
              <span className="text-[11px] font-normal text-ink/50">{fmtMs(span.latency_ms)}</span>
            </div>
            <div className="mt-2 min-w-0 overflow-auto">
              <table className="w-full min-w-0 border-collapse text-left text-[11px]">
                <thead>
                  <tr className="text-ink/50">
                    <th className="px-1 py-1">Argument</th>
                    <th className="px-1 py-1">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args) ? (
                    Object.entries(parsed.args as Record<string, unknown>).map(([k, v]) => (
                      <tr key={k} className="border-t border-border/70">
                        <td className="px-1 py-1 align-top font-medium">{k}</td>
                        <td className="min-w-0 px-1 py-1">
                          <pre className="mono max-w-full overflow-auto whitespace-pre-wrap break-words">
                            {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-border/70">
                      <td className="px-1 py-1" colSpan={2}>
                        <pre className="mono overflow-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(parsed.args, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2">
              <div className="text-[11px] font-semibold uppercase text-ink/45">Result</div>
              <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-paper p-2 text-[11px]">
                {typeof parsed.result === "string"
                  ? parsed.result
                  : JSON.stringify(parsed.result, null, 2)}
              </pre>
            </div>
            <div className="mt-2 space-y-1">
              {related.length === 0 ? (
                <p className="text-[11px] text-ink/45">No tool_* evaluator results linked.</p>
              ) : (
                related.map((r) => {
                  const pass = (r.verdict || "").toLowerCase() === "pass";
                  return (
                    <div key={r.id} className="flex min-w-0 items-start gap-2 text-xs">
                      {pass ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal" />
                      ) : (
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-crimson" />
                      )}
                      <div className="min-w-0">
                        <span className="font-medium">{r.evaluator_id}</span>{" "}
                        <VerdictChip verdict={r.verdict} />{" "}
                        <span className="break-words text-ink/60">{r.explanation || r.label}</span>
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
  );
}

function EvaluationsTab({ results }: { results: EvalResult[] }) {
  const [showNa, setShowNa] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const { passed, failed, na, visible, byDim } = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let na = 0;
    for (const r of results) {
      if (isNotApplicableResult(r)) {
        na += 1;
        continue;
      }
      const v = (r.verdict || "").toLowerCase();
      if (v === "pass" || (r.score != null && r.score >= 0.5)) passed += 1;
      else if (v === "fail" || (r.score != null && r.score < 0.5) || (r.status || "").toLowerCase() === "error")
        failed += 1;
    }
    const visible = results.filter((r) => showNa || !isNotApplicableResult(r));
    const byDim = new Map<string, EvalResult[]>();
    for (const r of visible) {
      const dim = r.dimension || "other";
      const arr = byDim.get(dim) || [];
      arr.push(r);
      byDim.set(dim, arr);
    }
    return { passed, failed, na, visible, byDim };
  }, [results, showNa]);

  if (!results.length) return <EmptyBlock title="No evaluation results" />;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-teal/30 bg-teal/10 text-teal">{passed} passed</Badge>
        <Badge className="border-crimson/30 bg-crimson/10 text-crimson">{failed} failed</Badge>
        <Badge className="border-border bg-muted text-ink/55">{na} not applicable hidden</Badge>
        <label className="ml-auto flex items-center gap-2 text-[11px] text-ink/60">
          Show not applicable
          <Switch checked={showNa} onCheckedChange={setShowNa} aria-label="Show not applicable" />
        </label>
      </div>
      {[...byDim.entries()].map(([dim, rows]) => (
        <div key={dim} className="min-w-0">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">{dim}</div>
          <div className="min-w-0 space-y-1.5">
            {rows.map((r) => {
              const score = r.score;
              const bar = score != null ? Math.max(0, Math.min(100, score * 100)) : 0;
              const isOpen = open === r.id;
              return (
                <div key={r.id} className="min-w-0 overflow-hidden rounded border border-border bg-white">
                  <button
                    type="button"
                    className="flex w-full min-w-0 flex-col gap-1.5 px-2.5 py-2 text-left hover:bg-muted/40"
                    onClick={() => setOpen((c) => (c === r.id ? null : r.id))}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-semibold">{r.evaluator_id}</span>
                      <Badge className="border-border bg-muted text-[10px]">{r.status || "—"}</Badge>
                      <VerdictChip verdict={r.verdict} />
                      {r.label ? (
                        <span className="truncate text-[11px] text-ink/55">{r.label}</span>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className={cn(
                            "h-full rounded",
                            (r.verdict || "").toLowerCase() === "fail" ? "bg-crimson" : "bg-teal",
                          )}
                          style={{ width: `${bar}%` }}
                        />
                      </div>
                      <span className="shrink-0 tabular-nums text-[11px] text-ink/55">{pct(score, 0)}</span>
                    </div>
                    {r.explanation ? (
                      <p className="line-clamp-2 text-[11px] text-ink/65">{r.explanation}</p>
                    ) : null}
                  </button>
                  {isOpen ? (
                    <div className="min-w-0 space-y-2 border-t border-border bg-paper/60 px-2.5 py-2">
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-ink/45">Evidence</div>
                        <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px]">
                          {JSON.stringify(r.evidence ?? [], null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-ink/45">Metadata</div>
                        <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px]">
                          {JSON.stringify(r.meta ?? {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!visible.length ? (
        <p className="text-xs text-ink/50">All results are not applicable. Toggle the switch to show them.</p>
      ) : null}
    </div>
  );
}

function MetadataTab({ vm }: { vm: TraceViewModel }) {
  const entries = Object.entries(vm.metadata || {});
  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 overflow-auto rounded border border-border">
        <table className="w-full min-w-0 border-collapse text-left text-xs">
          <thead>
            <tr className="text-ink/50">
              <th className="px-2 py-1.5">Key</th>
              <th className="px-2 py-1.5">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-2 py-4 text-ink/45">
                  No metadata.
                </td>
              </tr>
            ) : (
              entries.map(([k, v]) => (
                <tr key={k} className="border-t border-border">
                  <td className="whitespace-nowrap px-2 py-1.5 align-top font-medium">{k}</td>
                  <td className="min-w-0 px-2 py-1.5">
                    <pre className="mono max-w-full overflow-auto whitespace-pre-wrap break-words text-[11px]">
                      {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <JsonViewer value={vm.raw} />
    </div>
  );
}

export function TraceInspector({
  vm,
  selectedSpanId,
}: {
  vm: TraceViewModel;
  selectedSpanId?: string | null;
}) {
  const hasTools = vm.spans.some((s) => s.type === "tool");
  const hasEvidence =
    vm.modality === "image" ||
    vm.modality === "video" ||
    vm.modality === "voice" ||
    vm.modality === "cross-modal" ||
    !!vm.caseRow?.image ||
    !!vm.caseRow?.video ||
    !!vm.caseRow?.audio ||
    vm.media.length > 0;

  const defaultTab = selectedSpanId && hasTools ? "tools" : "overview";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {selectedSpanId ? (
        <div className="mb-2 truncate text-[11px] text-ink/50">
          Selected span: <span className="font-mono text-ink/70">{selectedSpanId}</span>
        </div>
      ) : null}
      <Tabs defaultValue={defaultTab} key={`${vm.id}:${defaultTab}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-w-0 overflow-x-auto">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {hasEvidence ? <TabsTrigger value="evidence">Evidence</TabsTrigger> : null}
            {hasTools ? <TabsTrigger value="tools">Tool calls</TabsTrigger> : null}
            <TabsTrigger value="evaluations">Evaluations</TabsTrigger>
            <TabsTrigger value="io">Input / Output</TabsTrigger>
            <TabsTrigger value="meta">Metadata &amp; raw</TabsTrigger>
          </TabsList>
        </div>
        <div className="mt-2 min-h-0 min-w-0 flex-1 overflow-auto">
          <TabsContent value="overview" className="mt-0">
            <OverviewTab vm={vm} />
          </TabsContent>
          {hasEvidence ? (
            <TabsContent value="evidence" className="mt-0">
              <EvidenceTab vm={vm} />
            </TabsContent>
          ) : null}
          {hasTools ? (
            <TabsContent value="tools" className="mt-0">
              <ToolCallsTab vm={vm} />
            </TabsContent>
          ) : null}
          <TabsContent value="evaluations" className="mt-0">
            <EvaluationsTab results={vm.results} />
          </TabsContent>
          <TabsContent value="io" className="mt-0 space-y-2">
            <CollapsibleText title="Prompt / input" text={vm.inputText || "—"} />
            <CollapsibleText title="Reply / output" text={vm.outputText || "—"} />
          </TabsContent>
          <TabsContent value="meta" className="mt-0">
            <MetadataTab vm={vm} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
