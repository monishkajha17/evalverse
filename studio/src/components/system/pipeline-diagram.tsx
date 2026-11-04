"use client";

export type PipelineCounts = {
  datasets: number | null;
  traces: number | null;
  queueJobs: number | null;
  evaluators: number | null;
  results: number | null;
  policies: number | null;
};

type Node = {
  id: string;
  label: string;
  sub?: string;
  href: string;
  count: number | null;
  countLabel: string;
  x: number;
  y: number;
  w?: number;
};

export function PipelineDiagram({ counts }: { counts: PipelineCounts }) {
  const nodes: Node[] = [
    { id: "inputs", label: "Inputs", sub: "dataset · SDK · OTLP", href: "/datasets/", count: counts.datasets, countLabel: "datasets", x: 24, y: 110 },
    { id: "orch", label: "Orchestrator", sub: "run plan / queue", href: "/evaluations/", count: counts.queueJobs, countLabel: "jobs", x: 200, y: 110 },
    { id: "agent", label: "Agent under test", sub: "model + tools", href: "/traces/", count: counts.traces, countLabel: "traces", x: 390, y: 40 },
    { id: "store", label: "Trace store", sub: "spans · media · results", href: "/traces/", count: counts.traces, countLabel: "traces", x: 390, y: 180 },
    { id: "evals", label: "Evaluators", sub: "by category", href: "/evaluators/", count: counts.evaluators, countLabel: "evals", x: 580, y: 110 },
    { id: "judge", label: "Judge", sub: "audit · controls", href: "/judge/", count: counts.results, countLabel: "results", x: 760, y: 40 },
    { id: "agg", label: "Aggregator", sub: "dimensions + UMS", href: "/system/#score", count: counts.results, countLabel: "stored", x: 760, y: 180 },
    { id: "studio", label: "Studio", sub: "this UI", href: "/overview/", count: counts.policies, countLabel: "policies on", x: 940, y: 110 },
  ];

  const edges: Array<[string, string]> = [
    ["inputs", "orch"],
    ["orch", "agent"],
    ["orch", "store"],
    ["agent", "store"],
    ["store", "evals"],
    ["evals", "judge"],
    ["evals", "agg"],
    ["judge", "agg"],
    ["agg", "studio"],
  ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white p-3">
      <svg viewBox="0 0 1120 280" className="h-auto min-w-[900px] w-full" role="img" aria-label="EvalVerse pipeline">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6A7B93" />
          </marker>
        </defs>
        {edges.map(([a, b]) => {
          const na = byId[a];
          const nb = byId[b];
          const x1 = na.x + (na.w || 150);
          const y1 = na.y + 36;
          const x2 = nb.x;
          const y2 = nb.y + 36;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${a}-${b}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="#A9B3C1"
              strokeWidth="1.5"
              markerEnd="url(#arrow)"
            />
          );
        })}
        {nodes.map((n) => {
          const w = n.w || 150;
          const h = 72;
          return (
            <a key={n.id} href={n.href}>
              <rect
                x={n.x}
                y={n.y}
                width={w}
                height={h}
                rx={8}
                fill="#F4F6F9"
                stroke="#D7DDE7"
                strokeWidth={1.5}
              />
              <text x={n.x + 12} y={n.y + 22} fill="#101B2D" style={{ fontSize: 12, fontWeight: 600 }}>
                {n.label}
              </text>
              <text x={n.x + 12} y={n.y + 38} fill="#6A7B93" style={{ fontSize: 10 }}>
                {n.sub}
              </text>
              <text x={n.x + 12} y={n.y + 58} fill="#0B8F7A" style={{ fontSize: 11, fontWeight: 600 }}>
                {n.count == null ? "—" : n.count}{" "}
                <tspan fill="#6A7B93" style={{ fontWeight: 400 }}>
                  {n.countLabel}
                </tspan>
              </text>
            </a>
          );
        })}
      </svg>
      <p className="mt-1 text-[11px] text-ink/45">Click a stage to open the related Studio page. Counts prefer Live API, else the selected suite snapshot.</p>
    </div>
  );
}
