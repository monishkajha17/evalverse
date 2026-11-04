import type { DimensionSummaryRow, JudgedRow, RunRow, SuiteData } from "./types";
import { OUTCOME_COLORS } from "./labels";

export interface AgentKpis {
  agent: string;
  grounded: number | null;
  confidentError: number | null;
  mediaRequired: number | null;
  robustness: number | null;
}

function meanScore(
  rows: DimensionSummaryRow[],
  pred: (r: DimensionSummaryRow) => boolean,
): number | null {
  const hit = rows.filter(pred);
  const scores = hit.map((r) => r.mean_score).filter((s): s is number => s != null);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function groundedShare(runs: RunRow[], agent: string, variant?: string): number | null {
  const rs = runs.filter(
    (r) => r.agent === agent && (variant == null || r.condition === variant) && r.condition !== "blind",
  );
  if (!rs.length) return null;
  const n = rs.filter((r) => r.label === "grounded_correct").length;
  return n / rs.length;
}

export function agentKpis(data: SuiteData): AgentKpis[] {
  const agents = data.meta.agents?.length
    ? data.meta.agents
    : [...new Set(data.runs.map((r) => r.agent))];
  const summary = data.dimension_summary || [];

  return agents.map((agent) => {
    const groundedFromSummary = meanScore(
      summary,
      (r) =>
        r.agent === agent &&
        r.evaluator_id === "evidence_grounding" &&
        r.variant !== "all" &&
        r.variant !== "blind",
    );
    const confident = meanScore(
      summary,
      (r) => r.agent === agent && r.evaluator_id === "confident_errors" && r.variant !== "blind",
    );
    const media = meanScore(
      summary,
      (r) => r.agent === agent && r.evaluator_id === "media_dependence",
    );
    const robustness = meanScore(
      summary,
      (r) => r.agent === agent && r.evaluator_id === "robustness_sweep",
    );

    return {
      agent,
      grounded: groundedFromSummary ?? groundedShare(data.runs, agent),
      confidentError: confident,
      mediaRequired: media,
      robustness,
    };
  });
}

export function dimensionPivot(data: SuiteData, agent?: string) {
  const variants = (data.meta.conditions || data.dimension_summary.map((r) => r.variant))
    .filter((v, i, arr) => v && v !== "all" && v !== "blind" && arr.indexOf(v) === i);
  const dims = [
    ...new Set(
      data.dimension_summary
        .filter((r) => !agent || r.agent === agent || r.agent === "*")
        .map((r) => r.dimension),
    ),
  ];
  const cell = (dimension: string, variant: string) => {
    const rows = data.dimension_summary.filter(
      (r) =>
        r.dimension === dimension &&
        r.variant === variant &&
        (!agent || r.agent === agent || r.agent === "*"),
    );
    const scores = rows.map((r) => r.mean_score).filter((s): s is number => s != null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  };
  return { variants, dims, cell };
}

export function outcomeStack(data: SuiteData) {
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter((v) => v !== "blind");
  const labels = [
    "grounded_correct",
    "correct_ungrounded",
    "misread",
    "mislocated",
    "abstained",
    "other",
  ];

  const rows = agents.flatMap((agent) =>
    variants.map((variant) => {
      const rs = data.runs.filter((r) => r.agent === agent && r.condition === variant);
      const counts: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
      for (const r of rs) {
        const lab = r.label || "other";
        if (lab in counts) counts[lab] += 1;
        else counts.other += 1;
      }
      return { key: `${agent} · ${variant}`, agent, variant, total: rs.length, ...counts };
    }),
  );

  return { rows, labels, colors: labels.map((l) => OUTCOME_COLORS[l] || OUTCOME_COLORS.other) };
}

export function groundedSeries(data: SuiteData) {
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter((v) => v !== "blind");
  return variants.map((variant) => {
    const point: Record<string, string | number | null> = { variant };
    for (const agent of agents) {
      point[agent] = groundedShare(data.runs, agent, variant);
    }
    return point;
  });
}

export function judgeTrust(judged: JudgedRow[]) {
  const rows = judged.filter(
    (j) => j.kind === "agent_answer" && j.judge_accepts != null && j.truth_correct != null,
  );
  let falseAccept = 0;
  let falseReject = 0;
  let trueAccept = 0;
  let trueReject = 0;
  for (const j of rows) {
    if (j.judge_accepts && !j.truth_correct) falseAccept += 1;
    else if (!j.judge_accepts && j.truth_correct) falseReject += 1;
    else if (j.judge_accepts && j.truth_correct) trueAccept += 1;
    else trueReject += 1;
  }
  const n = rows.length || 1;
  return {
    n: rows.length,
    falseAccept,
    falseReject,
    trueAccept,
    trueReject,
    falseAcceptRate: rows.length ? falseAccept / n : null,
    falseRejectRate: rows.length ? falseReject / n : null,
  };
}

export function caseTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === "string") return tags.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  return [];
}
