import { CORD_UMS_CLEAN } from "@/components/marketing/landing-constants";
import type { ResultRow, SuiteData, SuiteIndexEntry } from "@/lib/types";

export type DimMark =
  | "measured in this release"
  | `small sample (${number} cases)`
  | `small sample (${number} pairs)`
  | "defined, no data yet";

export type CordUmsView = typeof CORD_UMS_CLEAN & {
  overallUms: number;
  overallCi: [number, number];
  cleanUms: number;
  cleanCi: [number, number] | null;
  missingDimensions: string[];
};

const FRAMEWORK_DIMS = [
  "Perception",
  "Groundedness",
  "Temporal grounding",
  "Cross-modal consistency",
  "Hallucination",
  "Completeness",
  "Reasoning",
] as const;

const MEASURED_MIN_RESULTS = 10;
const MEASURED_MIN_CASES = 10;
const CROSS_MODAL_MEASURED_PAIRS = 30;

function caseIdOf(r: ResultRow): string | null {
  const fromTarget = r.target?.case_id;
  if (fromTarget) return String(fromTarget);
  const parts = String(r.id || "").split("|");
  return parts.length >= 2 ? parts[1] : null;
}

function isCompleted(r: ResultRow): boolean {
  return r.status === "completed" && typeof r.score === "number";
}

/** Aggregate completed results for a dimension across suites. */
function collectDim(
  suites: SuiteData[],
  dimension: string,
): { n: number; cases: Set<string> } {
  const cases = new Set<string>();
  let n = 0;
  for (const suite of suites) {
    for (const r of suite.results || []) {
      if (r.dimension !== dimension) continue;
      if (!isCompleted(r)) continue;
      n += 1;
      const cid = caseIdOf(r);
      if (cid) cases.add(cid);
    }
  }
  return { n, cases };
}

/**
 * Per-dimension "measured in this release" markers from ALL non-mock suites.
 * Cross-modal consistency is scoped to the crossmodal suite and uses "pairs".
 */
export function computeDimensionMarks(
  index: SuiteIndexEntry[],
  suitesById: Record<string, SuiteData>,
): Record<string, DimMark> {
  const nonMock = index
    .filter((e) => !e.mock)
    .map((e) => suitesById[e.suite])
    .filter((s): s is SuiteData => Boolean(s) && !s.meta?.mock);

  const crossSuite =
    suitesById.crossmodal && !suitesById.crossmodal.meta?.mock
      ? suitesById.crossmodal
      : null;

  const out: Record<string, DimMark> = {};
  for (const dim of FRAMEWORK_DIMS) {
    if (dim === "Cross-modal consistency") {
      const { n, cases } = crossSuite
        ? collectDim([crossSuite], dim)
        : { n: 0, cases: new Set<string>() };
      const pairs = cases.size || n;
      if (n === 0) {
        out[dim] = "defined, no data yet";
      } else if (pairs >= CROSS_MODAL_MEASURED_PAIRS) {
        out[dim] = "measured in this release";
      } else {
        out[dim] = `small sample (${pairs} pairs)`;
      }
      continue;
    }

    const { n, cases } = collectDim(nonMock, dim);
    if (n === 0) {
      out[dim] = "defined, no data yet";
    } else if (n >= MEASURED_MIN_RESULTS && cases.size >= MEASURED_MIN_CASES) {
      out[dim] = "measured in this release";
    } else {
      out[dim] = `small sample (${cases.size || n} cases)`;
    }
  }
  return out;
}

function ciTuple(
  raw: unknown,
  fallback: [number, number],
): [number, number] {
  if (Array.isArray(raw) && raw.length === 2) {
    const lo = Number(raw[0]);
    const hi = Number(raw[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) return [lo, hi];
  }
  if (raw && typeof raw === "object" && "lo" in raw && "hi" in raw) {
    const lo = Number((raw as { lo?: number }).lo);
    const hi = Number((raw as { hi?: number }).hi);
    if (Number.isFinite(lo) && Number.isFinite(hi)) return [lo, hi];
  }
  return fallback;
}

function umsFromUnknown(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === "object" && typeof (raw as { ums?: number }).ums === "number") {
    return (raw as { ums: number }).ums;
  }
  return null;
}

function dimensionsFromRow(
  row: {
    dimensions?: Record<string, { score?: number | null; status?: string } | number>;
  } | null,
): Array<{ name: string; score: number }> {
  if (!row?.dimensions) return [];
  const out: Array<{ name: string; score: number }> = [];
  for (const [name, raw] of Object.entries(row.dimensions)) {
    const score =
      typeof raw === "number"
        ? raw
        : raw && typeof raw === "object" && typeof raw.score === "number"
          ? raw.score
          : null;
    const status =
      raw && typeof raw === "object" && "status" in raw
        ? String(raw.status || "")
        : score != null
          ? "available"
          : "unavailable";
    if (status === "available" && score != null) out.push({ name, score });
  }
  return out;
}

function missingFromRow(
  row: {
    dimensions?: Record<string, { score?: number | null; status?: string } | number>;
  } | null,
): string[] {
  if (!row?.dimensions) return [];
  const missing: string[] = [];
  for (const [name, raw] of Object.entries(row.dimensions)) {
    const status =
      raw && typeof raw === "object" && "status" in raw
        ? String(raw.status || "")
        : typeof raw === "number"
          ? "available"
          : "unavailable";
    if (status !== "available") missing.push(name);
  }
  return missing;
}

/**
 * Score panel figures from cord suite scores.overall + by_variant.clean
 * (falls back to rows with variant overall / clean, then snapshot constants).
 */
export function cordUmsFromSuite(suite: SuiteData | null | undefined): CordUmsView {
  const scores = suite?.scores as
    | (NonNullable<SuiteData["scores"]> & {
        overall?: unknown;
        by_variant?: Record<string, unknown>;
      })
    | null
    | undefined;

  const rows = scores?.rows || [];
  const overallRow =
    rows.find((r) => r.agent === "muse-spark-1.3" && r.variant === "overall") ||
    rows.find((r) => r.variant === "overall") ||
    null;
  const cleanRow =
    rows.find((r) => r.agent === "muse-spark-1.3" && r.variant === "clean") ||
    rows.find((r) => r.variant === "clean") ||
    null;

  const overallBlock = scores?.overall;
  const cleanBlock = scores?.by_variant?.clean;

  const overallUms =
    umsFromUnknown(overallBlock) ??
    (typeof overallRow?.ums === "number" ? overallRow.ums : null) ??
    CORD_UMS_CLEAN.overallUms;

  const cleanUms =
    umsFromUnknown(cleanBlock) ??
    (typeof cleanRow?.ums === "number" ? cleanRow.ums : null) ??
    CORD_UMS_CLEAN.cleanUms;

  const overallCi = ciTuple(
    (overallBlock && typeof overallBlock === "object" && "ci_95" in overallBlock
      ? (overallBlock as { ci_95?: unknown }).ci_95
      : null) ?? overallRow?.ci_95,
    CORD_UMS_CLEAN.overallCi,
  );
  const cleanCiRaw =
    (cleanBlock && typeof cleanBlock === "object" && "ci_95" in cleanBlock
      ? (cleanBlock as { ci_95?: unknown }).ci_95
      : null) ?? cleanRow?.ci_95;
  const cleanCi = cleanCiRaw != null ? ciTuple(cleanCiRaw, CORD_UMS_CLEAN.ci_95) : CORD_UMS_CLEAN.cleanCi;

  type DimMap = Record<string, { score?: number | null; status?: string } | number>;
  const dimSource: { dimensions?: DimMap } | null =
    overallBlock && typeof overallBlock === "object" && "dimensions" in overallBlock
      ? (overallBlock as { dimensions?: DimMap })
      : overallRow || cleanRow;
  const dimensions = dimensionsFromRow(dimSource);
  const missingDimensions = missingFromRow(dimSource);

  const weakestRaw =
    (overallBlock && typeof overallBlock === "object" && "weakest" in overallBlock
      ? (overallBlock as { weakest?: { dimension?: string; score?: number } }).weakest
      : null) ||
    overallRow?.weakest ||
    cleanRow?.weakest ||
    CORD_UMS_CLEAN.weakest;

  const gateRaw =
    (overallBlock && typeof overallBlock === "object" && "gate" in overallBlock
      ? (overallBlock as { gate?: { pass?: boolean; reasons?: string[] } }).gate
      : null) ||
    overallRow?.gate ||
    CORD_UMS_CLEAN.gate;

  return {
    agent: "muse-spark-1.3",
    variant: "overall",
    profile: String(scores?.profile || "balanced"),
    ums: overallUms,
    ci_95: overallCi,
    gate: {
      pass: Boolean(gateRaw?.pass),
      reasons: (gateRaw?.reasons || []).map(String),
    },
    weakest: {
      dimension: String(weakestRaw?.dimension || CORD_UMS_CLEAN.weakest.dimension),
      score: Number(weakestRaw?.score ?? CORD_UMS_CLEAN.weakest.score),
    },
    dimensions: dimensions.length ? dimensions : CORD_UMS_CLEAN.dimensions,
    sourceNote: "cord suite · muse-spark-1.3 · overall + clean · balanced",
    overallUms,
    overallCi,
    cleanUms,
    cleanCi,
    missingDimensions: missingDimensions.length
      ? missingDimensions
      : CORD_UMS_CLEAN.missingDimensions,
  };
}
