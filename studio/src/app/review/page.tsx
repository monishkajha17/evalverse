"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { VerdictChip } from "@/components/outcome-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiMode } from "@/context/api-mode";
import {
  createReview,
  getCalibration,
  getTrace,
  listEvaluators,
  mediaFileUrl,
  reviewsQueue,
  type Calibration,
  type ReviewQueueItem,
} from "@/lib/api";

export default function ReviewPage() {
  const { mode } = useApiMode();
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluatorId, setEvaluatorId] = useState("evidence_grounding");
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [evals, setEvals] = useState<string[]>([]);
  const [mediaByTrace, setMediaByTrace] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    if (mode !== "live") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [q, evs] = await Promise.all([reviewsQueue(), listEvaluators()]);
      setQueue(q);
      setEvals(evs.map((e) => e.id));
      if (!evals.includes(evaluatorId) && evs[0]) setEvaluatorId(evs[0].id);
      const media: Record<string, string> = {};
      for (const item of q.slice(0, 12)) {
        const tid = item.result.trace_id;
        if (!tid || media[tid]) continue;
        try {
          const tr = await getTrace(tid);
          const m = tr.media?.[0];
          if (m) media[tid] = mediaFileUrl(m.url || m.id);
        } catch {
          /* skip */
        }
      }
      setMediaByTrace(media);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "live" || !evaluatorId) return;
    getCalibration(evaluatorId)
      .then(setCalibration)
      .catch(() => setCalibration(null));
  }, [mode, evaluatorId]);

  return (
    <>
      <Topbar title="Review" />
      <main className="space-y-4 p-4">
        {mode === "snapshot" ? (
          <EmptyBlock title="Live mode required" detail="Review queue comes from the API." />
        ) : null}
        {msg ? <div className="rounded border border-teal/30 bg-teal/5 px-3 py-2 text-xs text-teal">{msg}</div> : null}
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Error" detail={error} /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Calibration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <select
              className="h-8 rounded border border-border px-2"
              value={evaluatorId}
              onChange={(e) => setEvaluatorId(e.target.value)}
            >
              {evals.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            {calibration ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="n" value={String(calibration.n)} />
                <Stat
                  label="Agreement"
                  value={
                    calibration.agreement_rate == null
                      ? "—"
                      : `${Math.round(calibration.agreement_rate * 100)}%`
                  }
                />
                <Stat
                  label="Cohen's κ"
                  value={
                    calibration.cohens_kappa == null ? "—" : calibration.cohens_kappa.toFixed(3)
                  }
                />
              </div>
            ) : (
              <p className="text-ink/50">No calibration data for this evaluator yet.</p>
            )}
            {calibration?.confusion && Object.keys(calibration.confusion).length > 0 ? (
              <pre className="mono max-h-48 overflow-auto rounded bg-paper p-2 text-[10px]">
                {JSON.stringify(calibration.confusion, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>

        {!loading && mode === "live" && queue.length === 0 ? (
          <EmptyBlock title="Review queue empty" />
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          {queue.slice(0, 40).map((item) => {
            const r = item.result;
            const src = r.trace_id ? mediaByTrace[r.trace_id] : "";
            return (
              <Card key={r.id}>
                <CardContent className="space-y-2 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.evaluator_id}</span>
                    <VerdictChip verdict={r.verdict} />
                    <Badge className="border-border bg-muted">priority {item.priority ?? "—"}</Badge>
                  </div>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="max-h-40 w-full rounded border object-contain" />
                  ) : null}
                  <p className="text-ink/70">{r.explanation}</p>
                  <div className="flex flex-wrap gap-1">
                    {(item.reasons || []).map((reason) => (
                      <Badge key={reason} className="border-amber/30 bg-amber/10 text-amber">
                        {reason}
                      </Badge>
                    ))}
                  </div>
                  {r.trace_id ? (
                    <Link
                      className="text-teal hover:underline"
                      href={`/traces/view/?id=${encodeURIComponent(r.trace_id)}`}
                    >
                      Open trace
                    </Link>
                  ) : null}
                  <div className="flex gap-2 pt-1">
                    {(["pass", "fail", "unsure"] as const).map((v) => (
                      <Button
                        key={v}
                        size="sm"
                        variant={v === "pass" ? "teal" : "outline"}
                        onClick={async () => {
                          await createReview({
                            result_id: r.id,
                            verdict: v,
                            label: v,
                            notes: `studio review: ${v}`,
                          });
                          setMsg(`Reviewed ${r.id.slice(0, 12)}… as ${v}`);
                          reload();
                        }}
                      >
                        {v}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-paper/60 px-2 py-2">
      <div className="text-[11px] uppercase text-ink/45">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
