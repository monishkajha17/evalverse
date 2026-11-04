"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import type { MediaAsset } from "@/lib/api";
import {
  buildGraphModel,
  fmtMsShort,
  typeColor,
  type GraphNodeModel,
  type NormalizedSpan,
} from "@/lib/trace-model";
import { cn } from "@/lib/utils";

const NODE_W = 200;
const NODE_H = 72;

function layoutWithDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 56, marginx: 16, marginy: 16 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: (pos?.x || 0) - NODE_W / 2,
        y: (pos?.y || 0) - NODE_H / 2,
      },
    };
  });
}

function SpanFlowNode({ data, selected }: NodeProps) {
  const model = data.model as GraphNodeModel;
  const colors = typeColor(model.type);
  const isGroup = model.kind === "group";
  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 shadow-sm",
        selected && "ring-2 ring-teal/40",
        model.failed && "border-crimson",
      )}
      style={{
        width: NODE_W,
        background: colors.bg,
        borderColor: model.failed ? "#D4285C" : colors.border,
        color: colors.fg,
        borderWidth: model.failed ? 2 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-slateish" />
      <div className="truncate text-[11px] font-semibold leading-tight">{model.label}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] opacity-80">
        {model.kind === "media" && model.sha ? (
          <span className="font-mono">sha {(model.sha || "").slice(0, 10)}</span>
        ) : (
          <>
            <span>{model.sublabel || model.type}</span>
            {model.latencyMs != null ? <span>{fmtMsShort(model.latencyMs)}</span> : null}
            {model.tokens != null ? <span>{model.tokens} tok</span> : null}
          </>
        )}
      </div>
      {isGroup ? (
        <div className="mt-1 text-[10px] font-medium underline-offset-2 opacity-70">Click to expand</div>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-slateish" />
    </div>
  );
}

const nodeTypes: NodeTypes = { spanNode: SpanFlowNode };

export function TraceGraph({
  spans,
  media,
  selectedId,
  onSelect,
}: {
  spans: NormalizedSpan[];
  media: MediaAsset[];
  selectedId?: string | null;
  onSelect?: (id: string | null, meta?: { groupExpand?: string }) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const { nodes: models, edges: edgeModels } = useMemo(
    () => buildGraphModel(spans, media, expanded),
    [spans, media, expanded],
  );

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = models.map((m) => ({
      id: m.id,
      type: "spanNode",
      position: { x: 0, y: 0 },
      data: { model: m },
      selected: selectedId === m.id || selectedId === m.spanId,
    }));
    const rawEdges: Edge[] = edgeModels.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#94A3B8" },
      style: { stroke: "#94A3B8", strokeWidth: 1.25 },
    }));
    return { nodes: layoutWithDagre(rawNodes, rawEdges), edges: rawEdges };
  }, [models, edgeModels, selectedId]);

  const onNodeClick = useCallback(
    (_: ReactMouseEvent, node: Node) => {
      const model = node.data.model as GraphNodeModel;
      if (model.kind === "group") {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(model.id);
          return next;
        });
        onSelect?.(model.memberIds?.[0] || model.id, { groupExpand: model.id });
        return;
      }
      onSelect?.(model.spanId || model.id);
    },
    [onSelect],
  );

  useEffect(() => {
    // reset expansion when span set identity changes
    setExpanded(new Set());
  }, [spans]);

  if (!spans.length && !media.length) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center text-xs text-ink/45">
        No spans to graph.
      </div>
    );
  }

  return (
    <div className="h-full min-h-[280px] w-full min-w-0 overflow-hidden rounded-xl border border-hairline bg-surface">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.6}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect?.(null)}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        colorMode={
          typeof document !== "undefined" && document.documentElement.classList.contains("dark")
            ? "dark"
            : "light"
        }
      >
        <Background gap={16} size={1} color="var(--st-hairline)" />
        <Controls showInteractive={false} className="!border-hairline !bg-raised !shadow-sm" />
        <MiniMap
          pannable
          zoomable
          className="!border-hairline !bg-raised"
          nodeColor={(n) => {
            const m = n.data?.model as GraphNodeModel | undefined;
            return m ? typeColor(m.type).border : "#94A3B8";
          }}
        />
      </ReactFlow>
    </div>
  );
}
