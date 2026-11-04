"use client";

import { useMemo, useState } from "react";
import type { TraceSpan } from "@/lib/types";
import { isSampleFrameSpan, spanTMs } from "@/lib/video";

type DagNode =
  | { kind: "span"; span: TraceSpan }
  | {
      kind: "frame_group";
      id: string;
      spans: TraceSpan[];
      parentIds: string[];
      tMin: number;
      tMax: number;
    };

/** Compact SVG DAG; collapses parallel "sample frame" spans into one expandable group. */
export function SpanDag({ spans, title }: { spans: TraceSpan[]; title?: string }) {
  const [expanded, setExpanded] = useState(false);

  const { nodes, edges } = useMemo(() => buildCollapsed(spans, expanded), [spans, expanded]);

  if (!spans.length) {
    return (
      <div className="rounded border border-dashed border-border bg-paper px-3 py-6 text-center text-xs text-ink/50">
        No span graph in this suite.
      </div>
    );
  }

  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = edges.filter((e) => e.to === id).map((e) => e.from);
    const d = parents.length ? 1 + Math.max(...parents.map((p) => depthOf(p, seen))) : 0;
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => depthOf(n.id));

  const byLayer = new Map<number, Array<{ id: string; label: string; sub: string; clickable?: boolean }>>();
  for (const n of nodes) {
    const d = depth.get(n.id) || 0;
    const arr = byLayer.get(d) || [];
    if (n.kind === "frame_group") {
      arr.push({
        id: n.id,
        label: `${n.spans.length} frame spans`,
        sub: `t = ${(n.tMin / 1000).toFixed(0)} to ${(n.tMax / 1000).toFixed(0)} s · click`,
        clickable: true,
      });
    } else {
      const parents = n.span.parent_span_ids || [];
      arr.push({
        id: n.id,
        label: (n.span.name || n.id).slice(0, 24),
        sub: `${n.span.type || "span"}${parents.length > 1 ? ` · join×${parents.length}` : ""}`,
      });
    }
    byLayer.set(d, arr);
  }

  const maxLayer = Math.max(...byLayer.keys(), 0);
  const colW = 170;
  const rowH = 56;
  const width = (maxLayer + 1) * colW + 40;
  const height = Math.max(...[...byLayer.values()].map((a) => a.length), 1) * rowH + 40;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of byLayer) {
    list.forEach((s, i) => {
      pos.set(s.id, { x: 20 + layer * colW, y: 20 + i * rowH });
    });
  }

  const frameGroup = nodes.find((n) => n.kind === "frame_group");

  return (
    <div className="overflow-x-auto rounded border border-border bg-white p-2">
      {title ? (
        <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
          {title}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[480px] w-full" role="img" aria-label="Span DAG">
        <defs>
          <marker
            id="dagArrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6A7B93" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return (
            <path
              key={`${e.from}-${e.to}`}
              d={`M ${a.x + 140} ${a.y + 18} C ${a.x + 160} ${a.y + 18}, ${b.x - 10} ${b.y + 18}, ${b.x} ${b.y + 18}`}
              fill="none"
              stroke="#A9B3C1"
              strokeWidth="1.25"
              markerEnd="url(#dagArrow)"
            />
          );
        })}
        {[...byLayer.values()].flat().map((s) => {
          const p = pos.get(s.id)!;
          const isGroup = s.id.startsWith("__frames__");
          return (
            <g
              key={s.id}
              style={{ cursor: s.clickable ? "pointer" : "default" }}
              onClick={() => {
                if (s.clickable) setExpanded((v) => !v);
              }}
            >
              <rect
                x={p.x}
                y={p.y}
                width={140}
                height={36}
                rx={6}
                fill={isGroup ? "#EEF1F5" : "#F4F6F9"}
                stroke={isGroup ? "#0B8F7A" : "#D7DDE7"}
                strokeWidth={1.25}
                strokeDasharray={isGroup && !expanded ? "4 3" : undefined}
              />
              <text x={p.x + 8} y={p.y + 15} style={{ fontSize: 10, fontWeight: 600 }} fill="#101B2D">
                {s.label}
              </text>
              <text x={p.x + 8} y={p.y + 28} style={{ fontSize: 9 }} fill="#6A7B93">
                {s.sub}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="px-1 text-[10px] text-ink/45">
        {spans.length} spans
        {frameGroup && frameGroup.kind === "frame_group"
          ? expanded
            ? " · frame group expanded"
            : ` · ${frameGroup.spans.length} frames collapsed (click to expand)`
          : ""}
        {" · "}multi-parent joins shown when a span lists several parent_span_ids
      </p>
    </div>
  );
}

function buildCollapsed(spans: TraceSpan[], expanded: boolean) {
  const frames = spans.filter(isSampleFrameSpan);
  if (expanded || frames.length < 2) {
    const edges: Array<{ from: string; to: string }> = [];
    for (const s of spans) {
      for (const p of s.parent_span_ids || []) edges.push({ from: p, to: s.id });
    }
    return {
      nodes: spans.map((span) => ({ kind: "span" as const, span, id: span.id })),
      edges,
    };
  }

  const frameIds = new Set(frames.map((f) => f.id));
  const tVals = frames.map((f) => spanTMs(f)).filter((n): n is number => n != null);
  const tMin = tVals.length ? Math.min(...tVals) : 0;
  const tMax = tVals.length ? Math.max(...tVals) : 0;
  const parentIds = [...new Set(frames.flatMap((f) => f.parent_span_ids || []))];
  const groupId = "__frames__";

  const nodes: Array<DagNode & { id: string }> = [];
  for (const s of spans) {
    if (frameIds.has(s.id)) continue;
    nodes.push({ kind: "span", span: s, id: s.id });
  }
  nodes.push({
    kind: "frame_group",
    id: groupId,
    spans: frames,
    parentIds,
    tMin,
    tMax,
  });

  const edges: Array<{ from: string; to: string }> = [];
  for (const p of parentIds) edges.push({ from: p, to: groupId });

  for (const s of spans) {
    if (frameIds.has(s.id)) continue;
    const parents = s.parent_span_ids || [];
    const usesFrames = parents.some((p) => frameIds.has(p));
    if (usesFrames) {
      edges.push({ from: groupId, to: s.id });
      for (const p of parents) {
        if (!frameIds.has(p)) edges.push({ from: p, to: s.id });
      }
    } else {
      for (const p of parents) edges.push({ from: p, to: s.id });
    }
  }

  return { nodes, edges };
}
