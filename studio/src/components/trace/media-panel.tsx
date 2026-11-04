"use client";

import { useMemo, useState } from "react";
import type { CaseRow, RunRow, TraceRow } from "@/lib/types";

function center(box: [number, number, number, number]) {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] as const;
}

export function ImageEvidenceOverlay({
  caseRow,
  run,
  trace,
}: {
  caseRow?: CaseRow;
  run?: RunRow;
  trace?: TraceRow;
}) {
  const src =
    trace?.assets?.find((a) => a.modality === "image" && a.path)?.path ||
    caseRow?.image ||
    "";
  const truth = caseRow?.truth_box;
  const claimed = run?.box;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  if (!src) {
    return (
      <div className="rounded border border-dashed border-border bg-muted px-3 py-8 text-center text-xs text-ink/50">
        No image asset for this trace.
      </div>
    );
  }

  const truthCenter = truth ? center(truth) : null;
  const claimedCenter = claimed ? center(claimed) : null;

  return (
    <div className="space-y-2">
      <div className="relative inline-block max-w-full overflow-hidden rounded border border-border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={caseRow?.id || "case"}
          className="max-h-[480px] max-w-full object-contain"
          onLoad={(e) => {
            const img = e.currentTarget;
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        {natural ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {truth ? (
              <rect
                x={truth[0]}
                y={truth[1]}
                width={Math.max(1, truth[2] - truth[0])}
                height={Math.max(1, truth[3] - truth[1])}
                fill="rgba(11,143,122,0.15)"
                stroke="#0B8F7A"
                strokeWidth={8}
              />
            ) : null}
            {claimed ? (
              <rect
                x={claimed[0]}
                y={claimed[1]}
                width={Math.max(1, claimed[2] - claimed[0])}
                height={Math.max(1, claimed[3] - claimed[1])}
                fill="none"
                stroke="#D4285C"
                strokeWidth={8}
                strokeDasharray="18 12"
              />
            ) : null}
            {truthCenter && claimedCenter ? (
              <line
                x1={truthCenter[0]}
                y1={truthCenter[1]}
                x2={claimedCenter[0]}
                y2={claimedCenter[1]}
                stroke="#101B2D"
                strokeWidth={5}
                strokeOpacity={0.55}
              />
            ) : null}
          </svg>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-ink/60">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-teal" /> expected region
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-crimson" />{" "}
          claimed region
        </span>
      </div>
    </div>
  );
}

export function AudioEvidencePanel({
  caseRow,
  run,
}: {
  caseRow?: CaseRow;
  run?: RunRow;
}) {
  const audioSrc = caseRow?.audio || "";
  const turns = useMemo(() => caseRow?.turns || [], [caseRow?.turns]);
  const duration = useMemo(() => {
    const ends = turns.map((t) => t.end_ms || 0);
    const truthEnd = caseRow?.truth_span?.[1] || 0;
    const citedEnd = run?.span_ms?.[1] || 0;
    return Math.max(1, ...ends, truthEnd, citedEnd, 1);
  }, [turns, caseRow?.truth_span, run?.span_ms]);

  const asr = run?.asr_turns || {};

  return (
    <div className="space-y-3">
      {audioSrc ? (
        <audio controls src={audioSrc} className="w-full" />
      ) : (
        <div className="rounded border border-dashed border-border bg-muted px-3 py-4 text-xs text-ink/50">
          No audio file path on this case (mock / missing media).
        </div>
      )}

      <div className="space-y-2">
        <div className="relative h-10 rounded border border-border bg-white">
          {caseRow?.truth_span ? (
            <div
              className="absolute top-1 h-3 rounded-sm bg-teal/80"
              style={{
                left: `${(caseRow.truth_span[0] / duration) * 100}%`,
                width: `${Math.max(1, ((caseRow.truth_span[1] - caseRow.truth_span[0]) / duration) * 100)}%`,
              }}
              title="true span"
            />
          ) : null}
          {run?.span_ms ? (
            <div
              className="absolute bottom-1 h-3 rounded-sm bg-crimson/80"
              style={{
                left: `${(run.span_ms[0] / duration) * 100}%`,
                width: `${Math.max(1, ((run.span_ms[1] - run.span_ms[0]) / duration) * 100)}%`,
              }}
              title="cited span"
            />
          ) : null}
        </div>
        <div className="flex gap-3 text-[11px] text-ink/60">
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-teal" /> true span
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-crimson" /> cited span
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {turns.length === 0 ? (
          <p className="text-xs text-ink/50">No turns on this case.</p>
        ) : (
          turns.map((t, i) => {
            const key = String(t.index ?? i + 1);
            const asrText = asr[key] || asr[String(t.speaker_id)] || "";
            const left = ((t.start_ms || 0) / duration) * 100;
            const width = Math.max(1, (((t.end_ms || 0) - (t.start_ms || 0)) / duration) * 100);
            return (
              <div key={key} className="rounded border border-border bg-white p-2">
                <div className="mb-1 flex items-center justify-between text-[11px] text-ink/55">
                  <span>
                    turn {key} · speaker {t.speaker_id || "?"}
                  </span>
                  <span>
                    {t.start_ms ?? "?"}–{t.end_ms ?? "?"} ms
                  </span>
                </div>
                <div className="relative mb-2 h-2 rounded bg-muted">
                  <div
                    className="absolute h-2 rounded bg-slateish/70"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </div>
                <div className="grid gap-1 text-xs">
                  <div>
                    <span className="text-ink/45">true: </span>
                    {t.text || "—"}
                  </div>
                  <div>
                    <span className="text-ink/45">asr: </span>
                    {asrText || "—"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
