"use client";

import type { TraceSpan } from "@/lib/types";

/** Compact SVG DAG for spans with multi-parent joins (e.g. 5 transcibes → model). */
export function SpanDag({ spans, title }: { spans: TraceSpan[]; title?: string }) {
  if (!spans.length) {
    return (
      <div className="rounded border border-dashed border-border bg-paper px-3 py-6 text-center text-xs text-ink/50">
        No span graph in this suite.
      </div>
    );
  }

  const ids = spans.map((s) => s.id);
  const index = Object.fromEntries(ids.map((id, i) => [id, i]));
  // layered layout by max parent depth
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const span = spans.find((s) => s.id === id);
    const parents = span?.parent_span_ids || [];
    const d = parents.length ? 1 + Math.max(...parents.map((p) => depthOf(p, seen))) : 0;
    depth.set(id, d);
    return d;
  };
  spans.forEach((s) => depthOf(s.id));

  const byLayer = new Map<number, TraceSpan[]>();
  for (const s of spans) {
    const d = depth.get(s.id) || 0;
    const arr = byLayer.get(d) || [];
    arr.push(s);
    byLayer.set(d, arr);
  }
  const maxLayer = Math.max(...byLayer.keys(), 0);
  const colW = 160;
  const rowH = 56;
  const width = (maxLayer + 1) * colW + 40;
  const height = Math.max(...[...byLayer.values()].map((a) => a.length), 1) * rowH + 40;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of byLayer) {
    list.forEach((s, i) => {
      pos.set(s.id, { x: 20 + layer * colW, y: 20 + i * rowH });
    });
  }

  return (
    <div className="overflow-x-auto rounded border border-border bg-white p-2">
      {title ? <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">{title}</div> : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[480px] w-full" role="img" aria-label="Span DAG">
        <defs>
          <marker id="dagArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6A7B93" />
          </marker>
        </defs>
        {spans.flatMap((s) =>
          (s.parent_span_ids || []).map((p) => {
            const a = pos.get(p);
            const b = pos.get(s.id);
            if (!a || !b) return null;
            return (
              <path
                key={`${p}-${s.id}`}
                d={`M ${a.x + 130} ${a.y + 18} C ${a.x + 150} ${a.y + 18}, ${b.x - 10} ${b.y + 18}, ${b.x} ${b.y + 18}`}
                fill="none"
                stroke="#A9B3C1"
                strokeWidth="1.25"
                markerEnd="url(#dagArrow)"
              />
            );
          }),
        )}
        {spans.map((s) => {
          const p = pos.get(s.id)!;
          return (
            <g key={s.id}>
              <rect x={p.x} y={p.y} width={130} height={36} rx={6} fill="#F4F6F9" stroke="#D7DDE7" strokeWidth={1.25} />
              <text x={p.x + 8} y={p.y + 15} style={{ fontSize: 10, fontWeight: 600 }} fill="#101B2D">
                {(s.name || s.id).slice(0, 22)}
              </text>
              <text x={p.x + 8} y={p.y + 28} style={{ fontSize: 9 }} fill="#6A7B93">
                {s.type || "span"}
                {(s.parent_span_ids || []).length > 1 ? ` · join×${s.parent_span_ids!.length}` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="px-1 text-[10px] text-ink/45">
        {spans.length} spans
        {index && Object.keys(index).length
          ? ` · multi-parent joins highlighted when a span lists several parent_span_ids`
          : ""}
      </p>
    </div>
  );
}
