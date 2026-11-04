import type { CaseRow, RunRow, TraceRow, TraceSpan } from "@/lib/types";

export type VideoQuestionKind = "time" | "order" | "third" | "other";

export function videoQuestionKind(caseId: string): VideoQuestionKind {
  const part = caseId.split("_").pop() || "";
  if (part === "time" || part === "order" || part === "third") return part;
  return "other";
}

export function caseTruthSpan(caseRow?: CaseRow | null): [number, number] | null {
  if (!caseRow) return null;
  const span = caseRow.truth_span_ms || caseRow.truth_span;
  if (!span || span.length < 2) return null;
  const a = Number(span[0]);
  const b = Number(span[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return [a, b];
}

export function isSampleFrameSpan(span: { name?: string | null }): boolean {
  return /^sample frame\b/i.test(span.name || "");
}

export function spanTMs(span: TraceSpan): number | null {
  const attrs = span.attributes || span.metadata || {};
  const raw = attrs.t_ms ?? attrs.tMs;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function frameThumbPath(caseId: string, tMs: number, span?: TraceSpan): string {
  const attrs = span?.attributes || span?.metadata || {};
  const thumb = attrs.thumb;
  if (typeof thumb === "string" && thumb) return thumb;
  return `/media/video/frames/${caseId}_${tMs}.jpg`;
}

export function collectFrameSamples(trace?: TraceRow | null, caseId?: string) {
  const id = caseId || trace?.case_id || "";
  const frames: Array<{ spanId: string; tMs: number; src: string; name: string }> = [];
  for (const span of trace?.spans || []) {
    if (!isSampleFrameSpan(span)) continue;
    const tMs = spanTMs(span);
    if (tMs == null) continue;
    frames.push({
      spanId: span.id,
      tMs,
      src: frameThumbPath(id, tMs, span),
      name: span.name || `frame@${tMs}`,
    });
  }
  return frames.sort((a, b) => a.tMs - b.tMs);
}

export function isBlindVariant(variant?: string | null): boolean {
  const v = (variant || "").toLowerCase();
  return v === "blind" || v === "blind_guess" || v.startsWith("blind");
}

/** Seconds offset between agent answer and truth span start, when the question is temporal. */
export function offBySeconds(caseRow?: CaseRow | null, run?: RunRow | null): number | null {
  if (!caseRow || !run) return null;
  const kind = videoQuestionKind(caseRow.id);
  const isTime =
    kind === "time" ||
    (caseRow.answer_type || "").toLowerCase().includes("second") ||
    /^\d+(\.\d+)?$/.test(String(run.answer || "").trim());
  if (kind !== "time" && !isTime) return null;
  const truth = caseTruthSpan(caseRow);
  if (!truth) return null;
  const answered = parseFloat(String(run.answer ?? ""));
  if (!Number.isFinite(answered)) return null;
  const truthSec = truth[0] / 1000;
  return answered - truthSec;
}

export function videoSrc(caseRow?: CaseRow | null): string {
  const raw = caseRow?.video || "";
  if (!raw) return "";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function posterFrameSrc(caseRow?: CaseRow | null): string | null {
  if (!caseRow?.id) return null;
  // Prefer first event time, else t=0
  const t0 = caseRow.events?.[0]?.t_ms;
  const t = t0 != null && Number.isFinite(Number(t0)) ? Number(t0) : 0;
  return frameThumbPath(caseRow.id, Math.round(t));
}
