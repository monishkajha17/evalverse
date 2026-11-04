export type Box = [number, number, number, number];
export type SpanMs = [number, number];

export interface SuiteIndexEntry {
  suite: string;
  modality: string;
  n_cases: number;
  agents: string[];
  variants: string[];
  created?: string | null;
}

export interface CaseTurn {
  index?: number;
  speaker_id?: string;
  start_ms?: number;
  end_ms?: number;
  text?: string;
  clip?: string;
  asr?: string;
}

export interface CaseRow {
  id: string;
  family?: string;
  question?: string;
  answer?: string;
  answer_type?: string;
  distractor?: string;
  truth_box?: Box | null;
  truth_span?: SpanMs | null;
  size?: [number, number];
  image?: string;
  audio?: string;
  modality?: string;
  turns?: CaseTurn[];
  tags?: string[] | string | null;
  keyword?: string;
}

export interface RunRow {
  agent: string;
  case_id: string;
  condition: string;
  answer?: string | null;
  box?: Box | null;
  span_ms?: SpanMs | null;
  correct?: boolean;
  evidence_ok?: boolean;
  label?: string;
  latency?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  prompt?: string | null;
  raw?: string | null;
  evidence?: string | null;
  error?: string | null;
  asr_turns?: Record<string, string> | null;
}

export interface EvalEvidence {
  type?: string;
  role?: string;
  locator?: unknown;
  [key: string]: unknown;
}

export interface ResultRow {
  id: string;
  evaluator_id: string;
  evaluator_version?: string;
  dimension?: string;
  target: { agent: string; case_id: string; variant: string };
  status: string;
  score?: number | null;
  verdict?: string | null;
  label?: string | null;
  explanation?: string | null;
  evidence?: EvalEvidence[];
}

export interface DimensionSummaryRow {
  agent: string;
  variant: string;
  dimension: string;
  evaluator_id: string;
  n: number;
  mean_score?: number | null;
  labels?: Record<string, number>;
  skipped?: number;
  errors?: number;
}

export interface DisagreementRow {
  kind?: string;
  agent?: string;
  case_id?: string;
  variant?: string;
  judge_accepts?: boolean;
  truth_correct?: boolean;
  proposed?: string;
  [key: string]: unknown;
}

export interface RegistryEntry {
  id: string;
  version?: string;
  category?: string;
  dimension?: string;
  modalities?: string[];
  needs_reference?: boolean;
  needs_replay?: boolean;
  depends_on?: string[];
  scope?: string;
}

export interface JudgedRow {
  kind?: string;
  agent?: string;
  case_id?: string;
  proposed?: string;
  judge_accepts?: boolean | null;
  truth_correct?: boolean | null;
  agrees?: boolean | null;
  [key: string]: unknown;
}

export interface TraceAsset {
  id?: string;
  path?: string;
  modality?: string;
  transformation?: string;
}

export interface TraceSpan {
  id: string;
  name: string;
  type?: string;
  status?: string;
  parent_span_ids?: string[];
  latency_s?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number } | null;
  input?: unknown;
  output?: unknown;
  result_ids?: string[];
  model?: string;
  metadata?: Record<string, unknown>;
  error?: string | null;
}

export interface TraceRow {
  id: string;
  agent: string;
  case_id: string;
  variant: string;
  variant_transform?: string;
  assets?: TraceAsset[];
  spans?: TraceSpan[];
}

export interface SuiteData {
  meta: {
    agents?: string[];
    conditions?: string[];
    judge?: string;
    modality?: string;
    created?: string;
    mock?: boolean;
    [key: string]: unknown;
  };
  cases: CaseRow[];
  runs: RunRow[];
  results: ResultRow[];
  dimension_summary: DimensionSummaryRow[];
  disagreements: DisagreementRow[];
  registry: RegistryEntry[];
  judged: JudgedRow[];
  traces: TraceRow[];
}

export type OutcomeLabel =
  | "grounded_correct"
  | "correct_ungrounded"
  | "misread"
  | "mislocated"
  | "abstained"
  | "heard_wrong"
  | "misunderstood"
  | "invalid_output"
  | string;
