"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Badge } from "@/components/ui/badge";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/state-block";
import { useApiMode } from "@/context/api-mode";
import { getSession, getTrace, type SessionDetail, type TraceDetail } from "@/lib/api";
import { resolveMediaSrc, sourceChipClass, statusChipClass } from "@/lib/trace-helpers";
import { fmtTokens } from "@/lib/utils";

function SessionsViewInner() {
  const params = useSearchParams();
  const id = params.get("id") || "";
  const { mode } = useApiMode();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [details, setDetails] = useState<Record<string, TraceDetail>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "live" || !id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const s = await getSession(id);
        if (cancelled) return;
        setSession(s);
        const map: Record<string, TraceDetail> = {};
        await Promise.all(
          (s.traces || []).slice(0, 12).map(async (t) => {
            try {
              map[t.id] = await getTrace(t.id);
            } catch {
              /* skip */
            }
          }),
        );
        if (!cancelled) setDetails(map);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load session");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, id]);

  const thumbs = useMemo(() => {
    const out: Array<{ traceId: string; src: string; label: string }> = [];
    for (const [tid, tr] of Object.entries(details)) {
      const media = (tr.media || []).find((m) => (m.modality || "").includes("image") || (m.mime || "").startsWith("image/"));
      if (!media) continue;
      out.push({
        traceId: tid,
        src: resolveMediaSrc(media),
        label: tr.tags?.find((t) => ["clean", "blur", "noise", "lowres"].includes(t)) || tr.name || tid.slice(0, 8),
      });
    }
    return out;
  }, [details]);

  return (
    <>
      <Topbar title="Session" />
      <main className="space-y-3 p-4">
        <div className="text-xs text-ink/50">
          <Link href="/sessions/" className="text-teal hover:underline">
            ← Sessions
          </Link>
        </div>
        {!id ? <EmptyBlock title="Missing session id" detail="Open a session from the list." /> : null}
        {mode === "snapshot" ? (
          <EmptyBlock title="Live API required" detail="Session detail is only available in Live mode." />
        ) : null}
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorBlock title="Failed to load session" detail={error} /> : null}

        {session && !loading ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{session.session_id}</h2>
              <Badge className="border-border bg-white text-ink/70">{session.trace_count} traces</Badge>
              <Badge className="border-border bg-white text-ink/70">
                {(session.agents || []).join(", ") || "no agents"}
              </Badge>
              <Badge className="border-border bg-muted text-ink/60">
                tools {session.tool_call_count ?? 0} · errors {session.error_count ?? 0}
              </Badge>
            </div>

            {thumbs.length > 1 ? (
              <div className="rounded-lg border border-border bg-white p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  Variant thumbnails
                </div>
                <div className="flex flex-wrap gap-2">
                  {thumbs.map((t) => (
                    <Link
                      key={t.traceId}
                      href={`/traces/view/?id=${encodeURIComponent(t.traceId)}`}
                      className="block w-28 rounded border border-border hover:border-teal"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={t.src} alt={t.label} className="h-20 w-full object-cover" />
                      <div className="truncate px-1 py-0.5 text-[10px] text-ink/60">{t.label}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="overflow-auto rounded-lg border border-border bg-white">
              <table className="sticky-table w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="text-ink/60">
                    <th className="px-3 py-2">Trace</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Variant / tags</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Tool calls</th>
                    <th className="px-3 py-2">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {(session.traces || []).map((t) => (
                    <tr key={t.id} className="border-t border-border hover:bg-muted/50">
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/traces/view/?id=${encodeURIComponent(t.id)}`}
                          className="font-medium text-teal hover:underline"
                        >
                          {t.name || t.id}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5">{t.agent || "—"}</td>
                      <td className="px-3 py-1.5">{(t.tags || []).join(", ") || "—"}</td>
                      <td className="px-3 py-1.5">
                        <Badge className={statusChipClass(t.status)}>{t.status || "unknown"}</Badge>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">{t.tool_call_count ?? 0}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {fmtTokens({
                          input_tokens: t.input_tokens ?? undefined,
                          output_tokens: t.output_tokens ?? undefined,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

export default function SessionViewPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading session…" />}>
      <SessionsViewInner />
    </Suspense>
  );
}
