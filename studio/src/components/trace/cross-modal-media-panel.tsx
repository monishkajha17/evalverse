"use client";

import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CaseRow, RunRow } from "@/lib/types";

const STAGE_SENTENCE: Record<string, string> = {
  cross_modal_correct: "The agent compared both sides correctly.",
  heard_wrong: "The agent mis-heard the spoken claim.",
  misread_image: "The agent misread the receipt value.",
  comparison_error: "The agent read both values correctly but compared them wrongly.",
  abstained: "The agent declined to decide.",
  both_wrong: "The agent mis-heard the claim and misread the receipt.",
  invalid_output: "The agent returned an invalid or incomplete verdict.",
};

const ERROR_CHIP: Record<string, string> = {
  missed_contradiction: "missed contradiction",
  false_alarm: "false alarm",
  abstained: "abstained",
  none: "",
};

function MatchMark({ ok }: { ok: boolean | null }) {
  if (ok == null) return <span className="text-ink/40">·</span>;
  return ok ? (
    <Check className="inline h-3.5 w-3.5 text-teal" aria-label="match" />
  ) : (
    <X className="inline h-3.5 w-3.5 text-crimson" aria-label="mismatch" />
  );
}

function perceptionTicks(label?: string | null): { saidOk: boolean | null; imageOk: boolean | null } {
  const l = (label || "").toLowerCase();
  if (l === "both_read" || l === "cross_modal_correct" || l === "comparison_error") {
    return { saidOk: true, imageOk: true };
  }
  if (l === "heard_wrong") return { saidOk: false, imageOk: true };
  if (l === "misread_image") return { saidOk: true, imageOk: false };
  if (l === "both_wrong") return { saidOk: false, imageOk: false };
  if (l === "abstained") return { saidOk: null, imageOk: null };
  return { saidOk: null, imageOk: null };
}

export function CrossModalMediaPanel({
  caseRow,
  run,
  perceptionLabel,
}: {
  caseRow?: CaseRow;
  run?: RunRow;
  /** From cross_modal_perception / stage_attribution result label. */
  perceptionLabel?: string | null;
}) {
  const audioSrc = caseRow?.audio || "";
  const imageSrc = caseRow?.image || "";
  const claimText = caseRow?.claim_text || "";
  const transcript = run?.transcript || claimText || "";
  const claimValue = caseRow?.claim_value ?? "—";
  const claimedValue = run?.claimed_value ?? "—";
  const receiptValue = caseRow?.receipt_value ?? "—";
  const imageValue = run?.image_value ?? "—";
  const truth = caseRow?.truth_box;
  const agentBox = run?.image_box || run?.box;
  const stage = (run?.label || perceptionLabel || "").toLowerCase();
  const expected = (run?.expected_verdict || caseRow?.expected_verdict || "").toLowerCase();
  const got = (run?.verdict || "").toLowerCase();
  const errorType = (run?.error_type || "").toLowerCase();
  const ticks = perceptionTicks(perceptionLabel || run?.label);
  const sentence =
    STAGE_SENTENCE[stage] ||
    (stage ? `Stage: ${stage.replace(/_/g, " ")}.` : "No stage label on this run.");
  const errorChip = ERROR_CHIP[errorType] || (errorType && errorType !== "none" ? errorType.replace(/_/g, " ") : "");
  const verdictOk = expected && got ? expected === got : null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-white px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-ink">
            Agent: <span className="tabular-nums">{got || "—"}</span>
          </span>
          <span className="text-ink/40">vs</span>
          <span className="text-ink/70">
            expected <span className="tabular-nums">{expected || "—"}</span>
          </span>
          {verdictOk != null ? <MatchMark ok={verdictOk} /> : null}
          {errorChip ? (
            <Badge className="border-crimson/30 bg-crimson/10 text-crimson">{errorChip}</Badge>
          ) : null}
          {stage ? (
            <Badge className="border-border bg-muted text-ink/70">{stage.replace(/_/g, " ")}</Badge>
          ) : null}
        </div>
        <p className="mt-1.5 text-xs text-ink/65">{sentence}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border bg-paper/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">What was said</p>
          {audioSrc ? (
            <audio controls src={audioSrc} className="w-full" preload="metadata" />
          ) : claimText ? (
            <p className="rounded border border-dashed border-border bg-white px-2.5 py-2 text-sm text-ink">
              {claimText}
            </p>
          ) : (
            <p className="text-xs text-ink/45">No audio or claim text.</p>
          )}
          {transcript ? (
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-ink/40">Transcript</p>
              <p className="text-xs text-ink/80">{transcript}</p>
            </div>
          ) : null}
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink/75">
            <span>
              Said: <span className="font-medium tabular-nums text-ink">{String(claimValue)}</span>
            </span>
            <span className="text-ink/35">·</span>
            <span>
              Agent heard:{" "}
              <span className="font-medium tabular-nums text-ink">{String(claimedValue)}</span>
            </span>
            <MatchMark ok={ticks.saidOk} />
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-paper/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            What the receipt shows
          </p>
          {imageSrc ? (
            <CrossModalReceiptImage src={imageSrc} truth={truth} agentBox={agentBox} />
          ) : (
            <p className="rounded border border-dashed border-border bg-muted px-3 py-8 text-center text-xs text-ink/50">
              No receipt image (no-image control).
            </p>
          )}
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink/75">
            <span>
              Receipt:{" "}
              <span className="font-medium tabular-nums text-ink">{String(receiptValue)}</span>
            </span>
            <span className="text-ink/35">·</span>
            <span>
              Agent read:{" "}
              <span className="font-medium tabular-nums text-ink">{String(imageValue)}</span>
            </span>
            <MatchMark ok={ticks.imageOk} />
          </p>
        </div>
      </div>
    </div>
  );
}

function CrossModalReceiptImage({
  src,
  truth,
  agentBox,
}: {
  src: string;
  truth?: [number, number, number, number] | null;
  agentBox?: [number, number, number, number] | null;
}) {
  return (
    <div className="relative inline-block max-w-full overflow-hidden rounded border border-border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Receipt" className="max-h-[320px] max-w-full object-contain" />
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
            fill="rgba(11,143,122,0.18)"
            stroke="#0B8F7A"
            strokeWidth={8}
          />
        ) : null}
        {agentBox ? (
          <rect
            x={agentBox[0]}
            y={agentBox[1]}
            width={Math.max(1, agentBox[2] - agentBox[0])}
            height={Math.max(1, agentBox[3] - agentBox[1])}
            fill="none"
            stroke="#D4285C"
            strokeWidth={8}
            strokeDasharray="18 12"
          />
        ) : null}
      </svg>
      <div className="absolute bottom-1 left-1 flex flex-wrap gap-2 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-ink/65">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-teal" />
          true region
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-crimson" />
          agent box
        </span>
      </div>
    </div>
  );
}
