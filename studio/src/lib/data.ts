import type { SuiteData, SuiteIndexEntry, TraceRow } from "./types";

const EMPTY: SuiteData = {
  meta: {},
  cases: [],
  runs: [],
  results: [],
  dimension_summary: [],
  disagreements: [],
  registry: [],
  judged: [],
  traces: [],
  plan: [],
  conflicts: [],
  scores: null,
};

export async function loadIndex(): Promise<SuiteIndexEntry[]> {
  const res = await fetch("/data/index.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load index.json (${res.status})`);
  const data = (await res.json()) as SuiteIndexEntry[];
  return Array.isArray(data) ? data : [];
}

export async function loadSuite(suite: string): Promise<SuiteData> {
  const res = await fetch(`/data/${encodeURIComponent(suite)}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load suite ${suite} (${res.status})`);
  const raw = (await res.json()) as Partial<SuiteData>;
  let scores: SuiteData["scores"] =
    raw.scores && typeof raw.scores === "object" ? (raw.scores as SuiteData["scores"]) : null;
  // Cord export often omits scores; marketing (and Studio) can use the sidecar.
  const scoreRows = scores?.rows || [];
  const hasOverall = Boolean(scores && "overall" in scores && scores.overall != null);
  if (suite === "cord" && !hasOverall && !scoreRows.length) {
    try {
      const side = await fetch("/data/cord-scores.json", { cache: "no-store" });
      if (side.ok) {
        const block = (await side.json()) as SuiteData["scores"];
        if (block && typeof block === "object") scores = block;
      }
    } catch {
      /* keep null */
    }
  }
  return {
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
    cases: Array.isArray(raw.cases) ? raw.cases : [],
    runs: Array.isArray(raw.runs) ? raw.runs : [],
    results: Array.isArray(raw.results) ? raw.results : [],
    dimension_summary: Array.isArray(raw.dimension_summary) ? raw.dimension_summary : [],
    disagreements: Array.isArray(raw.disagreements) ? raw.disagreements : [],
    registry: Array.isArray(raw.registry) ? raw.registry : [],
    judged: Array.isArray(raw.judged) ? raw.judged : [],
    traces: Array.isArray(raw.traces) ? raw.traces : [],
    plan: Array.isArray(raw.plan) ? raw.plan : [],
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    scores,
  };
}

export function emptySuite(): SuiteData {
  return EMPTY;
}

export function findTrace(data: SuiteData, id: string): TraceRow | undefined {
  return data.traces.find((t) => t.id === id);
}

export function findRun(data: SuiteData, agent: string, caseId: string, variant: string) {
  return data.runs.find(
    (r) => r.agent === agent && r.case_id === caseId && r.condition === variant,
  );
}

export function findCase(data: SuiteData, caseId: string) {
  return data.cases.find((c) => c.id === caseId);
}

export function resultsForTrace(data: SuiteData, trace: TraceRow) {
  const ids = new Set<string>();
  for (const span of trace.spans || []) {
    for (const rid of span.result_ids || []) ids.add(rid);
  }
  const matched = data.results.filter((r) => ids.has(r.id));
  if (matched.length) return matched;
  return data.results.filter(
    (r) =>
      r.target?.agent === trace.agent &&
      r.target?.case_id === trace.case_id &&
      (r.target?.variant === trace.variant || r.target?.variant === "all"),
  );
}
