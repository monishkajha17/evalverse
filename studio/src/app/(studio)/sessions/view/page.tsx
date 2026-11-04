"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SkeletonBlock,
} from "@/components/studio/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiMode } from "@/context/api-mode";
import { useSuite } from "@/context/suite-context";
import { getSession, type SessionDetail, type TraceListItem } from "@/lib/api";
import type { TraceRow } from "@/lib/types";

type TimelineItem = {
  id: string;
  label: string;
  agent?: string | null;
  status?: string | null;
  at?: string | null;
};

function truncate(text: string, max = 96) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fromLiveTraces(traces: TraceListItem[]): TimelineItem[] {
  return traces.map((t) => ({
    id: t.id,
    label: t.name || t.id,
    agent: t.agent,
    status: t.status,
    at: t.started_at || null,
  }));
}

function fromSuiteTraces(traces: TraceRow[]): TimelineItem[] {
  return traces.map((t) => ({
    id: t.id,
    label: `${t.agent} · ${t.variant}`,
    agent: t.agent,
    status: null,
    at: null,
  }));
}

function SessionsViewInner() {
  const params = useSearchParams();
  const id =
    params.get("id") ||
    (typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id") || ""
      : "");
  const { mode } = useApiMode();
  const { data, loading: suiteLoading, error: suiteError, reload } = useSuite();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [demoTitle, setDemoTitle] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(null);
      setSession(null);
      setTimeline([]);
      return;
    }

    if (mode === "live") {
      let cancelled = false;
      setLoading(true);
      setError(null);
      (async () => {
        try {
          const s = await getSession(id);
          if (cancelled) return;
          setSession(s);
          setDemoTitle(null);
          setTimeline(fromLiveTraces(s.traces || []));
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : "Could not load session");
            setSession(null);
            setTimeline([]);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (suiteLoading) {
      setLoading(true);
      return;
    }
    if (suiteError) {
      setLoading(false);
      setError(suiteError);
      return;
    }

    const caseRow = (data.cases || []).find((c) => c.id === id);
    const traces = (data.traces || []).filter((t) => t.case_id === id);
    if (!caseRow && !traces.length) {
      setLoading(false);
      setError(null);
      setSession(null);
      setDemoTitle(null);
      setTimeline([]);
      return;
    }
    const models = [...new Set(traces.map((t) => t.agent).filter(Boolean))];
    let tool_calls = 0;
    let errors = 0;
    for (const tr of traces) {
      for (const s of tr.spans || []) {
        if ((s.type || "").toLowerCase() === "tool") tool_calls += 1;
        if ((s.status || "").toLowerCase() === "error" || s.error) errors += 1;
      }
    }
    setSession({
      session_id: id,
      trace_count: traces.length,
      started: data.meta.created || null,
      agents: models,
      tool_call_count: tool_calls,
      error_count: errors,
      traces: [],
    });
    setDemoTitle(caseRow?.question ? truncate(caseRow.question) : id);
    setTimeline(fromSuiteTraces(traces));
    setLoading(false);
    setError(null);
  }, [mode, id, data, suiteLoading, suiteError]);

  const title = useMemo(() => {
    if (demoTitle) return demoTitle;
    if (session) return session.session_id;
    return id || "Session";
  }, [demoTitle, session, id]);

  function onRetry() {
    if (mode === "live") {
      setLoading(true);
      setError(null);
      getSession(id)
        .then((s) => {
          setSession(s);
          setTimeline(fromLiveTraces(s.traces || []));
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load session"))
        .finally(() => setLoading(false));
    } else {
      reload();
    }
  }

  return (
    <>
      <Topbar title="Session" />
      <main className="space-y-4 p-4">
        <div className="text-xs text-ink/50">
          <Link href="/sessions/" className="text-teal hover:underline">
            ← Sessions
          </Link>
        </div>

        {!id ? (
          <EmptyState
            title="No session selected"
            detail="Open a session from the list to see its traces."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/sessions/">Back to sessions</Link>
              </Button>
            }
          />
        ) : null}

        {id && loading ? <SkeletonBlock rows={5} /> : null}
        {id && !loading && error ? (
          <ErrorState title="Could not load session" detail={error} onRetry={onRetry} />
        ) : null}

        {id && !loading && !error && !session ? (
          <EmptyState
            title="Session not found"
            detail="This id does not match a session in the current project or demo suite."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/sessions/">Back to sessions</Link>
              </Button>
            }
          />
        ) : null}

        {id && !loading && !error && session ? (
          <>
            <PageHeader
              title={title}
              description="Traces that belong to this conversation or task, in order."
            />

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-border bg-white text-ink/70">{session.trace_count} traces</Badge>
              <Badge className="border-border bg-white text-ink/70">
                {(session.agents || []).join(", ") || "no models"}
              </Badge>
              <Badge className="border-border bg-muted text-ink/60">
                tools {session.tool_call_count ?? 0} · errors {session.error_count ?? 0}
              </Badge>
              {session.started ? (
                <Badge className="border-border bg-white text-ink/55">
                  started {new Date(session.started).toLocaleString()}
                </Badge>
              ) : null}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {timeline.length === 0 ? (
                  <p className="text-xs text-ink/50">No traces in this session.</p>
                ) : (
                  <ol className="relative space-y-0 border-l border-border pl-4">
                    {timeline.map((item, i) => (
                      <li key={item.id} className="relative pb-5 last:pb-0">
                        <span className="absolute -left-[1.15rem] top-1.5 h-2.5 w-2.5 rounded-full border border-teal bg-white" />
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link
                            href={`/traces/view/?id=${encodeURIComponent(item.id)}`}
                            className="text-sm font-medium text-teal hover:underline"
                          >
                            {item.label}
                          </Link>
                          <span className="text-[11px] tabular-nums text-ink/45">
                            {item.at ? new Date(item.at).toLocaleString() : `Step ${i + 1}`}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-ink/55">
                          {item.agent ? <span>{item.agent}</span> : null}
                          {item.status ? (
                            <Badge className="border-border bg-muted text-ink/60">{item.status}</Badge>
                          ) : null}
                          <span className="font-mono text-ink/35">{item.id}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </>
  );
}

export default function SessionViewPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading session" />}>
      <SessionsViewInner />
    </Suspense>
  );
}
