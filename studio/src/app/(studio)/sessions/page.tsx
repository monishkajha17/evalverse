"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { OnboardingEmpty } from "@/components/studio/onboarding-empty";
import { SampleChip } from "@/components/studio/sample-chip";
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
import { isSampleSession } from "@/lib/sample-data";
import type { SuiteData } from "@/lib/types";

type SessionRow = {
  id: string;
  title: string;
  traces: number;
  models: string[];
  tool_calls: number;
  errors: number;
  started: string | null;
  sample: boolean;
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
      sample: false,
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
          sample: isSampleSession(s.session_id),
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
            <div className="flex items-center gap-2">
              <div className="truncate font-medium text-ink">{r.title}</div>
              {r.sample ? <SampleChip /> : null}
            </div>
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

  const liveEmpty = mode === "live" && !loading && !error && rows.length === 0;

  return (
    <>
      <Topbar hideTitle />
      <main className="min-w-0 space-y-4 overflow-x-hidden p-4">
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

        {error ? (
          <ErrorState title="Could not load sessions" detail={error} onRetry={onRefresh} />
        ) : null}

        {liveEmpty ? (
          <OnboardingEmpty title="No sessions in this project yet" onSeeded={onRefresh} />
        ) : null}

        {!error && !liveEmpty ? (
          <>
            <FilterBar>
              <Input
                className="h-8 max-w-xs"
                placeholder="Search sessions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search sessions"
              />
            </FilterBar>

            {loading ? <SkeletonBlock rows={6} /> : null}
            {!loading ? (
              <DataTable
                columns={columns}
                rows={filtered}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/sessions/view/?id=${encodeURIComponent(r.id)}`)}
                empty={
                  <EmptyState
                    title="No sessions match"
                    detail="Try a different search, or open Traces to explore individual runs."
                    action={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => router.push("/traces/")}
                      >
                        Browse traces
                      </Button>
                    }
                  />
                }
              />
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}
