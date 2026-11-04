"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { DataTable, type ColumnDef } from "@/components/studio/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { listSessions } from "@/lib/api";
import type { SuiteData } from "@/lib/types";

type SessionRow = {
  id: string;
  title: string;
  traces: number;
  models: string[];
  tool_calls: number;
  errors: number;
  started: string | null;
};

function truncate(text: string, max = 72) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function spanStats(traces: SuiteData["traces"]) {
  let tool_calls = 0;
  let errors = 0;
  let hasSpans = false;
  for (const tr of traces) {
    const spans = tr.spans || [];
    if (spans.length) hasSpans = true;
    for (const s of spans) {
      if ((s.type || "").toLowerCase() === "tool") tool_calls += 1;
      if ((s.status || "").toLowerCase() === "error" || s.error) errors += 1;
    }
  }
  return { tool_calls: hasSpans ? tool_calls : 0, errors: hasSpans ? errors : 0 };
}

function sessionsFromSuite(data: SuiteData): SessionRow[] {
  const started = data.meta.created || null;
  return (data.cases || []).map((c) => {
    const traces = (data.traces || []).filter((t) => t.case_id === c.id);
    const models = [...new Set(traces.map((t) => t.agent).filter(Boolean))];
    const { tool_calls, errors } = spanStats(traces);
    const title = c.question ? truncate(c.question) : c.id;
    return {
      id: c.id,
      title,
      traces: traces.length,
      models,
      tool_calls,
      errors,
      started,
    };
  });
}

export default function SessionsPage() {
  const { mode } = useApiMode();
  const suiteCtx = useSuite();
  const router = useRouter();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tick, setTick] = useState(0);

  const loadLive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSessions();
      setRows(
        data.map((s) => ({
          id: s.session_id,
          title: s.session_id,
          traces: s.trace_count,
          models: s.agents || [],
          tool_calls: s.tool_call_count ?? 0,
          errors: s.error_count ?? 0,
          started: s.started || null,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sessions");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "live") {
      void loadLive();
      return;
    }
    if (suiteCtx.loading) {
      setLoading(true);
      setError(null);
      return;
    }
    if (suiteCtx.error) {
      setLoading(false);
      setError(suiteCtx.error);
      setRows([]);
      return;
    }
    setRows(sessionsFromSuite(suiteCtx.data));
    setLoading(false);
    setError(null);
  }, [mode, suiteCtx.loading, suiteCtx.error, suiteCtx.data, loadLive, tick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.models.some((m) => m.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: ColumnDef<SessionRow>[] = useMemo(
    () => [
      {
        id: "session",
        header: "Session",
        cell: (r) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{r.title}</div>
            {r.title !== r.id ? (
              <div className="truncate font-mono text-[10px] text-ink/40">{r.id}</div>
            ) : null}
          </div>
        ),
      },
      {
        id: "traces",
        header: "Traces",
        className: "tabular-nums",
        cell: (r) => r.traces,
      },
      {
        id: "models",
        header: "Models",
        cell: (r) => (r.models.length ? r.models.join(", ") : "—"),
      },
      {
        id: "tool_calls",
        header: "Tool calls",
        className: "tabular-nums",
        cell: (r) => r.tool_calls,
      },
      {
        id: "errors",
        header: "Errors",
        className: "tabular-nums",
        cell: (r) => r.errors,
      },
      {
        id: "started",
        header: "Started",
        cell: (r) => (r.started ? new Date(r.started).toLocaleString() : "—"),
      },
    ],
    [],
  );

  function onRefresh() {
    if (mode === "live") {
      void loadLive();
    } else {
      suiteCtx.reload();
      setTick((t) => t + 1);
    }
  }

  return (
    <>
      <Topbar title="Sessions" />
      <main className="space-y-4 p-4">
        <PageHeader
          title="Sessions"
          description="Group related traces into a single conversation or task."
          action={
            <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          }
        />

        <FilterBar>
          <Input
            className="h-8 max-w-xs"
            placeholder="Search sessions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </FilterBar>

        {loading ? <SkeletonBlock rows={6} /> : null}
        {!loading && error ? (
          <ErrorState title="Could not load sessions" detail={error} onRetry={onRefresh} />
        ) : null}
        {!loading && !error ? (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/sessions/view/?id=${encodeURIComponent(r.id)}`)}
            empty={
              <EmptyState
                title="No sessions yet"
                detail="Sessions appear when related traces share a conversation or task. Open Traces to explore individual runs."
                action={
                  <Button type="button" size="sm" variant="outline" onClick={() => router.push("/traces/")}>
                    Browse traces
                  </Button>
                }
              />
            }
          />
        ) : null}
      </main>
    </>
  );
}
