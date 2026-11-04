"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
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
import { judgeTrust } from "@/lib/metrics";
import { pct } from "@/lib/utils";

type DemoItem = {
  id: string;
  caseId: string;
  question: string;
  media?: string | null;
  verdict: string;
  label?: string | null;
  explanation?: string | null;
  evaluatorId: string;
};

export default function HumanReviewPage() {
  const { mode } = useApiMode();
  const { data, reload: reloadSuite } = useSuite();
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [demoQueue, setDemoQueue] = useState<DemoItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluatorId, setEvaluatorId] = useState("evidence_grounding");
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [mediaByTrace, setMediaByTrace] = useState<Record<string, string>>({});
  const [localReviewed, setLocalReviewed] = useState(0);
  const [localAgree, setLocalAgree] = useState(0);

  const buildDemo = useCallback(() => {
    const items: DemoItem[] = [];
    for (const r of (data.results || []).slice(0, 40)) {
      if (r.status !== "completed") continue;
      const c = data.cases.find((x) => x.id === r.target.case_id);
      items.push({
        id: r.id,
        caseId: r.target.case_id,
        question: c?.question || r.target.case_id,
        media: c?.image || c?.video || null,
        verdict: r.verdict || "—",
        label: r.label,
        explanation: r.explanation,
        evaluatorId: r.evaluator_id,
      });
    }
    setDemoQueue(items);
    setIdx(0);
  }, [data]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode !== "live") {
        buildDemo();
        const trust = judgeTrust(data.judged || []);
        setCalibration({
          evaluator_id: "judge_audit",
          n: trust.n,
          agreement_rate:
            trust.n > 0
              ? (trust.trueAccept + trust.trueReject) / trust.n
              : null,
          cohens_kappa: null,
        });
        return;
      }
      const [q, evs] = await Promise.all([reviewsQueue(), listEvaluators()]);
      setQueue(q);
      if (evs[0] && !evs.find((e) => e.id === evaluatorId)) setEvaluatorId(evs[0].id);
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
      setIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load review queue");
      buildDemo();
    } finally {
      setLoading(false);
    }
  }, [mode, buildDemo, data.judged, evaluatorId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (mode !== "live" || !evaluatorId) return;
    getCalibration(evaluatorId)
      .then(setCalibration)
      .catch(() => setCalibration(null));
  }, [mode, evaluatorId]);

  const liveItem = queue[idx];
  const demoItem = demoQueue[idx];
  const total = mode === "live" ? queue.length : demoQueue.length;

  const submit = useCallback(
    async (decision: "agree" | "disagree" | "skip") => {
      if (mode === "live" && liveItem?.result?.id) {
        try {
          if (decision !== "skip") {
            await createReview({
              result_id: liveItem.result.id,
              verdict: decision === "agree" ? "agree" : "disagree",
              label: decision,
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save review");
          return;
        }
      } else if (decision !== "skip") {
        setLocalReviewed((n) => n + 1);
        if (decision === "agree") setLocalAgree((n) => n + 1);
      }
      if (idx >= total - 1) {
        await reload();
        setIdx(0);
      } else {
        setIdx((i) => i + 1);
      }
    },
    [mode, liveItem, total, idx, reload],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "a") submit("agree");
      if (k === "d") submit("disagree");
      if (k === "s") submit("skip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const mediaSrc = useMemo(() => {
    if (mode === "live" && liveItem?.result?.trace_id) {
      return mediaByTrace[liveItem.result.trace_id];
    }
    return demoItem?.media || undefined;
  }, [mode, liveItem, mediaByTrace, demoItem]);

  const calN = calibration?.n ?? localReviewed;
  const calAgree =
    calibration?.agreement_rate ?? (localReviewed ? localAgree / localReviewed : null);

  return (
    <>
      <Topbar title="Human review" />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
        <PageHeader
          title="Human review"
          description="Check the media, read the evaluator’s verdict, then agree or disagree. Shortcuts: A agree, D disagree, S skip."
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => (mode === "live" ? reload() : reloadSuite())}>
              Refresh queue
            </Button>
          }
        />

        <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
          <div className="space-y-3">
            <FilterBar>
              <span className="text-xs text-ink/55">
                Item {total ? Math.min(idx + 1, total) : 0} of {total}
              </span>
            </FilterBar>
            {loading ? <SkeletonBlock rows={6} /> : null}
            {error ? <ErrorState detail={error} onRetry={reload} /> : null}
            {!loading && total === 0 ? (
              <EmptyState
                title="Review queue is empty"
                detail="When evaluators finish scoring traces, items needing a human check will appear here."
              />
            ) : null}
            {!loading && total > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Media</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {mediaSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaSrc} alt="" className="max-h-80 w-full rounded border object-contain" />
                    ) : (
                      <div className="flex h-48 items-center justify-center rounded border border-dashed text-xs text-ink/45">
                        No media preview
                      </div>
                    )}
                    <p className="mt-3 text-xs text-ink/60">
                      {mode === "live"
                        ? liveItem?.result?.trace_id || "Trace"
                        : demoItem?.question}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Evaluator verdict</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge className="border-border bg-muted">
                        {mode === "live"
                          ? liveItem?.result?.evaluator_id
                          : demoItem?.evaluatorId}
                      </Badge>
                      <Badge className="border-teal/30 bg-teal/10 text-teal">
                        {mode === "live"
                          ? liveItem?.result?.verdict || "—"
                          : demoItem?.verdict}
                      </Badge>
                      {(mode === "live" ? liveItem?.result?.label : demoItem?.label) ? (
                        <Badge className="border-border bg-white">
                          {mode === "live" ? liveItem?.result?.label : demoItem?.label}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-ink/65">
                      {mode === "live"
                        ? liveItem?.result?.explanation || "No explanation provided."
                        : demoItem?.explanation || "No explanation provided."}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button type="button" onClick={() => submit("agree")}>
                        Agree <span className="ml-1 text-[10px] opacity-60">A</span>
                      </Button>
                      <Button type="button" variant="outline" onClick={() => submit("disagree")}>
                        Disagree <span className="ml-1 text-[10px] opacity-60">D</span>
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => submit("skip")}>
                        Skip <span className="ml-1 text-[10px] opacity-60">S</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-sm">Calibration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink/55">Reviewed</span>
                <span className="tabular-nums font-medium">{calN}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Agreement</span>
                <span className="tabular-nums font-medium">{pct(calAgree, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Cohen’s kappa</span>
                <span className="tabular-nums font-medium">
                  {calibration?.cohens_kappa != null
                    ? calibration.cohens_kappa.toFixed(2)
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
