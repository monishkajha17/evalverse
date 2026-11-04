import type { ResultRow, SuiteData } from "./types";

export interface Rubric {
  id: string;
  checks: string;
  scores: string;
  threshold: string;
  labels: string[];
}

const RUBRICS: Record<string, Rubric> = {
  answer_correctness: {
    id: "answer_correctness",
    checks: "Whether the agent's answer matches the expected reference value for the case.",
    scores: "Score is 1 if the normalized answer equals the expected answer, else 0.",
    threshold: "Pass when score ≥ 1.0 (exact match).",
    labels: ["correct", "incorrect", "invalid"],
  },
  evidence_grounding: {
    id: "evidence_grounding",
    checks: "Whether the claimed evidence region overlaps the known truth region (box or span).",
    scores: "Score is 1 when the claimed box/span matches truth within the evidence margin, else 0.",
    threshold: "Pass when evidence overlaps truth (score ≥ 1.0).",
    labels: ["grounded", "ungrounded", "missing_evidence"],
  },
  stage_attribution: {
    id: "stage_attribution",
    checks: "Buckets the failure into grounded_correct / correct_ungrounded / misread / mislocated (or audio equivalents).",
    scores: "Score is 1 only for grounded_correct; other stage labels score 0.",
    threshold: "Pass when the stage label is grounded_correct.",
    labels: [
      "grounded_correct",
      "correct_ungrounded",
      "misread",
      "mislocated",
      "abstained",
      "heard_wrong",
      "misunderstood",
    ],
  },
  media_dependence: {
    id: "media_dependence",
    checks: "Compares a clean (with media) run against a blind (no media) run for the same case.",
    scores: "Score is 1 when the clean run is correct and the blind run is not (media required).",
    threshold: "Pass / media_required when the agent needs the media to answer correctly.",
    labels: ["media_required", "media_optional", "inconclusive"],
  },
  robustness_sweep: {
    id: "robustness_sweep",
    checks: "Walks degradation variants in order and finds the first non-grounded_correct outcome.",
    scores: "Score is the share of variants that remain grounded_correct before first failure.",
    threshold: "Higher is better; 1.0 means grounded across the full sweep.",
    labels: ["first_failure:blur", "first_failure:noise", "first_failure:lowres", "robust"],
  },
  judge_audit: {
    id: "judge_audit",
    checks: "Audits the judge against planted and agent answers where ground truth is known.",
    scores: "Score is the agreement rate between judge accept/reject and truth correctness.",
    threshold: "Pass when agreement is high; inspect false-accept / false-reject separately.",
    labels: ["judge_audit"],
  },
  transcript_fidelity: {
    id: "transcript_fidelity",
    checks: "Compares ASR text against the reference transcript for audio turns.",
    scores: "Score is 1 − WER (word error rate) clipped to [0, 1].",
    threshold: "Pass when score ≥ 0.8 by default.",
    labels: ["ok", "degraded", "failed"],
  },
  temporal_alignment: {
    id: "temporal_alignment",
    checks: "Checks whether the cited audio span overlaps the true evidence span.",
    scores: "Score is 1 when the cited midpoint (or span) falls inside the truth span.",
    threshold: "Pass when the cited span matches truth.",
    labels: ["aligned", "misaligned"],
  },
  audio_stage_attribution: {
    id: "audio_stage_attribution",
    checks: "Audio stage bucket: grounded_correct / correct_ungrounded / heard_wrong / misunderstood / mislocated.",
    scores: "Score is 1 only for grounded_correct.",
    threshold: "Pass when label is grounded_correct.",
    labels: [
      "grounded_correct",
      "correct_ungrounded",
      "heard_wrong",
      "misunderstood",
      "mislocated",
      "abstained",
    ],
  },
};

export function rubricFor(id: string): Rubric {
  return (
    RUBRICS[id] || {
      id,
      checks: "See evaluator implementation for what this checks.",
      scores: "Score semantics follow the evaluator's documented contract.",
      threshold: "See verdict field on results.",
      labels: [],
    }
  );
}

export function workedExample(data: SuiteData, evaluatorId: string): ResultRow | null {
  const completed = data.results.filter(
    (r) => r.evaluator_id === evaluatorId && r.status === "completed" && r.explanation,
  );
  if (!completed.length) {
    return data.results.find((r) => r.evaluator_id === evaluatorId) || null;
  }
  // Prefer a non-trivial example (fail or interesting label).
  return (
    completed.find((r) => r.verdict === "fail" || (r.score != null && r.score < 1)) ||
    completed[0]
  );
}
