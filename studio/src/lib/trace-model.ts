/**
 * Normalize suite snapshots + live API shapes into list/detail view models.
 * Tolerates missing fields; never throws on partial payloads.
 */

import {
  apiConfig,
  type EvalResult,
  type MediaAsset,
  type Span,
  type TraceDetail,
  type TraceListItem,
} from "@/lib/api";
import type { CaseRow, ResultRow, RunRow, SuiteData, TraceRow, TraceSpan } from "@/lib/types";
import { findCase, findRun, resultsForTrace } from "@/lib/data";
import { isSampleFrameSpan, spanTMs } from "@/lib/video";

export type Modality = "image" | "video" | "voice" | "text" | "cross-modal" | "unknown";

export type EvalDot = {
  dimension: string;
  verdict: "pass" | "fail";
  score?: number | null;
};

export type TraceListRow = {
  id: string;
  time: string | null;
  title: string;
  inputPreview: string;
  outputPreview: string;
  outcome: string | null;
  model: string;
  source: string;
  modality: Modality;
  latencyMs: number | null;
  tokens: number | null;
  toolCalls: number;
  evalDots: EvalDot[];
  tags: string[];
  thumbUrl: string | null;
  needsReview: boolean;
  suite?: string;
  caseId?: string;
  variant?: string;
  agent?: string;
};

export type NormalizedSpan = {
  id: string;
  name: string;
  type: string;
  parentIds: string[];
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  status: string | null;
  error: string | null;
  model: string | null;
  input: unknown;
  output: unknown;
  attributes: Record<string, unknown>;
  startedAt: string | null;
  endedAt: string | null;
  startOffsetMs: number | null;
};

export type GraphNodeKind = "span" | "group" | "media";

export type GraphNodeModel = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  sublabel?: string;
  type: string;
  latencyMs: number | null;
  tokens: number | null;
  failed: boolean;
  sha?: string | null;
  /** When kind=group, member span ids */
  memberIds?: string[];
  spanId?: string;
  mediaRole?: "original" | "transform" | "model-saw";
};

export type GraphEdgeModel = { id: string; source: string; target: string };

export type TimelineBar = {
  id: string;
  label: string;
  type: string;
  startMs: number;
  durationMs: number;
  lane: number;
  failed: boolean;
};

export type TraceViewModel = {
  id: string;
  title: string;
  outcome: string | null;
  stageSentence: string | null;
  model: string;
  source: string;
  latencyMs: number | null;
  tokens: number | null;
  tags: string[];
  modality: Modality;
  question: string;
  expected: string;
  answer: string;
  inputText: string;
  outputText: string;
  spans: NormalizedSpan[];
  media: MediaAsset[];
  results: EvalResult[];
  caseRow?: CaseRow;
  run?: RunRow;
  metadata: Record<string, unknown>;
  raw: unknown;
  suite?: string;
  agent?: string;
  caseId?: string;
  variant?: string;
  events: TraceEvent[];
};

export type TraceEvent = {
  id?: string;
  type?: string;
  name?: string;
  ts?: string | number | null;
  payload?: unknown;
  [key: string]: unknown;
};

const VARIANT_LABEL: Record<string, string> = {
  clean: "clean",
  blur: "blurred",
  noise: "noisy",
  lowres: "low-res",
  blind: "blind",
  blind_guess: "blind",
  identity: "identity",
};

const STAGE_SENTENCE: Record<string, string> = {
  grounded_correct: "The answer matched the ground truth and cited the right evidence.",
  correct_ungrounded: "The answer was right but the cited evidence did not support it.",
  misread: "The agent read the wrong value from the media.",
  mislocated: "The agent pointed at the wrong region or span.",
  abstained: "The agent declined to answer.",
  heard_wrong: "The agent mis-heard the spoken content.",
  misunderstood: "The agent understood the wrong meaning of what was said.",
  invalid_output: "The agent returned an invalid or incomplete answer.",
  cross_modal_correct: "The agent compared both sides correctly.",
  misread_image: "The agent misread the receipt value.",
  comparison_error: "Both sides were read correctly but compared wrongly.",
  both_wrong: "The agent mis-heard the claim and misread the image.",
  temporal_correct: "The cited time matched the true event.",
  temporal_off: "The cited time was offset from the true event.",
};

export function shortModelName(agent?: string | null): string {
  if (!agent) return "—";
  const raw = agent.replace(/^muse[-_]?/i, "").replace(/[-_]/g, " ");
  return raw
    .split(" ")
    .filter(Boolean)
    .map((w) => ( /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function shortVariant(variant?: string | null): string {
  if (!variant) return "";
  const key = variant.toLowerCase();
  return VARIANT_LABEL[key] || variant.replace(/_/g, " ");
}

export function shortQuestionTitle(caseRow?: CaseRow | null, fallback?: string): string {
  if (!caseRow && !fallback) return "Trace";
  const family = (caseRow?.family || "").toLowerCase();
  const q = (caseRow?.question || fallback || "").trim();
  const id = (caseRow?.id || "").toLowerCase();
  const modality = (caseRow?.modality || "").toLowerCase();

  if (modality === "cross_modal" || modality === "cross-modal" || family.includes("cross") || id.startsWith("cm_")) {
    return "Cross-modal claim";
  }
  if (family.includes("video") || modality === "video" || id.startsWith("vid_")) {
    if (/time|when|second/i.test(q) || id.includes("time")) return "Video time";
    if (/order|first|second|third/i.test(q) || id.includes("order") || id.includes("third"))
      return "Video order";
    return "Video question";
  }
  if (family.includes("audio") || modality === "audio" || id.startsWith("conv_")) {
    return "Audio conversation";
  }
  if (family.includes("receipt") || id.includes("cord") || id.includes("receipt") || /receipt/i.test(q)) {
    if (/total/i.test(q) || id.includes("total")) return "Receipt total";
    if (/tax/i.test(q) || id.includes("tax")) return "Receipt tax";
    if (/date/i.test(q)) return "Receipt date";
    return "Receipt";
  }
  if (q) {
    const clipped = q.replace(/\s*Answer with.*$/i, "").replace(/\?.*$/, "").trim();
    const words = clipped.split(/\s+/).slice(0, 5).join(" ");
    return words.length > 42 ? `${words.slice(0, 40)}…` : words || "Trace";
  }
  return caseRow?.id || "Trace";
}

export function buildHumanTitle(opts: {
  caseRow?: CaseRow | null;
  agent?: string | null;
  variant?: string | null;
  question?: string | null;
}): string {
  const parts = [
    shortQuestionTitle(opts.caseRow, opts.question || undefined),
    shortModelName(opts.agent),
    shortVariant(opts.variant),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function detectModality(opts: {
  caseRow?: CaseRow | null;
  suiteModality?: string | null;
  media?: Array<{ modality?: string | null; mime?: string | null }>;
  tags?: string[];
}): Modality {
  const m = (opts.caseRow?.modality || opts.suiteModality || "").toLowerCase();
  if (m === "cross_modal" || m === "cross-modal") return "cross-modal";
  if (m === "video") return "video";
  if (m === "audio" || m === "voice") return "voice";
  if (m === "image") return "image";
  if (m === "text") return "text";

  const media = opts.media || [];
  const hasImage = media.some(
    (x) => (x.modality || "").includes("image") || (x.mime || "").startsWith("image/"),
  );
  const hasAudio = media.some(
    (x) => (x.modality || "").includes("audio") || (x.mime || "").startsWith("audio/"),
  );
  const hasVideo = media.some(
    (x) => (x.modality || "").includes("video") || (x.mime || "").startsWith("video/"),
  );
  if (hasImage && hasAudio) return "cross-modal";
  if (hasVideo) return "video";
  if (hasAudio) return "voice";
  if (hasImage) return "image";

  const tags = (opts.tags || []).map((t) => t.toLowerCase());
  if (tags.some((t) => t.includes("video"))) return "video";
  if (tags.some((t) => t.includes("audio") || t.includes("voice"))) return "voice";
  if (tags.some((t) => t.includes("cross"))) return "cross-modal";
  if (tags.some((t) => t.includes("image") || t.includes("cord"))) return "image";
  return "unknown";
}

export function stageSentence(label?: string | null): string | null {
  if (!label) return null;
  const key = label.toLowerCase();
  if (STAGE_SENTENCE[key]) return STAGE_SENTENCE[key];
  const pretty = label.replace(/_/g, " ");
  return `Stage label: ${pretty}.`;
}

export function isNotApplicableResult(r: { status?: string | null; verdict?: string | null }): boolean {
  const s = (r.status || "").toLowerCase();
  const v = (r.verdict || "").toLowerCase();
  return (
    s === "not_applicable" ||
    s === "skipped" ||
    s === "n/a" ||
    v === "not_applicable" ||
    v === "n/a" ||
    v === "na"
  );
}

export function evalDotsFromResults(
  results: Array<{
    dimension?: string | null;
    verdict?: string | null;
    status?: string | null;
    score?: number | null;
    evaluator_id?: string | null;
  }> = [],
): EvalDot[] {
  const dots: EvalDot[] = [];
  for (const r of results) {
    if (isNotApplicableResult(r)) continue;
    const v = (r.verdict || "").toLowerCase();
    let verdict: "pass" | "fail" | null = null;
    if (v === "pass" || v === "fail") verdict = v;
    else if (r.score != null) verdict = r.score >= 0.5 ? "pass" : "fail";
    else if ((r.status || "").toLowerCase() === "error") verdict = "fail";
    if (!verdict) continue;
    dots.push({
      dimension: r.dimension || r.evaluator_id || "eval",
      verdict,
      score: r.score,
    });
  }
  return dots;
}

export function evalDotsFromScoreSummary(
  summary?: {
    by_dimension?: Record<string, number | { mean?: number | null; count?: number }>;
  } | null,
): EvalDot[] {
  const dots: EvalDot[] = [];
  for (const [dim, val] of Object.entries(summary?.by_dimension || {})) {
    const mean =
      typeof val === "number"
        ? val
        : val && typeof val === "object"
          ? (val as { mean?: number | null }).mean
          : null;
    if (mean == null) continue;
    dots.push({ dimension: dim, verdict: mean >= 0.5 ? "pass" : "fail", score: mean });
  }
  return dots;
}

function oneLine(v: unknown, max = 96): string {
  if (v == null) return "—";
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "object" && v && "answer" in (v as object))
    s = String((v as { answer?: unknown }).answer ?? "");
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function readableText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "answer" in (v as object)) {
    const a = (v as { answer?: unknown }).answer;
    if (typeof a === "string") return a;
  }
  if (typeof v === "object" && v && "prompt" in (v as object) && typeof (v as { prompt: unknown }).prompt === "string") {
    return (v as { prompt: string }).prompt;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function thumbForCase(caseRow?: CaseRow | null, modality?: Modality): string | null {
  if (!caseRow) return null;
  if (caseRow.image) return caseRow.image;
  if (modality === "video" || caseRow.video) {
    // Prefer a first sampled frame path pattern when present in suite media layout
    return caseRow.video || null;
  }
  return null;
}

function needsReviewFrom(outcome: string | null, dots: EvalDot[]): boolean {
  if (dots.some((d) => d.verdict === "fail")) return true;
  const o = (outcome || "").toLowerCase();
  if (!o) return false;
  if (o.includes("correct") && !o.includes("ungrounded")) return false;
  return [
    "misread",
    "mislocated",
    "heard_wrong",
    "invalid",
    "abstained",
    "ungrounded",
    "both_wrong",
    "comparison_error",
  ].some((k) => o.includes(k));
}

export function listRowFromSuite(
  trace: TraceRow,
  data: SuiteData,
  suite: string,
): TraceListRow {
  const run = findRun(data, trace.agent, trace.case_id, trace.variant);
  const caseRow = findCase(data, trace.case_id);
  const results = resultsForTrace(data, trace) as ResultRow[];
  const modality = detectModality({
    caseRow,
    suiteModality: data.meta.modality,
    media: (trace.assets || []).map((a) => ({ modality: a.modality })),
  });
  const title = buildHumanTitle({
    caseRow,
    agent: trace.agent,
    variant: trace.variant,
  });
  const outcome = run?.label || null;
  const dots = evalDotsFromResults(
    results.map((r) => ({
      dimension: r.dimension,
      verdict: r.verdict,
      status: r.status,
      score: r.score,
      evaluator_id: r.evaluator_id,
    })),
  );
  const toolCalls = (trace.spans || []).filter((s) => (s.type || "").toLowerCase() === "tool").length;
  const latencyMs =
    run?.latency != null
      ? run.latency < 50
        ? run.latency * 1000
        : run.latency
      : (trace.spans || []).reduce((acc, s) => acc + ((s.latency_s || 0) * 1000), 0) || null;
  const tokens =
    (run?.usage?.input_tokens || 0) + (run?.usage?.output_tokens || 0) ||
    (trace.spans || []).reduce(
      (acc, s) => acc + (s.usage?.input_tokens || 0) + (s.usage?.output_tokens || 0),
      0,
    ) ||
    null;

  return {
    id: trace.id,
    time: data.meta.created || null,
    title,
    inputPreview: oneLine(caseRow?.question || trace.case_id),
    outputPreview: oneLine(run?.answer ?? "—"),
    outcome,
    model: shortModelName(trace.agent),
    source: "import",
    modality,
    latencyMs: latencyMs != null && latencyMs > 0 ? latencyMs : null,
    tokens: tokens && tokens > 0 ? tokens : null,
    toolCalls,
    evalDots: dots,
    tags: [trace.variant, modality !== "unknown" ? modality : ""].filter(Boolean) as string[],
    thumbUrl: thumbForCase(caseRow, modality),
    needsReview: needsReviewFrom(outcome, dots),
    suite,
    caseId: trace.case_id,
    variant: trace.variant,
    agent: trace.agent,
  };
}

export function listRowFromApi(item: TraceListItem): TraceListRow {
  const dots = evalDotsFromScoreSummary(item.score_summary);
  const tags = item.tags || [];
  const variantTag = tags.find((t) =>
    ["clean", "blur", "noise", "lowres", "blind"].includes(t.toLowerCase()),
  );
  const looksLikeRawId = !item.name || item.name.includes("|") || /^[a-f0-9-]{16,}$/i.test(item.name);
  const title = looksLikeRawId
    ? buildHumanTitle({
        agent: item.agent,
        variant: variantTag,
        question: item.name || undefined,
      })
    : buildHumanTitle({
        agent: item.agent,
        variant: variantTag,
        question: item.name?.replace(/_/g, " "),
      });
  const modality = detectModality({ tags });
  const tokens =
    (item.input_tokens || 0) + (item.output_tokens || 0) || null;
  return {
    id: item.id,
    time: item.started_at || item.ended_at || null,
    title,
    inputPreview: oneLine(item.name || "—"),
    outputPreview: "—",
    outcome: null,
    model: shortModelName(item.agent),
    source: item.source || "unknown",
    modality,
    latencyMs: item.latency_ms ?? null,
    tokens: tokens && tokens > 0 ? tokens : null,
    toolCalls: item.tool_call_count ?? 0,
    evalDots: dots,
    tags,
    thumbUrl: null,
    needsReview: needsReviewFrom(null, dots) || (item.status || "").toLowerCase() === "error",
    agent: item.agent || undefined,
  };
}

export function normalizeSpan(s: Span | TraceSpan): NormalizedSpan {
  const suite = s as TraceSpan;
  const api = s as Span;
  const parentIds =
    api.parent_ids ||
    suite.parent_span_ids ||
    [];
  const latencyMs =
    api.latency_ms != null
      ? api.latency_ms
      : suite.latency_s != null
        ? suite.latency_s * 1000
        : null;
  const attrs = {
    ...(suite.metadata || {}),
    ...(suite.attributes || {}),
    ...(api.attributes || {}),
  };
  return {
    id: s.id,
    name: s.name || s.id,
    type: (s.type || "span").toLowerCase(),
    parentIds: [...parentIds],
    latencyMs,
    inputTokens: s.usage?.input_tokens ?? null,
    outputTokens: s.usage?.output_tokens ?? null,
    status: api.status || suite.status || null,
    error: s.error || null,
    model: api.model || suite.model || null,
    input: s.input,
    output: s.output,
    attributes: attrs,
    startedAt: api.started_at || null,
    endedAt: api.ended_at || null,
    startOffsetMs: null,
  };
}

function assignStartOffsets(spans: NormalizedSpan[]): NormalizedSpan[] {
  // Approximate waterfall offsets: topological levels; siblings share start of parent end.
  const byId = new Map(spans.map((s) => [s.id, s]));
  const start = new Map<string, number>();
  const visiting = new Set<string>();

  const offsetOf = (id: string): number => {
    if (start.has(id)) return start.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const span = byId.get(id);
    if (!span) {
      start.set(id, 0);
      return 0;
    }
    const parents = span.parentIds.filter((p) => byId.has(p));
    let t = 0;
    for (const p of parents) {
      const ps = byId.get(p)!;
      t = Math.max(t, offsetOf(p) + (ps.latencyMs || 0));
    }
    // Parallel siblings: if multiple children of same parent, stagger only by index in timeline builder
    start.set(id, t);
    visiting.delete(id);
    return t;
  };

  for (const s of spans) offsetOf(s.id);

  // For siblings under the same parent set, use identical start (true parallel)
  return spans.map((s) => ({
    ...s,
    startOffsetMs: start.get(s.id) ?? 0,
  }));
}

export function suiteTraceToDetail(
  t: TraceRow,
  data: SuiteData,
  suite: string,
): TraceViewModel {
  const run = findRun(data, t.agent, t.case_id, t.variant);
  const caseRow = findCase(data, t.case_id);
  const results = resultsForTrace(data, t) as unknown as EvalResult[];
  const spans = assignStartOffsets((t.spans || []).map(normalizeSpan));
  const media: MediaAsset[] = (t.assets || []).map((a, i) => ({
    id: a.id || `asset-${i}`,
    url: a.path || undefined,
    path: a.path,
    modality: a.modality,
    transformation: a.transformation,
    mime:
      a.modality === "audio"
        ? "audio/wav"
        : a.modality === "video"
          ? "video/mp4"
          : "image/jpeg",
  }));
  const modality = detectModality({
    caseRow,
    suiteModality: data.meta.modality,
    media,
  });
  const outcome = run?.label || stageFromResults(results);
  const modelSpan = spans.find((s) => s.type === "model");
  const inputText =
    readableText(modelSpan?.input) ||
    caseRow?.question ||
    "";
  const outputText =
    readableText(modelSpan?.output) ||
    (run?.answer != null ? String(run.answer) : "") ||
    "";
  const latencyMs =
    run?.latency != null
      ? run.latency < 50
        ? run.latency * 1000
        : run.latency
      : spans.reduce((a, s) => a + (s.latencyMs || 0), 0) || null;
  const tokens =
    (run?.usage?.input_tokens || 0) + (run?.usage?.output_tokens || 0) ||
    spans.reduce((a, s) => a + (s.inputTokens || 0) + (s.outputTokens || 0), 0) ||
    null;

  return {
    id: t.id,
    title: buildHumanTitle({ caseRow, agent: t.agent, variant: t.variant }),
    outcome,
    stageSentence: stageSentence(outcome),
    model: shortModelName(t.agent),
    source: "import",
    latencyMs: latencyMs && latencyMs > 0 ? latencyMs : null,
    tokens: tokens && tokens > 0 ? tokens : null,
    tags: [t.variant, modality !== "unknown" ? modality : ""].filter(Boolean) as string[],
    modality,
    question: caseRow?.question || "",
    expected: caseRow?.answer != null ? String(caseRow.answer) : "",
    answer: run?.answer != null ? String(run.answer) : "",
    inputText,
    outputText,
    spans,
    media,
    results,
    caseRow,
    run,
    metadata: { case_id: t.case_id, variant: t.variant, agent: t.agent, suite },
    raw: { trace: t, run, caseRow, results },
    suite,
    agent: t.agent,
    caseId: t.case_id,
    variant: t.variant,
    events: [],
  };
}

function stageFromResults(results: EvalResult[]): string | null {
  const stage = results.find(
    (r) =>
      r.evaluator_id === "stage_attribution" ||
      r.evaluator_id === "audio_stage_attribution" ||
      r.evaluator_id === "cross_modal_stage_attribution" ||
      (r.dimension || "").toLowerCase().includes("failure") ||
      (r.dimension || "").toLowerCase().includes("stage"),
  );
  return stage?.label || null;
}

export function apiDetailToViewModel(
  detail: TraceDetail,
  extras?: { caseRow?: CaseRow; run?: RunRow; suite?: string; events?: TraceEvent[] },
): TraceViewModel {
  const spans = assignStartOffsets((detail.spans || []).map(normalizeSpan));
  const media = detail.media || [];
  const results = detail.results || [];
  const caseRow = extras?.caseRow;
  const run = extras?.run;
  const modality = detectModality({
    caseRow,
    media,
    tags: detail.tags,
  });
  const outcome = run?.label || stageFromResults(results);
  const modelSpan = spans.find((s) => s.type === "model");
  const meta = detail.metadata || {};
  const agent = detail.agent || (meta.agent as string) || undefined;
  const variant =
    (meta.variant as string) ||
    (meta.condition as string) ||
    run?.condition ||
    undefined;
  const caseId = (meta.case_id as string) || caseRow?.id || undefined;

  const inputText =
    readableText(modelSpan?.input) ||
    readableText(detail.input) ||
    caseRow?.question ||
    "";
  const outputText =
    readableText(modelSpan?.output) ||
    readableText(detail.output) ||
    (run?.answer != null ? String(run.answer) : "") ||
    "";

  const tokens =
    (detail.input_tokens || 0) + (detail.output_tokens || 0) ||
    spans.reduce((a, s) => a + (s.inputTokens || 0) + (s.outputTokens || 0), 0) ||
    null;

  const title = buildHumanTitle({
    caseRow,
    agent,
    variant,
    question: caseRow?.question || detail.name || undefined,
  });

  return {
    id: detail.id,
    title:
      detail.name && !String(detail.name).includes("|") && !caseRow
        ? String(detail.name)
        : title,
    outcome,
    stageSentence: stageSentence(outcome),
    model: shortModelName(agent),
    source: detail.source || "unknown",
    latencyMs: detail.latency_ms ?? null,
    tokens: tokens && tokens > 0 ? tokens : null,
    tags: detail.tags || [],
    modality,
    question: caseRow?.question || oneLine(detail.input, 240),
    expected: caseRow?.answer != null ? String(caseRow.answer) : "",
    answer:
      run?.answer != null
        ? String(run.answer)
        : detail.output && typeof detail.output === "object" && "answer" in (detail.output as object)
          ? String((detail.output as { answer?: unknown }).answer ?? "")
          : oneLine(detail.output, 240),
    inputText,
    outputText,
    spans,
    media,
    results,
    caseRow,
    run,
    metadata: meta,
    raw: detail,
    suite: extras?.suite,
    agent,
    caseId,
    variant,
    events: extras?.events || [],
  };
}

/** Collapsible group: sample frames or turn transcriptions with shared parents. */
function isGroupableSpan(span: NormalizedSpan): boolean {
  if (isSampleFrameSpan({ name: span.name })) return true;
  return /^transcribe turn\b/i.test(span.name) || /^turn\s+\d+/i.test(span.name);
}

export function buildGraphModel(
  spans: NormalizedSpan[],
  media: MediaAsset[] = [],
  expandedGroups: Set<string> = new Set(),
): { nodes: GraphNodeModel[]; edges: GraphEdgeModel[] } {
  const nodes: GraphNodeModel[] = [];
  const edges: GraphEdgeModel[] = [];
  const spanIds = new Set(spans.map((s) => s.id));

  // Media lineage nodes (left): prefer parent_id chains; else synthesize original → model-saw
  const mediaNodes: GraphNodeModel[] = [];
  if (media.length) {
    const byId = new Map(media.map((m) => [m.id, m]));
    const children = new Map<string, MediaAsset[]>();
    const roots: MediaAsset[] = [];
    for (const m of media) {
      if (m.parent_id && byId.has(m.parent_id)) {
        const arr = children.get(m.parent_id) || [];
        arr.push(m);
        children.set(m.parent_id, arr);
      } else roots.push(m);
    }
    const chains: MediaAsset[][] = [];
    const walk = (node: MediaAsset, path: MediaAsset[]) => {
      const next = [...path, node];
      const kids = children.get(node.id) || [];
      if (!kids.length) chains.push(next);
      else for (const k of kids) walk(k, next);
    };
    for (const r of roots) walk(r, []);

    const pushMediaNode = (
      id: string,
      label: string,
      m: MediaAsset,
      role: GraphNodeModel["mediaRole"],
      prevId: string | null,
    ): string => {
      mediaNodes.push({
        id,
        kind: "media",
        label,
        sublabel: m.mime || m.modality || undefined,
        type: "media",
        latencyMs: null,
        tokens: null,
        failed: false,
        sha: m.sha256 || m.id,
        mediaRole: role,
      });
      if (prevId) edges.push({ id: `${prevId}->${id}`, source: prevId, target: id });
      return id;
    };

    if (chains.some((c) => c.length > 1)) {
      const chain = chains.find((c) => c.length > 1) || chains[0];
      let prevId: string | null = null;
      chain.forEach((m, j) => {
        const role: GraphNodeModel["mediaRole"] =
          j === 0 ? "original" : j === chain.length - 1 ? "model-saw" : "transform";
        const label =
          role === "original"
            ? "original"
            : role === "model-saw"
              ? m.transformation
                ? `${m.transformation} · model saw`
                : "what the model saw"
              : m.transformation || "transform";
        prevId = pushMediaNode(`media:${m.id}`, label, m, role, prevId);
      });
    } else {
      // Flat assets (typical suite export): one lineage per asset
      for (const m of media) {
        const base = `media:${m.id}`;
        const orig = pushMediaNode(`${base}:orig`, "original", m, "original", null);
        const xfLabel = m.transformation && m.transformation !== "identity" && m.transformation !== "clean"
          ? m.transformation
          : null;
        let prev = orig;
        if (xfLabel) {
          prev = pushMediaNode(`${base}:xf`, xfLabel, m, "transform", prev);
        }
        pushMediaNode(`${base}:saw`, "what the model saw", m, "model-saw", prev);
      }
    }
  }

  // Group parallel frame/turn spans
  const groupable = spans.filter(isGroupableSpan);
  const groups = new Map<string, NormalizedSpan[]>();
  for (const s of groupable) {
    const key = `${(s.parentIds || []).slice().sort().join(",")}|${
      isSampleFrameSpan({ name: s.name }) ? "frame" : "turn"
    }`;
    const arr = groups.get(key) || [];
    arr.push(s);
    groups.set(key, arr);
  }

  const collapsedIds = new Set<string>();
  const groupNodes: GraphNodeModel[] = [];
  const groupIdByMember = new Map<string, string>();

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const gid = `group:${key}`;
    if (expandedGroups.has(gid)) continue;
    const tMs = members
      .map((m) => spanTMs({ attributes: m.attributes, metadata: m.attributes } as TraceSpan))
      .filter((n): n is number => n != null);
    const kind = isSampleFrameSpan({ name: members[0].name }) ? "frame" : "turn";
    let range = "";
    if (tMs.length) {
      const lo = Math.min(...tMs);
      const hi = Math.max(...tMs);
      range = `${(lo / 1000).toFixed(0)} to ${(hi / 1000).toFixed(0)} s`;
    } else {
      range = `${members.length} spans`;
    }
    groupNodes.push({
      id: gid,
      kind: "group",
      label: `${members.length} ${kind} spans · ${range}`,
      type: "media",
      latencyMs: null,
      tokens: null,
      failed: members.some((m) => !!m.error || (m.status || "").toLowerCase() === "error"),
      memberIds: members.map((m) => m.id),
    });
    for (const m of members) {
      collapsedIds.add(m.id);
      groupIdByMember.set(m.id, gid);
    }
  }

  const visibleSpans = spans.filter((s) => !collapsedIds.has(s.id));

  for (const s of visibleSpans) {
    const tok = (s.inputTokens || 0) + (s.outputTokens || 0);
    nodes.push({
      id: s.id,
      kind: "span",
      label: s.name,
      sublabel: s.type,
      type: s.type,
      latencyMs: s.latencyMs,
      tokens: tok || null,
      failed: !!s.error || (s.status || "").toLowerCase() === "error",
      spanId: s.id,
    });
  }
  nodes.push(...groupNodes);
  nodes.push(...mediaNodes);

  const resolveEndpoint = (id: string): string | null => {
    if (collapsedIds.has(id)) return groupIdByMember.get(id) || null;
    if (spanIds.has(id) || nodes.some((n) => n.id === id)) return id;
    return null;
  };

  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string) => {
    const key = `${source}->${target}`;
    if (source === target || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: key, source, target });
  };

  for (const s of spans) {
    if (collapsedIds.has(s.id)) continue;
    for (const p of s.parentIds) {
      const src = resolveEndpoint(p);
      if (src) addEdge(src, s.id);
    }
  }

  for (const g of groupNodes) {
    const members = (g.memberIds || []).map((id) => spans.find((s) => s.id === id)!).filter(Boolean);
    const parentIds = new Set<string>();
    for (const m of members) for (const p of m.parentIds) parentIds.add(p);
    for (const p of parentIds) {
      const src = resolveEndpoint(p);
      if (src) addEdge(src, g.id);
    }
    // children that pointed at members → point at group
    for (const s of visibleSpans) {
      if (s.parentIds.some((p) => collapsedIds.has(p) && groupIdByMember.get(p) === g.id)) {
        addEdge(g.id, s.id);
      }
    }
  }

  // Attach media "model saw" terminals into the span DAG roots / model
  if (mediaNodes.length) {
    const terminals = mediaNodes.filter((n) => n.mediaRole === "model-saw");
    const attachFrom = terminals.length ? terminals : [mediaNodes[mediaNodes.length - 1]];
    const roots = visibleSpans.filter((s) => {
      const resolved = s.parentIds.map(resolveEndpoint).filter(Boolean);
      return resolved.length === 0;
    });
    const model = visibleSpans.find((s) => s.type === "model");
    const attachTarget =
      model?.id ||
      roots[0]?.id ||
      groupNodes[0]?.id ||
      visibleSpans[0]?.id;
    if (attachTarget) {
      for (const m of attachFrom) addEdge(m.id, attachTarget);
    }
  }

  return { nodes, edges };
}

export function buildTimelineBars(spans: NormalizedSpan[]): TimelineBar[] {
  const withOffsets = spans.map((s) => ({
    ...s,
    startOffsetMs: s.startOffsetMs ?? 0,
    durationMs: Math.max(s.latencyMs ?? 40, 8),
  }));

  // Assign lanes for overlapping intervals
  const sorted = [...withOffsets].sort(
    (a, b) => (a.startOffsetMs || 0) - (b.startOffsetMs || 0) || a.name.localeCompare(b.name),
  );
  const laneEnds: number[] = [];
  const bars: TimelineBar[] = [];

  for (const s of sorted) {
    const start = s.startOffsetMs || 0;
    const end = start + s.durationMs;
    let lane = laneEnds.findIndex((e) => e <= start + 0.5);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    bars.push({
      id: s.id,
      label: s.name,
      type: s.type,
      startMs: start,
      durationMs: s.durationMs,
      lane,
      failed: !!s.error || (s.status || "").toLowerCase() === "error",
    });
  }
  return bars;
}

export async function fetchTraceEvents(
  traceId: string,
  signal?: AbortSignal,
): Promise<TraceEvent[]> {
  try {
    const { url, key, project } = apiConfig();
    const res = await fetch(`${url}/api/v1/traces/${encodeURIComponent(traceId)}/events`, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "X-Project": project || "default",
      },
      signal,
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data as TraceEvent[];
    if (data && Array.isArray(data.events)) return data.events as TraceEvent[];
    return [];
  } catch {
    return [];
  }
}

export type DateRangePreset = "all" | "24h" | "7d" | "30d" | "custom";

export type TraceListFilters = {
  q: string;
  outcome: string;
  model: string;
  modality: string;
  source: string;
  range: DateRangePreset;
  from: string;
  to: string;
  hasTools: boolean;
  needsReview: boolean;
  live: boolean;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
};

export const DEFAULT_LIST_FILTERS: TraceListFilters = {
  q: "",
  outcome: "all",
  model: "all",
  modality: "all",
  source: "all",
  range: "all",
  from: "",
  to: "",
  hasTools: false,
  needsReview: false,
  live: false,
  page: 1,
  pageSize: 50,
  sort: "time",
  dir: "desc",
};

function rangeBounds(range: DateRangePreset): { from?: string; to?: string } {
  if (range === "all" || range === "custom") return {};
  const to = new Date();
  const from = new Date(to);
  if (range === "24h") from.setHours(from.getHours() - 24);
  else if (range === "7d") from.setDate(from.getDate() - 7);
  else if (range === "30d") from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function filtersFromSearchParams(sp: URLSearchParams): TraceListFilters {
  const range = (sp.get("range") || "all") as DateRangePreset;
  const allowed: DateRangePreset[] = ["all", "24h", "7d", "30d", "custom"];
  return {
    q: sp.get("q") || "",
    outcome: sp.get("outcome") || "all",
    model: sp.get("model") || "all",
    modality: sp.get("modality") || "all",
    source: sp.get("source") || "all",
    range: allowed.includes(range) ? range : "all",
    from: sp.get("from") || "",
    to: sp.get("to") || "",
    hasTools: sp.get("tools") === "1",
    needsReview: sp.get("review") === "1",
    live: sp.get("live") === "1",
    page: Math.max(1, Number(sp.get("page") || 1) || 1),
    pageSize: Math.min(200, Math.max(10, Number(sp.get("pageSize") || 50) || 50)),
    sort: sp.get("sort") || "time",
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
  };
}

export function filtersToSearchParams(f: TraceListFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.outcome !== "all") sp.set("outcome", f.outcome);
  if (f.model !== "all") sp.set("model", f.model);
  if (f.modality !== "all") sp.set("modality", f.modality);
  if (f.source !== "all") sp.set("source", f.source);
  if (f.range !== "all") sp.set("range", f.range);
  if (f.range === "custom" && f.from) sp.set("from", f.from);
  if (f.range === "custom" && f.to) sp.set("to", f.to);
  if (f.hasTools) sp.set("tools", "1");
  if (f.needsReview) sp.set("review", "1");
  if (f.live) sp.set("live", "1");
  if (f.page > 1) sp.set("page", String(f.page));
  if (f.pageSize !== 50) sp.set("pageSize", String(f.pageSize));
  if (f.sort !== "time") sp.set("sort", f.sort);
  if (f.dir !== "desc") sp.set("dir", f.dir);
  return sp;
}

export function filterSortRows(rows: TraceListRow[], f: TraceListFilters): TraceListRow[] {
  let out = rows.filter((r) => {
    if (f.q) {
      const hay = `${r.title} ${r.inputPreview} ${r.outputPreview} ${r.id} ${r.tags.join(" ")} ${r.model}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    if (f.outcome !== "all" && (r.outcome || "") !== f.outcome) return false;
    if (f.model !== "all" && r.model !== f.model && r.agent !== f.model) return false;
    if (f.modality !== "all" && r.modality !== f.modality) return false;
    if (f.source !== "all" && r.source !== f.source) return false;
    if (f.hasTools && r.toolCalls <= 0) return false;
    if (f.needsReview && !r.needsReview) return false;
    const bounds =
      f.range === "custom"
        ? { from: f.from || undefined, to: f.to || undefined }
        : rangeBounds(f.range);
    if (bounds.from && r.time && r.time < bounds.from) return false;
    if (bounds.to && r.time && r.time > bounds.to) return false;
    return true;
  });

  const dir = f.dir === "asc" ? 1 : -1;
  const key = f.sort;
  out = [...out].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return out;
}

function sortValue(r: TraceListRow, key: string): string | number | null {
  switch (key) {
    case "time":
      return r.time || "";
    case "name":
    case "title":
      return r.title;
    case "outcome":
      return r.outcome || "";
    case "model":
      return r.model;
    case "latency":
      return r.latencyMs;
    case "tokens":
      return r.tokens;
    case "tools":
      return r.toolCalls;
    default:
      return r.time || r.title;
  }
}

export function typeColor(type: string): { bg: string; border: string; fg: string } {
  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const t = type.toLowerCase();
  if (dark) {
    if (t === "media" || t === "group")
      return { bg: "rgba(45,212,191,0.14)", border: "#2DD4BF", fg: "#2DD4BF" };
    if (t === "model") return { bg: "rgba(142,197,255,0.14)", border: "#8EC5FF", fg: "#B6DBFF" };
    if (t === "tool") return { bg: "rgba(245,158,11,0.14)", border: "#F59E0B", fg: "#F59E0B" };
    if (t === "evaluation")
      return { bg: "rgba(148,163,184,0.16)", border: "#94A3B8", fg: "#E6F1FF" };
    return { bg: "rgba(142,197,255,0.08)", border: "#26395A", fg: "#8CA0BC" };
  }
  if (t === "media" || t === "group")
    return { bg: "#E8F7F4", border: "#0B8F7A", fg: "#0B5F52" };
  if (t === "model") return { bg: "#EEF2FF", border: "#4F6BED", fg: "#2A3A9E" };
  if (t === "tool") return { bg: "#FFF4E5", border: "#D97706", fg: "#92400E" };
  if (t === "evaluation") return { bg: "#F3E8FF", border: "#9333EA", fg: "#6B21A8" };
  return { bg: "#F4F6F9", border: "#94A3B8", fg: "#334155" };
}

export function fmtMsShort(ms?: number | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
