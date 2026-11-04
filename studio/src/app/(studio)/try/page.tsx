"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Upload, X } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMode } from "@/context/api-mode";
import {
  createPlaygroundRun,
  getPlaygroundRun,
  listEvaluators,
  listProviders,
  playgroundErrorInfo,
  type Evaluator,
  type PlaygroundRunDetail,
  type Provider,
} from "@/lib/api";
import { readSession } from "@/lib/session";
import { cn, pct } from "@/lib/utils";

const EXAMPLE_CHIPS = [
  "Describe this and list what you see",
  "What is the total on this receipt?",
  "What is said, and by whom?",
] as const;

const ACCEPT = "image/png,image/jpeg,image/webp,audio/wav,audio/mpeg,audio/mp4,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.wav,.mp3,.m4a,.mp4,.webm";

type LocalFile = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "audio" | "video" | "other";
};

type RecordedExample = {
  id: string;
  modality: string;
  title: string;
  question: string;
  media_url: string;
  answer: string;
  trace_id: string;
  claim_grounding: {
    score: number;
    label: string;
    groundedness: number;
    hallucination: number;
    completeness: number | null;
    completeness_skipped?: boolean;
    completeness_reason?: string;
    claims: Array<{
      claim: string;
      verdict: string;
      explanation: string;
      evidence_box: number[] | null;
    }>;
  };
};

type StageId = "media" | "sense" | "model" | "eval" | "done";

function fileKind(file: File): LocalFile["kind"] {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) return "image";
  if (file.type.startsWith("audio/") || /\.(wav|mp3|m4a)$/i.test(file.name)) return "audio";
  if (file.type.startsWith("video/") || /\.(mp4|webm)$/i.test(file.name)) return "video";
  return "other";
}

function deriveStages(detail: PlaygroundRunDetail | null, running: boolean): Record<StageId, "pending" | "active" | "done"> {
  const out: Record<StageId, "pending" | "active" | "done"> = {
    media: "pending",
    sense: "pending",
    model: "pending",
    eval: "pending",
    done: "pending",
  };
  if (!detail && running) {
    out.media = "active";
    return out;
  }
  if (!detail) return out;
  const traces = detail.traces || [];
  const spans = traces.flatMap((t) => t.spans || []);
  const names = spans.map((s) => String(s.name || "").toLowerCase());
  const hasMedia = names.some((n) => n.includes("attach"));
  const hasSense =
    names.some((n) => n.includes("transcribe")) || names.some((n) => n.startsWith("sample frame"));
  const hasModel = names.some((n) => n.includes("model")) || !!detail.answer;
  const hasResults = (detail.results || []).length > 0;
  const completed = detail.status === "completed";
  const failed = detail.status === "failed";

  out.media = hasMedia || hasSense || hasModel || completed ? "done" : running ? "active" : "pending";
  out.sense =
    hasSense || hasModel || completed
      ? "done"
      : out.media === "done" && running
        ? "active"
        : "pending";
  out.model =
    hasModel || completed ? "done" : out.sense === "done" && running ? "active" : "pending";
  out.eval =
    completed || hasResults
      ? "done"
      : out.model === "done" && running
        ? "active"
        : "pending";
  out.done = completed ? "done" : failed ? "done" : "pending";
  return out;
}

function verdictChipClass(verdict: string) {
  const v = verdict.toLowerCase();
  if (v === "supported") return "border-teal/40 bg-teal/10 text-teal";
  if (v === "contradicted") return "border-crimson/40 bg-crimson/10 text-crimson";
  return "border-amber/40 bg-amber/10 text-amber";
}

function ClaimImageOverlay({
  src,
  boxes,
}: {
  src: string;
  boxes: Array<{ box: number[]; label: string; n: number }>;
}) {
  return (
    <div className="relative inline-block max-w-full overflow-hidden rounded border border-border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Upload" className="max-h-[360px] max-w-full object-contain" />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
      >
        {boxes.map(({ box, n }) => (
          <g key={n}>
            <rect
              x={box[0]}
              y={box[1]}
              width={Math.max(1, box[2] - box[0])}
              height={Math.max(1, box[3] - box[1])}
              fill="rgba(212,40,92,0.12)"
              stroke="#D4285C"
              strokeWidth={6}
            />
            <text
              x={box[0] + 8}
              y={Math.max(24, box[1] - 8)}
              fill="#D4285C"
              fontSize={28}
              fontWeight={700}
            >
              {n}
            </text>
          </g>
        ))}
      </svg>
      <p className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-ink/70">
        judge-claimed evidence
      </p>
    </div>
  );
}

export default function TryPage() {
  const { mode, liveAvailable, checking, hostLabel } = useApiMode();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [question, setQuestion] = useState("");
  const [agentModel, setAgentModel] = useState("muse-spark-1.3");
  const [judgeModel, setJudgeModel] = useState("muse-wonder-1.0");
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>(["claim_grounding"]);
  const [degrade, setDegrade] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dailyRemaining, setDailyRemaining] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlaygroundRunDetail | null>(null);
  const [recorded, setRecorded] = useState<RecordedExample[]>([]);
  const [exampleId, setExampleId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const signedIn = !!sessionEmail;
  const serverDown = !checking && !liveAvailable;

  useEffect(() => {
    setSessionEmail(readSession()?.email || null);
  }, [mode, liveAvailable]);

  useEffect(() => {
    fetch("/data/playground-examples.json")
      .then((r) => r.json())
      .then((j) => setRecorded(j.examples || []))
      .catch(() => setRecorded([]));
  }, []);

  useEffect(() => {
    if (!liveAvailable) return;
    let cancelled = false;
    Promise.all([listProviders(), listEvaluators()])
      .then(([p, e]) => {
        if (cancelled) return;
        setProviders(p);
        setEvaluators(e);
        const models = p.flatMap((x) => (x.models || []).map((m) => m.id));
        if (models.includes("muse-spark-1.3")) setAgentModel("muse-spark-1.3");
        else if (models[0]) setAgentModel(models[0]);
        if (models.includes("muse-wonder-1.0")) setJudgeModel("muse-wonder-1.0");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [liveAvailable]);

  useEffect(() => {
    return () => {
      files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const agentModels = useMemo(
    () => providers.flatMap((p) => (p.models || []).map((m) => m.id)),
    [providers],
  );
  const judgeModels = useMemo(() => {
    const all = agentModels;
    const prefer = all.filter((m) => /wonder|judge|spark/i.test(m));
    return prefer.length ? prefer : all;
  }, [agentModels]);

  const rubricEvals = useMemo(
    () =>
      evaluators.filter(
        (e) =>
          e.id !== "claim_grounding" &&
          (e.type === "rubric" || e.category === "rubric" || e.source === "user"),
      ),
    [evaluators],
  );

  const hasImage = files.some((f) => f.kind === "image");

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    setFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (next.length >= 4) break;
        const kind = fileKind(file);
        if (kind === "other") continue;
        next.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          kind,
        });
      }
      return next;
    });
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const hit = prev.find((f) => f.id === id);
      if (hit) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPoll = useCallback((id: string) => {
    stopPoll();
    const tick = async () => {
      try {
        const d = await getPlaygroundRun(id);
        setDetail(d);
        if (d.status === "completed" || d.status === "failed") {
          setBusy(false);
          stopPoll();
          if (d.status === "failed") {
            setError(d.error?.message || "Playground run failed");
          }
        }
      } catch (e) {
        setBusy(false);
        stopPoll();
        setError(e instanceof Error ? e.message : "Poll failed");
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 1500);
  }, []);

  const onRun = async () => {
    setError(null);
    setExampleId(null);
    setDetail(null);
    if (!question.trim()) {
      setError("Enter a question.");
      return;
    }
    if (!files.length) {
      setError("Add at least one image, audio, or video file.");
      return;
    }
    if (!liveAvailable) {
      setError("Server unreachable. Sign in or browse a recorded example.");
      return;
    }
    const form = new FormData();
    form.append("question", question.trim());
    form.append("agent_model", agentModel);
    form.append("judge_model", judgeModel);
    for (const eid of evaluatorIds) form.append("evaluator_ids", eid);
    if (degrade && hasImage) {
      form.append("conditions", "clean");
      form.append("conditions", "blur");
      form.append("conditions", "noise");
    } else if (hasImage) {
      form.append("conditions", "clean");
    }
    for (const f of files) form.append("files", f.file, f.file.name);

    setBusy(true);
    try {
      const created = await createPlaygroundRun(form);
      setRunId(created.run_id);
      startPoll(created.run_id);
    } catch (e) {
      setBusy(false);
      const info = playgroundErrorInfo(e);
      setError(info.message);
      if (info.remaining !== null) setDailyRemaining(info.remaining);
    }
  };

  const activeExample = recorded.find((e) => e.id === exampleId) || null;
  const stages = deriveStages(detail, busy);
  const claimResult = (detail?.results || []).find((r) => r.evaluator_id === "claim_grounding");
  const claimMeta = (claimResult?.meta || {}) as Record<string, unknown>;
  const liveClaims = (Array.isArray(claimMeta.claims) ? claimMeta.claims : []) as Array<{
    claim?: string;
    verdict?: string;
    explanation?: string;
    evidence_box?: number[] | null;
    status?: string;
  }>;

  const previewImage = files.find((f) => f.kind === "image")?.previewUrl;
  const evidenceBoxes = liveClaims
    .map((c, i) =>
      Array.isArray(c.evidence_box) && c.evidence_box.length === 4 && c.verdict === "supported"
        ? { box: c.evidence_box as number[], label: c.claim || "", n: i + 1 }
        : null,
    )
    .filter(Boolean) as Array<{ box: number[]; label: string; n: number }>;

  const showSignInPrompt = serverDown || !signedIn;

  return (
    <>
      <Topbar title="Try it" />
      <main className="grid gap-4 p-4 xl:grid-cols-2">
        {showSignInPrompt ? (
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>{serverDown ? "Server unreachable" : "Sign in to run live"}</CardTitle>
              <CardDescription>
                {checking
                  ? "Checking the API…"
                  : serverDown
                    ? `No response from ${hostLabel}. You can still browse a recorded example.`
                    : "Sign in for a project-scoped playground run, or connect an API key under Settings."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button asChild variant="teal">
                <Link href="/signin/">Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/signup/">Create account</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/settings/">Connect a server</Link>
              </Button>
              {recorded[0] ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setExampleId(recorded[0].id);
                    setDetail(null);
                    setRunId(null);
                    setError(null);
                  }}
                >
                  Browse a recorded example
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {serverDown ? (
          <div className="xl:col-span-2">
            {exampleId && activeExample ? null : (
              <Card>
                <CardContent className="flex flex-wrap gap-2 py-6">
                  {recorded.map((ex) => (
                    <Button
                      key={ex.id}
                      type="button"
                      variant="outline"
                      onClick={() => setExampleId(ex.id)}
                    >
                      {ex.title}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}
            {activeExample ? (
              <ResultPanel
                answer={activeExample.answer}
                claims={activeExample.claim_grounding.claims}
                groundedness={activeExample.claim_grounding.groundedness}
                hallucination={activeExample.claim_grounding.hallucination}
                completeness={activeExample.claim_grounding.completeness}
                completenessSkipped={activeExample.claim_grounding.completeness_skipped}
                completenessReason={activeExample.claim_grounding.completeness_reason}
                imageSrc={activeExample.modality === "image" ? activeExample.media_url : null}
                audioSrc={activeExample.modality === "audio" ? activeExample.media_url : null}
                traceId={activeExample.trace_id}
                examplePicker={
                  <div className="flex flex-wrap gap-2">
                    {recorded.map((ex) => (
                      <Button
                        key={ex.id}
                        type="button"
                        size="sm"
                        variant={ex.id === exampleId ? "default" : "outline"}
                        onClick={() => setExampleId(ex.id)}
                      >
                        {ex.title}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : null}
          </div>
        ) : null}

        {/* Live composer + results */}
        {!serverDown ? (
        <>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload</CardTitle>
              <CardDescription>Up to 4 files · images, audio, or video</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors hover:border-teal/50 hover:bg-teal/5"
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                }}
              >
                <Upload className="h-5 w-5 text-ink/45" />
                <p className="text-sm text-ink/70">Drop files here or click to browse</p>
                <p className="text-[11px] text-ink/45">png · jpg · webp · wav · mp3 · m4a · mp4 · webm</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {files.length ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {files.map((f) => (
                    <li key={f.id} className="relative overflow-hidden rounded border border-border bg-white">
                      <button
                        type="button"
                        className="absolute right-1 top-1 z-10 rounded bg-white/90 p-0.5 text-ink/60 hover:text-ink"
                        onClick={() => removeFile(f.id)}
                        aria-label={`Remove ${f.file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                      {f.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.previewUrl} alt="" className="h-28 w-full object-cover" />
                      ) : f.kind === "audio" ? (
                        <div className="p-2">
                          <audio controls src={f.previewUrl} className="w-full" />
                        </div>
                      ) : (
                        <video controls src={f.previewUrl} className="h-28 w-full object-cover" />
                      )}
                      <p className="truncate px-2 py-1 text-[10px] text-ink/55">{f.file.name}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Question</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, 2000))}
                rows={3}
                placeholder="Ask something about the media…"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal/30"
              />
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] text-ink/70 hover:border-teal/40 hover:text-teal"
                    onClick={() => setQuestion(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs">
                  <span className="text-ink/55">Agent model</span>
                  <Select value={agentModel} onValueChange={setAgentModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent>
                      {(agentModels.length ? agentModels : ["muse-spark-1.3"]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-ink/55">Judge model</span>
                  <Select value={judgeModel} onValueChange={setJudgeModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Judge" />
                    </SelectTrigger>
                    <SelectContent>
                      {(judgeModels.length ? judgeModels : ["muse-wonder-1.0"]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-ink/55">Evaluators</p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={evaluatorIds.includes("claim_grounding")}
                    onChange={(e) => {
                      setEvaluatorIds((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, "claim_grounding"]))
                          : prev.filter((x) => x !== "claim_grounding"),
                      );
                    }}
                  />
                  claim_grounding
                </label>
                {rubricEvals.map((ev) => (
                  <label key={ev.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={evaluatorIds.includes(ev.id)}
                      onChange={(e) => {
                        setEvaluatorIds((prev) =>
                          e.target.checked
                            ? [...prev, ev.id]
                            : prev.filter((x) => x !== ev.id),
                        );
                      }}
                    />
                    {ev.name || ev.id}
                    <Badge className="border-border bg-muted text-[10px] text-ink/55">rubric</Badge>
                  </label>
                ))}
              </div>

              {hasImage ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={degrade}
                    onChange={(e) => setDegrade(e.target.checked)}
                  />
                  Try with degradation (blur, noise)
                </label>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="button"
                  variant="teal"
                  disabled={busy || !liveAvailable}
                  onClick={() => void onRun()}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…
                    </>
                  ) : (
                    "Run"
                  )}
                </Button>
                {dailyRemaining !== null ? (
                  <span className="text-xs text-ink/55">
                    Daily runs remaining: <strong>{dailyRemaining}</strong>
                  </span>
                ) : null}
                {recorded.length ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setExampleId(recorded[0].id);
                      setDetail(null);
                      setRunId(null);
                    }}
                  >
                    Browse a recorded example
                  </Button>
                ) : null}
              </div>
              {error ? (
                <div className="rounded border border-crimson/30 bg-crimson/5 px-3 py-2 text-xs text-crimson">
                  {error}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Right: progress + result */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <CardDescription>
                {runId ? `Run ${runId.slice(0, 8)}…` : exampleId ? "Recorded example" : "Waiting to run"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {(
                  [
                    ["media", "Media attached"],
                    ["sense", "Transcribed or frames sampled"],
                    ["model", "Model answered"],
                    ["eval", "Evaluating"],
                    ["done", "Done"],
                  ] as const
                ).map(([id, label]) => {
                  const st = exampleId
                    ? "done"
                    : stages[id];
                  return (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                          st === "done"
                            ? "border-teal bg-teal text-white"
                            : st === "active"
                              ? "border-amber bg-amber/15 text-amber"
                              : "border-border text-ink/35",
                        )}
                      >
                        {st === "done" ? <Check className="h-3 w-3" /> : st === "active" ? "…" : ""}
                      </span>
                      <span className={st === "pending" ? "text-ink/40" : "text-ink"}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {activeExample ? (
            <ResultPanel
              answer={activeExample.answer}
              claims={activeExample.claim_grounding.claims}
              groundedness={activeExample.claim_grounding.groundedness}
              hallucination={activeExample.claim_grounding.hallucination}
              completeness={activeExample.claim_grounding.completeness}
              completenessSkipped={activeExample.claim_grounding.completeness_skipped}
              completenessReason={activeExample.claim_grounding.completeness_reason}
              imageSrc={activeExample.modality === "image" ? activeExample.media_url : null}
              audioSrc={activeExample.modality === "audio" ? activeExample.media_url : null}
              traceId={activeExample.trace_id}
              examplePicker={
                <div className="flex flex-wrap gap-2">
                  {recorded.map((ex) => (
                    <Button
                      key={ex.id}
                      type="button"
                      size="sm"
                      variant={ex.id === exampleId ? "default" : "outline"}
                      onClick={() => setExampleId(ex.id)}
                    >
                      {ex.title}
                    </Button>
                  ))}
                </div>
              }
            />
          ) : null}

          {detail && detail.status !== "pending" ? (
            <ResultPanel
              answer={detail.answer || ""}
              claims={liveClaims.map((c) => ({
                claim: String(c.claim || ""),
                verdict: String(c.verdict || c.status || "not_found"),
                explanation: String(c.explanation || ""),
                evidence_box: Array.isArray(c.evidence_box) ? (c.evidence_box as number[]) : null,
              }))}
              groundedness={
                typeof claimMeta.groundedness === "number"
                  ? claimMeta.groundedness
                  : typeof claimResult?.score === "number"
                    ? claimResult.score
                    : null
              }
              hallucination={
                typeof claimMeta.hallucination === "number" ? claimMeta.hallucination : null
              }
              completeness={
                typeof claimMeta.completeness === "number" ? claimMeta.completeness : null
              }
              completenessSkipped={!!claimMeta.completeness_skipped}
              completenessReason={
                typeof claimMeta.completeness_reason === "string"
                  ? claimMeta.completeness_reason
                  : undefined
              }
              imageSrc={previewImage || null}
              evidenceBoxes={evidenceBoxes}
              traceId={(detail.trace_ids || [])[0] || null}
              compare={
                degrade && detail.answers
                  ? (["clean", "blur", "noise"] as const)
                      .filter((cond) => cond in (detail.answers || {}))
                      .map((cond) => {
                        const ans = detail.answers![cond];
                        const tid = (detail.trace_ids || []).find((t) => t.includes(`|${cond}|`));
                        const res = (detail.results || []).find(
                          (r) =>
                            r.evaluator_id === "claim_grounding" &&
                            (!tid || r.trace_id === tid),
                        );
                        return {
                          condition: cond,
                          answer: ans,
                          grounded:
                            typeof (res?.meta as { groundedness?: number } | null)?.groundedness ===
                            "number"
                              ? (res?.meta as { groundedness: number }).groundedness
                              : typeof res?.score === "number"
                                ? res.score
                                : null,
                        };
                      })
                  : null
              }
            />
          ) : null}

          {!activeExample && !detail && !busy ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-ink/45">
                Run a live try, or{" "}
                <button
                  type="button"
                  className="text-teal hover:underline"
                  onClick={() => recorded[0] && setExampleId(recorded[0].id)}
                >
                  browse a recorded example
                </button>
                .
              </CardContent>
            </Card>
          ) : null}
        </div>
        </>
        ) : null}
      </main>
    </>
  );
}

function ResultPanel({
  answer,
  claims,
  groundedness,
  hallucination,
  completeness,
  completenessSkipped,
  completenessReason,
  imageSrc,
  audioSrc,
  evidenceBoxes,
  traceId,
  compare,
  examplePicker,
}: {
  answer: string;
  claims: Array<{
    claim: string;
    verdict: string;
    explanation: string;
    evidence_box: number[] | null;
  }>;
  groundedness: number | null;
  hallucination: number | null;
  completeness: number | null;
  completenessSkipped?: boolean;
  completenessReason?: string;
  imageSrc?: string | null;
  audioSrc?: string | null;
  evidenceBoxes?: Array<{ box: number[]; label: string; n: number }>;
  traceId?: string | null;
  compare?: Array<{ condition: string; answer: string; grounded: number | null }> | null;
  examplePicker?: ReactNode;
}) {
  const boxes =
    evidenceBoxes ||
    claims
      .map((c, i) =>
        c.evidence_box && c.evidence_box.length === 4 && c.verdict === "supported"
          ? { box: c.evidence_box, label: c.claim, n: i + 1 }
          : null,
      )
      .filter(Boolean) as Array<{ box: number[]; label: string; n: number }>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Result</CardTitle>
        {examplePicker ? <div className="pt-2">{examplePicker}</div> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Answer</p>
          <p className="text-sm text-ink">{answer || "—"}</p>
        </div>

        {audioSrc ? <audio controls src={audioSrc} className="w-full" /> : null}
        {imageSrc ? <ClaimImageOverlay src={imageSrc} boxes={boxes} /> : null}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">Claims</p>
          <ul className="space-y-2">
            {claims.map((c, i) => (
              <li key={`${c.claim}-${i}`} className="rounded border border-border bg-white px-3 py-2">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-ink/45">#{i + 1}</span>
                  <Badge className={verdictChipClass(c.verdict)}>{c.verdict}</Badge>
                </div>
                <p className="text-sm text-ink">{c.claim}</p>
                {c.explanation ? (
                  <p className="mt-1 text-xs text-ink/55">{c.explanation}</p>
                ) : null}
              </li>
            ))}
            {!claims.length ? <li className="text-xs text-ink/45">No claims recorded.</li> : null}
          </ul>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="Groundedness" value={groundedness} />
          <Metric label="Hallucination" value={hallucination} />
          <Metric
            label="Completeness"
            value={completeness}
            hint={completenessSkipped ? completenessReason || "skipped" : undefined}
          />
        </div>

        {compare && compare.length ? (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              Degradation compare
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-ink/45">
                    <th className="py-1 pr-2 font-medium">Condition</th>
                    <th className="py-1 pr-2 font-medium">Answer</th>
                    <th className="py-1 font-medium">Grounded</th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map((row) => (
                    <tr key={row.condition} className="border-b border-border/60">
                      <td className="py-1.5 pr-2 font-medium">{row.condition}</td>
                      <td className="py-1.5 pr-2 text-ink/80">{row.answer}</td>
                      <td className="py-1.5">
                        {row.grounded == null ? "—" : pct(row.grounded)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {traceId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/traces/view/?id=${encodeURIComponent(traceId)}`}>Open full trace</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  return (
    <div className="rounded border border-border bg-muted/40 px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="text-sm font-semibold text-ink">
        {value == null ? "—" : pct(value)}
      </div>
      {hint ? <div className="text-[10px] text-ink/45">{hint}</div> : null}
    </div>
  );
}
