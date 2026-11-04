"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { useApiMode } from "@/context/api-mode";
import { listSessions, type SessionSummary } from "@/lib/api";

export default function SessionsPage() {
  const { mode } = useApiMode();
  const [rows, setRows] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "live") {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listSessions()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load sessions");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return (
    <>
      <Topbar title="Sessions" />
      <main className="space-y-3 p-4">
        {mode === "snapshot" ? (
          <EmptyBlock
            title="Sessions require Live mode"
            detail="Start the EvalVerse API and set NEXT_PUBLIC_MODE=live (or leave default)."
          />
        ) : null}
        {loading ? <LoadingBlock label="Loading sessions…" /> : null}
        {error ? <ErrorBlock title="Could not load sessions" detail={error} /> : null}
        {!loading && !error && mode === "live" ? (
          <div className="overflow-auto rounded-lg border border-border bg-white">
            <table className="sticky-table w-full min-w-[800px] border-collapse text-left text-xs">
              <thead>
                <tr className="text-ink/60">
                  <th className="px-3 py-2 font-semibold">Session</th>
                  <th className="px-3 py-2 font-semibold">Traces</th>
                  <th className="px-3 py-2 font-semibold">Agents</th>
                  <th className="px-3 py-2 font-semibold">Tool calls</th>
                  <th className="px-3 py-2 font-semibold">Errors</th>
                  <th className="px-3 py-2 font-semibold">Started</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-ink/50">
                      No sessions yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((s) => (
                    <tr key={s.session_id} className="border-t border-border hover:bg-muted/60">
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/sessions/view/?id=${encodeURIComponent(s.session_id)}`}
                          className="font-medium text-teal hover:underline"
                        >
                          {s.session_id}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{s.trace_count}</td>
                      <td className="px-3 py-1.5">{(s.agents || []).join(", ") || "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{s.tool_call_count ?? 0}</td>
                      <td className="px-3 py-1.5 tabular-nums">{s.error_count ?? 0}</td>
                      <td className="px-3 py-1.5">{s.started ? new Date(s.started).toLocaleString() : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </main>
    </>
  );
}
