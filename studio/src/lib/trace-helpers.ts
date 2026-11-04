import type { EvalResult, MediaAsset, Span, TraceDetail } from "@/lib/api";
import { mediaFileUrl } from "@/lib/api";

export type Box = [number, number, number, number];

export function sourceChipClass(source?: string | null) {
  const s = (source || "").toLowerCase();
  if (s === "sdk") return "border-teal/30 bg-teal/10 text-teal";
  if (s === "otlp") return "border-slateish/30 bg-slateish/10 text-slateish";
  if (s === "import") return "border-amber/30 bg-amber/10 text-amber";
  return "border-border bg-muted text-ink/70";
}

export function statusChipClass(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "pass") return "border-teal/30 bg-teal/10 text-teal";
  if (s === "error" || s === "failed" || s === "fail")
    return "border-crimson/30 bg-crimson/10 text-crimson";
  if (s === "running" || s === "pending") return "border-amber/30 bg-amber/10 text-amber";
  return "border-border bg-muted text-ink/70";
}

export function fmtMs(ms?: number | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function tokenTotal(input?: number | null, output?: number | null): string {
  const i = input ?? 0;
  const o = output ?? 0;
  if (!i && !o) return "—";
  return String(i + o);
}

export function buildMediaLineage(media: MediaAsset[] = []): MediaAsset[][] {
  if (!media.length) return [];
  const byId = new Map(media.map((m) => [m.id, m]));
  const children = new Map<string, MediaAsset[]>();
  const roots: MediaAsset[] = [];
  for (const m of media) {
    if (m.parent_id && byId.has(m.parent_id)) {
      const arr = children.get(m.parent_id) || [];
      arr.push(m);
      children.set(m.parent_id, arr);
    } else {
      roots.push(m);
    }
  }
  const chains: MediaAsset[][] = [];
  const walk = (node: MediaAsset, path: MediaAsset[]) => {
    const next = [...path, node];
    const kids = children.get(node.id) || [];
    if (!kids.length) chains.push(next);
    else for (const k of kids) walk(k, next);
  };
  for (const r of roots) walk(r, []);
  // orphan transformations without parent link: treat each as its own chain
  if (!chains.length) return media.map((m) => [m]);
  return chains;
}

export function resolveMediaSrc(m?: MediaAsset | null): string {
  if (!m) return "";
  if (m.url) return mediaFileUrl(m.url);
  return mediaFileUrl(m.id);
}

export function extractBoxes(results: EvalResult[] = []): {
  expected?: Box;
  claimed?: Box;
} {
  for (const r of results) {
    const evidence = Array.isArray(r.evidence) ? r.evidence : [];
    let expected: Box | undefined;
    let claimed: Box | undefined;
    for (const e of evidence) {
      if (!e || typeof e !== "object") continue;
      const row = e as { type?: string; role?: string; locator?: unknown };
      if (row.type !== "image_region" || !Array.isArray(row.locator) || row.locator.length < 4)
        continue;
      const box = row.locator.slice(0, 4).map(Number) as Box;
      if (row.role === "expected") expected = box;
      if (row.role === "claimed") claimed = box;
    }
    if (expected || claimed) return { expected, claimed };
  }
  return {};
}

export function stageLabel(results: EvalResult[] = []): string | null {
  const stage = results.find(
    (r) =>
      r.evaluator_id === "stage_attribution" ||
      r.evaluator_id === "audio_stage_attribution" ||
      (r.dimension || "").toLowerCase().includes("failure"),
  );
  return stage?.label || null;
}

export function toolSpans(spans: Span[] = []): Span[] {
  return spans.filter((s) => (s.type || "").toLowerCase() === "tool");
}

export function toolResultsForSpan(results: EvalResult[] = [], span: Span): EvalResult[] {
  const name = (span.name || "").toLowerCase();
  return results.filter((r) => {
    const eid = (r.evaluator_id || "").toLowerCase();
    const label = (r.label || "").toLowerCase();
    const expl = (r.explanation || "").toLowerCase();
    if (eid.startsWith("tool_") || eid.includes("tool_call") || eid.includes("tool-call"))
      return true;
    if (label.includes("acted_while_unsure")) return true;
    if (name && (expl.includes(name) || label.includes(name))) return true;
    return false;
  });
}

export function modelPromptOutput(trace: TraceDetail): { prompt: string; output: string } {
  const model = (trace.spans || []).find((s) => (s.type || "").toLowerCase() === "model");
  const prompt =
    stringifyMaybe(model?.input) ||
    stringifyMaybe(trace.input) ||
    "—";
  const output =
    stringifyMaybe(model?.output) ||
    stringifyMaybe(trace.output) ||
    "—";
  return { prompt, output };
}

function stringifyMaybe(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function parseToolArgs(span: Span): { name: string; args: unknown; result: unknown } {
  const input = span.input;
  const output = span.output;
  const attrs = span.attributes || {};
  let name = span.name || "tool";
  let args: unknown = input;
  let result: unknown = output;
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.name === "string") name = obj.name;
    if ("arguments" in obj) {
      try {
        args = typeof obj.arguments === "string" ? JSON.parse(obj.arguments) : obj.arguments;
      } catch {
        args = obj.arguments;
      }
    }
  }
  if (typeof attrs["gen_ai.tool.call.arguments"] === "string") {
    try {
      args = JSON.parse(attrs["gen_ai.tool.call.arguments"] as string);
    } catch {
      args = attrs["gen_ai.tool.call.arguments"];
    }
  }
  if (output && typeof output === "object" && "result" in (output as object)) {
    const r = (output as { result: unknown }).result;
    try {
      result = typeof r === "string" ? JSON.parse(r) : r;
    } catch {
      result = r;
    }
  } else if (typeof attrs["gen_ai.tool.call.result"] === "string") {
    try {
      result = JSON.parse(attrs["gen_ai.tool.call.result"] as string);
    } catch {
      result = attrs["gen_ai.tool.call.result"];
    }
  }
  return { name, args, result };
}
