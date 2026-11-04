/**
 * Typed EvalVerse API client (from /openapi.json).
 *
 * Env:
 *   NEXT_PUBLIC_API_URL  (default http://127.0.0.1:8000)
 *   NEXT_PUBLIC_API_KEY  (default dev)
 *   NEXT_PUBLIC_MODE     live | snapshot
 */

export type TraceSource = "sdk" | "otlp" | "import" | string;
export type TraceStatus = "running" | "completed" | "error" | string;
export type SpanType = "model" | "tool" | "media" | "evaluation" | "chain" | "agent" | string;
export type SpanStatus = "running" | "completed" | "error" | string;

export interface ScoreSummary {
  count: number;
  mean: number | null;
  by_dimension?: Record<string, number | { count?: number; mean?: number | null }>;
}

export interface TraceListItem {
  id: string;
  project?: string;
  session_id?: string | null;
  name?: string | null;
  agent?: string | null;
  status?: TraceStatus;
  source?: TraceSource;
  started_at?: string | null;
  ended_at?: string | null;
  tags?: string[];
  span_count?: number;
  tool_call_count?: number;
  latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  score_summary?: ScoreSummary;
}

export interface MediaAsset {
  id: string;
  project?: string;
  sha256?: string;
  path?: string;
  mime?: string | null;
  size?: number | null;
  modality?: string | null;
  parent_id?: string | null;
  transformation?: string | null;
  created_at?: string | null;
  url?: string | null;
  role?: string | null;
  span_id?: string | null;
  created?: boolean;
}

export interface Span {
  id: string;
  trace_id?: string;
  parent_ids?: string[];
  type?: SpanType;
  name?: string;
  status?: SpanStatus;
  model?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  latency_ms?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  error?: string | null;
}

export interface EvalResult {
  id: string;
  run_id?: string;
  trace_id?: string;
  evaluator_id?: string;
  evaluator_version?: string;
  dimension?: string | null;
  status?: string;
  score?: number | null;
  verdict?: string | null;
  label?: string | null;
  explanation?: string | null;
  evidence?: unknown;
  meta?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface TraceDetail extends TraceListItem {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  spans?: Span[];
  media?: MediaAsset[];
  results?: EvalResult[];
}

export interface SessionSummary {
  session_id: string;
  trace_count: number;
  started?: string | null;
  ended?: string | null;
  agents?: string[];
  tool_call_count?: number;
  error_count?: number;
}

export interface SessionDetail extends SessionSummary {
  traces: TraceListItem[];
}

export interface Evaluator {
  id: string;
  version?: string;
  name?: string;
  type?: string;
  category?: string;
  dimension?: string;
  description?: string | null;
  modalities?: string[];
  needs_reference?: boolean;
  needs_replay?: boolean;
  depends_on?: string[];
  scope?: string;
  source?: string;
  project?: string | null;
  config?: Record<string, unknown>;
  created_at?: string | null;
}

export interface EvaluatorCreate {
  type: "rubric" | "rule" | string;
  name: string;
  id?: string | null;
  version?: string | null;
  dimension?: string | null;
  description?: string | null;
  category?: string | null;
  modalities?: string[] | null;
  prompt?: string | null;
  attach_media?: boolean | null;
  judge_model?: string | null;
  scale?: string | null;
  labels?: string[] | null;
  pass_threshold?: number | null;
  checks?: Record<string, unknown>[] | null;
  rules?: Record<string, unknown>[] | null;
}

export interface EvaluationCreate {
  evaluator_ids: string[];
  trace_ids?: string[] | null;
  filter?: Record<string, unknown> | null;
  dataset_item_id?: string | null;
  dataset_version_id?: string | null;
}

export interface EvaluationRun {
  id: string;
  project?: string;
  name?: string;
  status?: string;
  config?: Record<string, unknown>;
  created_at?: string | null;
  ended_at?: string | null;
  progress?: {
    total?: number;
    pending?: number;
    running?: number;
    completed?: number;
    failed?: number;
    skipped?: number;
  };
  results?: EvalResult[];
}

export interface Dataset {
  id: string;
  project?: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
}

export interface DatasetVersion {
  id: string;
  dataset_id?: string;
  version?: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  locked?: boolean;
}

export interface DatasetDetail extends Dataset {
  versions?: DatasetVersion[];
}

export interface DatasetItem {
  id: string;
  version_id?: string;
  input?: unknown;
  expectation?: Record<string, unknown> | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  media?: MediaAsset[];
}

export interface ExpectationSpec {
  answer?: unknown;
  answer_type?: string | null;
  evidence?: unknown;
  tolerance?: number | null;
  family?: string | null;
  menu?: unknown;
}

export interface PromoteRequest {
  dataset_id: string;
  expectation?: ExpectationSpec | Record<string, unknown> | null;
  tags?: string[] | null;
}

export interface ReviewCreate {
  result_id: string;
  verdict: string;
  label?: string | null;
  notes?: string | null;
  reviewer?: string | null;
}

export interface ReviewQueueItem {
  result: EvalResult;
  priority?: number;
  reasons?: string[];
  media?: MediaAsset[];
  trace?: TraceListItem | TraceDetail;
}

export interface Policy {
  id: string;
  project?: string;
  name: string;
  filter?: Record<string, unknown> | null;
  sample_rate?: number;
  evaluator_ids?: string[];
  alert?: Record<string, unknown> | null;
  enabled?: boolean;
  created_at?: string | null;
}

export interface PolicyCreate {
  name: string;
  id?: string | null;
  filter?: Record<string, unknown> | null;
  sample_rate?: number;
  evaluator_ids?: string[];
  enabled?: boolean;
  alert?: Record<string, unknown> | null;
}

export interface PolicyUpdate {
  name?: string | null;
  filter?: Record<string, unknown> | null;
  sample_rate?: number | null;
  evaluator_ids?: string[] | null;
  enabled?: boolean | null;
  alert?: Record<string, unknown> | null;
}

export interface ProviderModel {
  id: string;
  capabilities?: Record<string, boolean>;
}

export interface Provider {
  id: string;
  name?: string;
  models?: ProviderModel[];
}

export interface ExperimentAgent {
  name: string;
  model: string;
  prompt_version?: string | null;
}

export interface Experiment {
  id: string;
  project?: string;
  name: string;
  config?: {
    dataset_version_id?: string;
    agents?: Array<ExperimentAgent | string | Record<string, unknown>>;
    variants?: string[];
    evaluator_ids?: string[];
    judge_model?: string;
    mock?: boolean;
  };
  created_at?: string | null;
}

export interface ExperimentRun {
  id: string;
  experiment_id?: string;
  agent?: string;
  variant?: string;
  eval_run_id?: string;
  manifest?: Record<string, unknown>;
  status?: string;
  created_at?: string | null;
  ended_at?: string | null;
}

export interface ExperimentDetail extends Experiment {
  runs?: ExperimentRun[];
}

export interface ExperimentCreate {
  name: string;
  dataset_version_id: string;
  agents: Array<ExperimentAgent | string | Record<string, unknown>>;
  variants?: string[];
  evaluator_ids?: string[];
  judge_model?: string | null;
  mock?: boolean;
}

export interface ExperimentCompare {
  experiment_id: string;
  a: ExperimentRun;
  b: ExperimentRun;
  dimension_deltas?: Array<{
    dimension: string;
    mean_a?: number | null;
    mean_b?: number | null;
    delta?: number | null;
  }>;
  case_changes?: Array<{
    case_id?: string;
    evaluator_id?: string;
    dimension?: string;
    score_a?: number | null;
    score_b?: number | null;
    delta?: number | null;
    label_a?: string | null;
    label_b?: string | null;
    trace_a?: string | null;
    trace_b?: string | null;
  }>;
}

export interface Calibration {
  evaluator_id: string;
  n: number;
  agreement_rate?: number | null;
  cohens_kappa?: number | null;
  confusion?: Record<string, Record<string, number>> | Record<string, number>;
  labels?: string[];
}

export interface QueueStats {
  depth: number;
  running: number;
  completed: number;
  failed: number;
}

export interface Alert {
  id?: string;
  project?: string;
  policy_id?: string;
  message?: string;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface TraceListParams {
  session_id?: string | null;
  agent?: string | null;
  status?: string | null;
  source?: string | null;
  q?: string | null;
  limit?: number;
  offset?: number;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_URL = "http://127.0.0.1:8000";
const DEFAULT_KEY = "dev";
export const CONNECTION_STORAGE_KEY = "evalverse.connection";

export type StoredConnection = {
  url: string;
  apiKey: string;
  project: string;
  /** When false, Studio stays on snapshot demo data. */
  preferLive: boolean;
};

export function readStoredConnection(): StoredConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConnection>;
    if (!parsed.url || !parsed.apiKey) return null;
    return {
      url: String(parsed.url).replace(/\/$/, ""),
      apiKey: String(parsed.apiKey),
      project: String(parsed.project || "default"),
      preferLive: parsed.preferLive !== false,
    };
  } catch {
    return null;
  }
}

export function writeStoredConnection(conn: StoredConnection) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    CONNECTION_STORAGE_KEY,
    JSON.stringify({
      url: conn.url.replace(/\/$/, ""),
      apiKey: conn.apiKey,
      project: conn.project || "default",
      preferLive: conn.preferLive,
    }),
  );
}

export function clearStoredConnection() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CONNECTION_STORAGE_KEY);
}

export function apiConfig() {
  const modeEnv = (process.env.NEXT_PUBLIC_MODE || "live").toLowerCase();
  const stored = readStoredConnection();
  const url = (stored?.url || process.env.NEXT_PUBLIC_API_URL || DEFAULT_URL).replace(/\/$/, "");
  const key = stored?.apiKey || process.env.NEXT_PUBLIC_API_KEY || DEFAULT_KEY;
  const project = stored?.project || "default";
  return {
    url,
    key,
    project,
    preferLive: stored ? stored.preferLive : modeEnv !== "snapshot",
    modeEnv: modeEnv === "snapshot" ? ("snapshot" as const) : ("live" as const),
    hasStoredConnection: !!stored,
    hostLabel: (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })(),
  };
}

/** Health check against an arbitrary URL/key (Connect form) — never logs the key. */
export async function testHealth(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ status: string }> {
  const base = url.replace(/\/$/, "");
  const res = await fetch(`${base}/api/v1/health`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(res.status, `Health check failed (${res.status})`);
  return (await res.json()) as { status: string };
}

export function mediaFileUrl(mediaIdOrUrl: string): string {
  const { url } = apiConfig();
  if (!mediaIdOrUrl) return "";
  if (mediaIdOrUrl.startsWith("http") || mediaIdOrUrl.startsWith("/media/")) return mediaIdOrUrl;
  if (mediaIdOrUrl.startsWith("/api/")) return `${url}${mediaIdOrUrl}`;
  return `${url}/api/v1/media/${mediaIdOrUrl}/file`;
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { url, key, project } = apiConfig();
  const qs = new URLSearchParams();
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
  }
  const q = qs.toString();
  const full = `${url}${path}${q ? `?${q}` : ""}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "X-Project": project || "default",
  };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(full, {
    method: opts.method || "GET",
    headers,
    body,
    signal: opts.signal,
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      try {
        console.warn("[evalverse] session expired", { path, status: 401, body: parsed });
        window.dispatchEvent(
          new CustomEvent("evalverse:auth-expired", { detail: { path, status: 401, body: parsed } }),
        );
      } catch {
        /* ignore */
      }
    } else if (res.status >= 500 && typeof window !== "undefined") {
      try {
        console.warn("[evalverse] server error", { path, status: res.status, body: parsed });
      } catch {
        /* ignore */
      }
    }
    const detail =
      typeof parsed === "object" && parsed && "detail" in parsed
        ? JSON.stringify((parsed as { detail: unknown }).detail)
        : text.slice(0, 200);
    throw new ApiError(res.status, `${res.status} ${path}: ${detail}`, parsed);
  }
  return parsed as T;
}

export async function health(signal?: AbortSignal): Promise<{ status: string }> {
  return request("/api/v1/health", { signal });
}

export async function listTraces(params: TraceListParams = {}, signal?: AbortSignal) {
  return request<TraceListItem[]>("/api/v1/traces", { query: { ...params }, signal });
}

export async function getTrace(traceId: string, signal?: AbortSignal) {
  return request<TraceDetail>(`/api/v1/traces/${encodeURIComponent(traceId)}`, { signal });
}

export async function listSessions(signal?: AbortSignal) {
  return request<SessionSummary[]>("/api/v1/sessions", { signal });
}

export async function getSession(sessionId: string, signal?: AbortSignal) {
  return request<SessionDetail>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { signal });
}

export async function listEvaluators(signal?: AbortSignal) {
  return request<Evaluator[]>("/api/v1/evaluators", { signal });
}

export async function getEvaluator(evaluatorId: string, signal?: AbortSignal) {
  return request<Evaluator>(`/api/v1/evaluators/${encodeURIComponent(evaluatorId)}`, { signal });
}

export async function createEvaluator(body: EvaluatorCreate, signal?: AbortSignal) {
  return request<Evaluator>("/api/v1/evaluators", { method: "POST", body, signal });
}

export async function putEvaluatorVersion(
  evaluatorId: string,
  body: Partial<EvaluatorCreate>,
  signal?: AbortSignal,
) {
  return request<Evaluator>(`/api/v1/evaluators/${encodeURIComponent(evaluatorId)}`, {
    method: "PUT",
    body,
    signal,
  });
}

export async function testEvaluator(evaluatorId: string, traceId: string, signal?: AbortSignal) {
  return request<EvalResult>(`/api/v1/evaluators/${encodeURIComponent(evaluatorId)}/test`, {
    method: "POST",
    body: { trace_id: traceId },
    signal,
  });
}

export async function createEvaluation(body: EvaluationCreate, signal?: AbortSignal) {
  return request<EvaluationRun>("/api/v1/evaluations", { method: "POST", body, signal });
}

export async function getEvaluation(runId: string, signal?: AbortSignal) {
  return request<EvaluationRun>(`/api/v1/evaluations/${encodeURIComponent(runId)}`, { signal });
}

export async function listDatasets(signal?: AbortSignal) {
  return request<Dataset[]>("/api/v1/datasets", { signal });
}

export async function getDataset(datasetId: string, signal?: AbortSignal) {
  return request<DatasetDetail>(`/api/v1/datasets/${encodeURIComponent(datasetId)}`, { signal });
}

export async function createDataset(
  body: { name: string; description?: string | null; metadata?: Record<string, unknown> },
  signal?: AbortSignal,
) {
  return request<Dataset>("/api/v1/datasets", { method: "POST", body, signal });
}

export async function listDatasetItems(
  datasetId: string,
  versionId?: string | null,
  signal?: AbortSignal,
) {
  return request<DatasetItem[]>(`/api/v1/datasets/${encodeURIComponent(datasetId)}/items`, {
    query: { version_id: versionId || undefined },
    signal,
  });
}

export async function createDatasetItem(
  datasetId: string,
  body: {
    input: unknown;
    expectation?: Record<string, unknown> | null;
    tags?: string[] | null;
    metadata?: Record<string, unknown> | null;
    version_id?: string | null;
  },
  signal?: AbortSignal,
) {
  return request<DatasetItem>(`/api/v1/datasets/${encodeURIComponent(datasetId)}/items`, {
    method: "POST",
    body,
    signal,
  });
}

export async function createDatasetVersion(
  datasetId: string,
  body: { version?: string; metadata?: Record<string, unknown> } = {},
  signal?: AbortSignal,
) {
  return request<DatasetVersion>(`/api/v1/datasets/${encodeURIComponent(datasetId)}/versions`, {
    method: "POST",
    body,
    signal,
  });
}

export async function exportDataset(datasetId: string, versionId?: string | null, signal?: AbortSignal) {
  return request<unknown>(`/api/v1/datasets/${encodeURIComponent(datasetId)}/export`, {
    query: { version_id: versionId || undefined },
    signal,
  });
}

export async function importDataset(
  datasetId: string,
  body: unknown,
  signal?: AbortSignal,
) {
  return request<unknown>(`/api/v1/datasets/${encodeURIComponent(datasetId)}/import`, {
    method: "POST",
    body,
    signal,
  });
}

export async function promoteTrace(traceId: string, body: PromoteRequest, signal?: AbortSignal) {
  return request<DatasetItem>(`/api/v1/traces/${encodeURIComponent(traceId)}/promote`, {
    method: "POST",
    body,
    signal,
  });
}

export async function createReview(body: ReviewCreate, signal?: AbortSignal) {
  return request<unknown>("/api/v1/reviews", { method: "POST", body, signal });
}

export async function reviewsQueue(signal?: AbortSignal) {
  return request<ReviewQueueItem[]>("/api/v1/reviews/queue", { signal });
}

export async function listPolicies(signal?: AbortSignal) {
  return request<Policy[]>("/api/v1/policies", { signal });
}

export async function createPolicy(body: PolicyCreate, signal?: AbortSignal) {
  return request<Policy>("/api/v1/policies", { method: "POST", body, signal });
}

export async function updatePolicy(policyId: string, body: PolicyUpdate, signal?: AbortSignal) {
  return request<Policy>(`/api/v1/policies/${encodeURIComponent(policyId)}`, {
    method: "PUT",
    body,
    signal,
  });
}

export async function listAlerts(signal?: AbortSignal) {
  return request<Alert[]>("/api/v1/alerts", { signal });
}

export async function getQueue(signal?: AbortSignal) {
  return request<QueueStats>("/api/v1/queue", { signal });
}

export async function listProviders(signal?: AbortSignal) {
  return request<Provider[]>("/api/v1/providers", { signal });
}

export interface PlaygroundCreateResponse {
  run_id: string;
  session_id: string;
  trace_ids: string[];
  status_url: string;
  status?: string;
}

export interface PlaygroundRunDetail {
  id: string;
  project?: string;
  session_id: string;
  status: string;
  question: string;
  agent_model?: string;
  judge_model?: string;
  evaluator_ids?: string[];
  conditions?: string[];
  mock?: boolean;
  trace_ids?: string[];
  traces?: TraceDetail[];
  results?: EvalResult[];
  answer?: string | null;
  answers?: Record<string, string>;
  eval_run_id?: string | null;
  error?: { code?: string; message?: string } | null;
  created_at?: string;
  started_at?: string | null;
  ended_at?: string | null;
  status_url?: string;
}

export async function createPlaygroundRun(
  form: FormData,
  signal?: AbortSignal,
): Promise<PlaygroundCreateResponse> {
  const { url, key, project } = apiConfig();
  const res = await fetch(`${url}/api/v1/playground/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "X-Project": project || "default",
    },
    body: form,
    signal,
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} /api/v1/playground/runs`, parsed);
  }
  return parsed as PlaygroundCreateResponse;
}

export async function getPlaygroundRun(runId: string, signal?: AbortSignal) {
  return request<PlaygroundRunDetail>(`/api/v1/playground/runs/${encodeURIComponent(runId)}`, {
    signal,
  });
}

/** Extract a human message + optional remaining hint from playground API errors. */
export function playgroundErrorInfo(err: unknown): {
  message: string;
  remaining: number | null;
  rateLimited: boolean;
} {
  if (!(err instanceof ApiError)) {
    return {
      message: err instanceof Error ? err.message : "Request failed",
      remaining: null,
      rateLimited: false,
    };
  }
  const body = err.body as { error?: { code?: string; message?: string } } | null;
  const message =
    body?.error?.message ||
    (typeof body === "object" && body && "detail" in (body as object)
      ? String((body as { detail: unknown }).detail)
      : err.message);
  const rateLimited = err.status === 429 || body?.error?.code === "RATE_LIMITED";
  let remaining: number | null = null;
  const m = /(?:remaining|left)[^\d]*(\d+)/i.exec(message);
  if (m) {
    remaining = Number(m[1]);
  } else if (rateLimited && /daily/i.test(message)) {
    remaining = 0;
  }
  return { message, remaining, rateLimited };
}

export async function listExperiments(signal?: AbortSignal) {
  return request<Experiment[]>("/api/v1/experiments", { signal });
}

export async function getExperiment(experimentId: string, signal?: AbortSignal) {
  return request<ExperimentDetail>(`/api/v1/experiments/${encodeURIComponent(experimentId)}`, {
    signal,
  });
}

export async function createExperiment(body: ExperimentCreate, signal?: AbortSignal) {
  return request<Experiment>("/api/v1/experiments", { method: "POST", body, signal });
}

export async function runExperiment(
  experimentId: string,
  body: { mock?: boolean | null } = {},
  signal?: AbortSignal,
) {
  return request<unknown>(`/api/v1/experiments/${encodeURIComponent(experimentId)}/runs`, {
    method: "POST",
    body,
    signal,
  });
}

export async function compareExperimentRuns(
  experimentId: string,
  a: string,
  b: string,
  signal?: AbortSignal,
) {
  return request<ExperimentCompare>(
    `/api/v1/experiments/${encodeURIComponent(experimentId)}/compare`,
    { query: { a, b }, signal },
  );
}

export async function getCalibration(evaluatorId: string, signal?: AbortSignal) {
  return request<Calibration>("/api/v1/calibration", {
    query: { evaluator_id: evaluatorId },
    signal,
  });
}

export async function seedDemo(signal?: AbortSignal) {
  return request<{ added: number; skipped: number }>("/api/v1/onboarding/seed-demo", {
    method: "POST",
    signal,
  });
}

export async function unseedDemo(signal?: AbortSignal) {
  return request<{ removed: number }>("/api/v1/onboarding/seed-demo", {
    method: "DELETE",
    signal,
  });
}

export async function getScores(
  params: {
    run_id?: string;
    experiment_id?: string;
    suite?: string;
    profile?: string;
  } = {},
  signal?: AbortSignal,
) {
  return request<Record<string, unknown>>("/api/v1/scores", {
    query: { profile: "balanced", ...params },
    signal,
  });
}

/** Poll evaluation until terminal status or timeout. */
export async function pollEvaluation(
  runId: string,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EvaluationRun> {
  const interval = opts.intervalMs ?? 800;
  const timeout = opts.timeoutMs ?? 60_000;
  const start = Date.now();
  while (true) {
    const run = await getEvaluation(runId, opts.signal);
    const st = (run.status || "").toLowerCase();
    if (["completed", "failed", "error", "cancelled"].includes(st)) return run;
    if (Date.now() - start > timeout) return run;
    await new Promise((r) => setTimeout(r, interval));
  }
}

const EVAL_RUNS_KEY = "evalverse.evalRuns";

export function rememberEvalRun(runId: string) {
  if (typeof window === "undefined") return;
  try {
    const cur = JSON.parse(localStorage.getItem(EVAL_RUNS_KEY) || "[]") as string[];
    const next = [runId, ...cur.filter((x) => x !== runId)].slice(0, 50);
    localStorage.setItem(EVAL_RUNS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function rememberedEvalRuns(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const cur = JSON.parse(localStorage.getItem(EVAL_RUNS_KEY) || "[]") as string[];
    return Array.isArray(cur) ? cur : [];
  } catch {
    return [];
  }
}
