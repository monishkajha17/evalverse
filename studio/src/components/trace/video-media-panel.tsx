"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { OutcomeChip } from "@/components/outcome-chip";
import type { CaseRow, RunRow, TraceRow } from "@/lib/types";
import {
  caseTruthSpan,
  collectFrameSamples,
  isBlindVariant,
  offBySeconds,
  videoSrc,
} from "@/lib/video";

function pct(ms: number, duration: number) {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (ms / duration) * 100));
}

function formatSec(ms: number) {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

export function VideoMediaPanel({
  caseRow,
  run,
  trace,
  stageLabel,
}: {
  caseRow?: CaseRow;
  run?: RunRow;
  trace?: TraceRow;
  stageLabel?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [t, setT] = useState(0);
  const [durationMs, setDurationMs] = useState(caseRow?.duration_ms || 20000);
  const src = videoSrc(caseRow);
  const truth = caseTruthSpan(caseRow);
  const cited = run?.span_ms || null;
  const variant = trace?.variant || run?.condition || "";
  const blind = isBlindVariant(variant);
  const frames = useMemo(() => collectFrameSamples(trace, caseRow?.id), [trace, caseRow?.id]);
  const off = useMemo(() => offBySeconds(caseRow, run), [caseRow, run]);
  const events = caseRow?.events || [];

  useEffect(() => {
    if (caseRow?.duration_ms) setDurationMs(caseRow.duration_ms);
  }, [caseRow?.duration_ms]);

  const seek = (ms: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    setT(ms);
  };

  const citedHighlight = (tMs: number) => {
    if (!cited) return false;
    const lo = Math.min(cited[0], cited[1]);
    const hi = Math.max(cited[0], cited[1]);
    // point span: highlight nearest / equal
    if (hi - lo < 50) return Math.abs(tMs - lo) < 1000;
    return tMs >= lo && tMs <= hi;
  };

  return (
    <div className="space-y-4">
      {src ? (
        <video
          ref={videoRef}
          controls
          className="w-full max-h-[420px] rounded border border-border bg-black"
          src={src}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDurationMs(d * 1000);
          }}
        />
      ) : (
        <div className="rounded border border-dashed border-border bg-muted px-3 py-8 text-center text-xs text-ink/50">
          No video path on this case.
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-1.5">
        <div
          className="relative h-12 cursor-pointer rounded border border-border bg-white"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={durationMs}
          aria-valuenow={Math.round(t)}
          aria-label="Video timeline"
          tabIndex={0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            seek(x * durationMs);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(Math.min(durationMs, t + 500));
            if (e.key === "ArrowLeft") seek(Math.max(0, t - 500));
          }}
        >
          {/* frame ticks */}
          {frames.map((f) => (
            <button
              key={f.spanId}
              type="button"
              title={`frame ${formatSec(f.tMs)}`}
              className="absolute top-0 h-full w-px -translate-x-1/2 bg-grey/70 hover:bg-ink"
              style={{ left: `${pct(f.tMs, durationMs)}%` }}
              onClick={(e) => {
                e.stopPropagation();
                seek(f.tMs);
              }}
            />
          ))}

          {/* events */}
          {events.map((ev, i) => {
            const tMs = Number(ev.t_ms || 0);
            const left = pct(tMs, durationMs);
            const type = (ev.type || "").toLowerCase();
            if (type === "total" && truth) {
              return null; // TOTAL drawn from truth_span_ms
            }
            if (type === "tax") {
              return (
                <button
                  key={`ev-${i}`}
                  type="button"
                  title={`TAX @ ${formatSec(tMs)}`}
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-amber bg-amber/80"
                  style={{ left: `${left}%` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    seek(tMs);
                  }}
                />
              );
            }
            return (
              <button
                key={`ev-${i}`}
                type="button"
                title={`${ev.type || "item"} @ ${formatSec(tMs)}`}
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slateish"
                style={{ left: `${left}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  seek(tMs);
                }}
              />
            );
          })}

          {/* TOTAL truth span */}
          {truth ? (
            <div
              className="absolute top-1 h-3 rounded-sm bg-teal/85"
              style={{
                left: `${pct(truth[0], durationMs)}%`,
                width: `${Math.max(0.8, pct(truth[1] - truth[0], durationMs))}%`,
              }}
              title={`TOTAL ${formatSec(truth[0])}–${formatSec(truth[1])}`}
            />
          ) : null}

          {/* agent cited span */}
          {cited ? (
            <div
              className="absolute bottom-1 h-3 rounded-sm border border-dashed border-crimson bg-crimson/25"
              style={{
                left: `${pct(Math.min(cited[0], cited[1]), durationMs)}%`,
                width: `${Math.max(
                  0.8,
                  pct(Math.abs(cited[1] - cited[0]) || 400, durationMs),
                )}%`,
              }}
              title={`cited ${formatSec(cited[0])}–${formatSec(cited[1])}`}
            />
          ) : null}

          {/* playhead */}
          <div
            className="pointer-events-none absolute top-0 h-full w-0.5 bg-ink"
            style={{ left: `${pct(t, durationMs)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink/60">
          <span>
            <span className="mr-1 inline-block h-2 w-px bg-grey" /> sampled frames
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slateish" /> items
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rotate-45 bg-amber" /> TAX
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-4 rounded-sm bg-teal" /> TOTAL (truth)
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-4 rounded-sm border border-dashed border-crimson" />{" "}
            cited span
          </span>
          {off != null ? (
            <span className="font-medium text-crimson">
              off by {off >= 0 ? "+" : ""}
              {off.toFixed(1)} s
            </span>
          ) : null}
          <span className="ml-auto tabular-nums text-ink/45">
            {formatSec(t)} / {formatSec(durationMs)}
          </span>
        </div>
      </div>

      {/* Frames the model saw */}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
          Frames the model saw
        </div>
        {blind ? (
          <div className="rounded border border-dashed border-border bg-muted px-3 py-6 text-center text-xs text-ink/55">
            no frames sent
          </div>
        ) : frames.length === 0 ? (
          <p className="text-xs text-ink/50">No sample-frame spans on this trace.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {frames.map((f) => (
              <button
                key={f.spanId}
                type="button"
                onClick={() => seek(f.tMs)}
                className={`shrink-0 overflow-hidden rounded border text-left ${
                  citedHighlight(f.tMs)
                    ? "border-crimson ring-2 ring-crimson/30"
                    : "border-border"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.src}
                  alt={f.name}
                  className="h-16 w-24 bg-muted object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    (e.currentTarget.parentElement as HTMLElement).classList.add("opacity-40");
                  }}
                />
                <div className="px-1.5 py-0.5 font-mono text-[10px] text-ink/60">
                  {formatSec(f.tMs)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Q / expected / agent */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border border-border bg-white p-3">
          <div className="text-[11px] uppercase text-ink/45">Question</div>
          <p className="mt-1 text-sm text-ink">{caseRow?.question || "—"}</p>
        </div>
        <div className="rounded border border-border bg-white p-3">
          <div className="text-[11px] uppercase text-ink/45">Expected</div>
          <p className="mt-1 font-mono text-sm text-teal">{caseRow?.answer || "—"}</p>
        </div>
        <div className="rounded border border-border bg-white p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase text-ink/45">Agent answer</span>
            {stageLabel || run?.label ? <OutcomeChip label={stageLabel || run?.label} /> : null}
          </div>
          <p className="mt-1 font-mono text-sm text-ink">{run?.answer ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}
