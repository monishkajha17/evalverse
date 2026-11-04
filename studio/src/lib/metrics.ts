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

export function videoOverviewKpis(data: SuiteData) {
  const runs = (data.runs || []).filter((r) => r.condition !== "blind");
  const n = runs.length || 1;
  const grounded = runs.filter((r) => r.label === "grounded_correct").length / n;
  const abstained = runs.filter((r) => r.label === "abstained").length / n;
  const confidentError =
    runs.filter((r) => r.correct === false && r.label !== "abstained").length / n;
  return { grounded, abstained, confidentError, n: runs.length };
}

export type VideoQuestionTable = {
  kind: "time" | "order" | "third";
  chance: number;
  cells: Record<string, { correct: number; total: number }>;
};

/** By question type × condition, with chance baseline. */
export function videoByQuestionType(data: SuiteData): VideoQuestionTable[] {
  const kinds = ["time", "order", "third"] as const;
  const cols = ["clean", "sparse", "blur", "blind_guess"] as const;
  const caseKind = (id: string) => {
    const part = id.split("_").pop() || "";
    return kinds.includes(part as (typeof kinds)[number])
      ? (part as (typeof kinds)[number])
      : null;
  };

  return kinds.map((kind) => {
    const cells: Record<string, { correct: number; total: number }> = {};
    for (const col of cols) {
      const rs = (data.runs || []).filter(
        (r) => caseKind(r.case_id) === kind && r.condition === col,
      );
      cells[col] = {
        correct: rs.filter((r) => r.correct).length,
        total: rs.length,
      };
    }
    return {
      kind,
      chance: kind === "order" ? 0.5 : 0,
      cells,
    };
  });
}

/** Scoreboard dimensions only — Failure analysis stays on the outcome bar. */
export const REAL_SCORE_DIMENSIONS = [
  "Perception",
  "Groundedness",
  "Temporal grounding",
  "Hallucination",
  "Completeness",
  "Reasoning",
  "Cross-modal consistency",
  "Media dependence",
  "Robustness",
  "Honesty",
  "Tool use",
] as const;

/** Drop dimensions where every variant cell is empty; keep only real score dims. */
export function dimensionPivotSparse(data: SuiteData, agent?: string) {
  const pivot = dimensionPivot(data, agent);
  const allowed = new Set<string>(REAL_SCORE_DIMENSIONS);
  const dims = pivot.dims.filter(
    (dim) =>
      allowed.has(dim) && pivot.variants.some((v) => pivot.cell(dim, v) != null),
  );
  return { ...pivot, dims };
}

function ciTuple(ci: unknown): [number, number] | null {
  if (!ci) return null;
  if (Array.isArray(ci) && ci.length >= 2 && typeof ci[0] === "number" && typeof ci[1] === "number") {
    return [ci[0], ci[1]];
  }
  if (typeof ci === "object" && ci) {
    const o = ci as { lo?: number; hi?: number };
    if (typeof o.lo === "number" && typeof o.hi === "number") return [o.lo, o.hi];
  }
  return null;
}

export type ModelOverviewCard = {
  agent: string;
  correct: number | null;
  confidentlyWrong: number | null;
  couldNotRead: number | null;
  ums: number | null;
  ci: [number, number] | null;
  gatePass: boolean | null;
  confidentByVariant: Array<{ variant: string; rate: number | null; n: number }>;
};

/** Per-model overview tiles: correctness, honesty, abstention, UMS. */
export function modelOverviewCards(data: SuiteData): ModelOverviewCard[] {
  const agents = data.meta.agents?.length
    ? data.meta.agents
    : [...new Set(data.runs.map((r) => r.agent))];
  const summary = data.dimension_summary || [];
  const scoreRows = data.scores?.rows || [];

  return agents.map((agent) => {
    const runs = data.runs.filter((r) => r.agent === agent && r.condition !== "blind");
    const n = runs.length || 1;
    const correct = runs.filter((r) => r.correct === true).length / n;
    const couldNotRead = runs.filter((r) => r.label === "abstained").length / n;
    const confidentlyWrong =
      meanScore(
        summary,
        (r) => r.agent === agent && r.evaluator_id === "confident_errors" && r.variant !== "blind",
      ) ?? runs.filter((r) => r.correct === false && r.label !== "abstained").length / n;

    const scoresBlock = data.scores as
      | (NonNullable<SuiteData["scores"]> & {
          overall?: number | Record<string, number | { ums?: number | null } | null> | null;
        })
      | null
      | undefined;

    const overallRow =
      scoreRows.find((r) => r.agent === agent && r.variant === "overall") ||
      scoreRows.find((r) => r.agent === agent && r.variant === "clean") ||
      scoreRows.find((r) => r.agent === agent);

    let umsFromOverall: number | null = null;
    const overallField = scoresBlock?.overall;
    if (typeof overallField === "number") {
      umsFromOverall = overallField;
    } else if (overallField && typeof overallField === "object") {
      const byAgent = overallField[agent];
      if (typeof byAgent === "number") umsFromOverall = byAgent;
      else if (byAgent && typeof byAgent === "object" && typeof byAgent.ums === "number") {
        umsFromOverall = byAgent.ums;
      } else if (typeof (overallField as { ums?: number }).ums === "number") {
        umsFromOverall = (overallField as { ums: number }).ums;
      }
    }
    if (
      umsFromOverall == null &&
      overallRow &&
      typeof (overallRow as { overall?: number }).overall === "number"
    ) {
      umsFromOverall = (overallRow as { overall: number }).overall;
    }

    const confidentByVariant = summary
      .filter((r) => r.agent === agent && r.evaluator_id === "confident_errors")
      .map((r) => ({
        variant: r.variant,
        rate: r.mean_score ?? null,
        n: r.n,
      }))
      .sort((a, b) => a.variant.localeCompare(b.variant));

    return {
      agent,
      correct,
      confidentlyWrong,
      couldNotRead,
      ums:
        umsFromOverall != null
          ? umsFromOverall
          : typeof overallRow?.ums === "number"
            ? overallRow.ums
            : null,
      ci: ciTuple(overallRow?.ci_95),
      gatePass: overallRow?.gate?.pass ?? null,
      confidentByVariant,
    };
  });
}

/** Stage-label failure stack (includes mistimed / video labels). */
export function failureOutcomeStack(data: SuiteData) {
  const agents = data.meta.agents || [...new Set(data.runs.map((r) => r.agent))];
  const variants = (data.meta.conditions || []).filter((v) => v !== "blind");
  const labels = [
    "grounded_correct",
    "correct_ungrounded",
    "misread",
    "mistimed",
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

/** Mini compare: overall UMS (or clean correct rate) per agent. */
export function compareModelsSeries(data: SuiteData) {
  const cards = modelOverviewCards(data);
  return cards.map((c) => ({
    agent: c.agent,
    ums: c.ums != null ? Math.round(c.ums * 1000) / 10 : c.correct != null ? Math.round(c.correct * 1000) / 10 : 0,
    metric: c.ums != null ? "UMS" : "Correct",
  }));
}

const CROSS_VARIANT_COLS = ["clean", "blur", "noisy_voice", "no_image"] as const;

function crossVerdictCorrect(r: SuiteData["runs"][number], cases: SuiteData["cases"]): boolean {
  const expected =
    r.expected_verdict ||
    cases.find((c) => c.id === r.case_id)?.expected_verdict ||
    null;
  if (!expected || !r.verdict) return !!r.correct;
  return String(r.verdict).toLowerCase() === String(expected).toLowerCase();
}

/** Cross-modal suite KPIs from runs (verdict accuracy + error_type rates). */
export function crossModalOverviewKpis(data: SuiteData) {
  const runs = data.runs || [];
  const n = runs.length || 1;
  const correct = runs.filter((r) => crossVerdictCorrect(r, data.cases)).length;
  const missed = runs.filter((r) => r.error_type === "missed_contradiction").length;
  const falseAlarm = runs.filter((r) => r.error_type === "false_alarm").length;
  const abstained = runs.filter(
    (r) => r.error_type === "abstained" || r.verdict === "cannot_tell" || r.label === "abstained",
  ).length;
  return {
    verdictAccuracy: correct / n,
    missedContradictions: missed,
    falseAlarms: falseAlarm,
    abstentions: abstained,
    n: runs.length,
    nCorrect: correct,
  };
}

/** Variant table: correct / n for clean, blur, noisy voice, no_image. */
export function crossModalByVariant(data: SuiteData) {
  return CROSS_VARIANT_COLS.map((col) => {
    const cond = col === "noisy_voice" ? "noisy_voice" : col;
    const rs = (data.runs || []).filter((r) => {
      const c = r.condition || "";
      if (col === "noisy_voice") return c === "noisy_voice" || c === "noisy" || c === "noise";
      return c === cond;
    });
    return {
      variant: col === "noisy_voice" ? "noisy voice" : col === "no_image" ? "no image" : col,
      correct: rs.filter((r) => crossVerdictCorrect(r, data.cases)).length,
      total: rs.length,
    };
  });
}

const FAIL_BUCKETS = ["heard_wrong", "misread_image", "comparison_error", "abstained"] as const;

/** Stacked failure counts by agent (or overall) for cross-modal stage labels. */
export function crossModalFailureStack(data: SuiteData) {
  const agents = [...new Set((data.runs || []).map((r) => r.agent))];
  const rows = agents.map((agent) => {
    const rs = (data.runs || []).filter((r) => r.agent === agent);
    const row: Record<string, string | number> = { key: agent };
    for (const b of FAIL_BUCKETS) row[b] = 0;
    for (const r of rs) {
      if (crossVerdictCorrect(r, data.cases) && r.label === "cross_modal_correct") continue;
      const lab = (r.label || "").toLowerCase();
      if (lab === "heard_wrong") row.heard_wrong = Number(row.heard_wrong) + 1;
      else if (lab === "misread_image") row.misread_image = Number(row.misread_image) + 1;
      else if (lab === "comparison_error") row.comparison_error = Number(row.comparison_error) + 1;
      else if (lab === "abstained" || r.verdict === "cannot_tell")
        row.abstained = Number(row.abstained) + 1;
      else if (!crossVerdictCorrect(r, data.cases)) {
        // Unlabeled incorrect → bucket by error_type when possible
        if (r.error_type === "abstained") row.abstained = Number(row.abstained) + 1;
        else row.comparison_error = Number(row.comparison_error) + 1;
      }
    }
    return row;
  });
  return { rows, labels: [...FAIL_BUCKETS] };
}

/** No-image control accuracy with chance baseline 0.5. */
export function crossModalNoImageControl(data: SuiteData) {
  const rs = (data.runs || []).filter((r) => r.condition === "no_image");
  const correct = rs.filter((r) => crossVerdictCorrect(r, data.cases)).length;
  const total = rs.length;
  return {
    correct,
    total,
    rate: total ? correct / total : null,
    chance: 0.5,
  };
}
