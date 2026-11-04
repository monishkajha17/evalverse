"use client";

import { useEffect, useState } from "react";
import { loadIndex, loadSuite } from "@/lib/data";

const FALLBACK = {
  traces: 248,
  sessions: 64,
  evaluators: 19,
  suites: 5,
};

type Stats = typeof FALLBACK;

export function LiveStats() {
  const [stats, setStats] = useState<Stats>(FALLBACK);
  const [source, setSource] = useState<"live" | "fallback">("fallback");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadIndex();
        const preferred =
          index.find((e) => e.suite === "cord")?.suite ||
          index.find((e) => e.suite === "wonder")?.suite ||
          index[0]?.suite;
        let traces = 0;
        let sessions = 0;
        let evaluators = FALLBACK.evaluators;
        if (preferred) {
          const suite = await loadSuite(preferred);
          traces = suite.traces?.length || suite.runs?.length || 0;
          const sessionIds = new Set<string>();
          for (const t of suite.traces || []) {
            const sid = (t as { session_id?: string }).session_id;
            if (sid) sessionIds.add(sid);
          }
          sessions = sessionIds.size || Math.max(1, Math.round(traces / 4));
          const versions = suite.meta?.manifest?.evaluator_versions as
            | Record<string, string>
            | undefined;
          if (versions && typeof versions === "object") {
            evaluators = Object.keys(versions).length;
          } else if (suite.registry?.length) {
            evaluators = suite.registry.length;
          }
        }
        if (!cancelled) {
          setStats({
            traces: traces || FALLBACK.traces,
            sessions: sessions || FALLBACK.sessions,
            evaluators: evaluators || FALLBACK.evaluators,
            suites: index.length || FALLBACK.suites,
          });
          setSource("live");
        }
      } catch {
        if (!cancelled) {
          setStats(FALLBACK);
          setSource("fallback");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items: Array<{ label: string; value: number }> = [
    { label: "Traces", value: stats.traces },
    { label: "Sessions", value: stats.sessions },
    { label: "Evaluators", value: stats.evaluators },
    { label: "Suites", value: stats.suites },
  ];

  return (
    <section aria-label="Snapshot totals" className="border-y border-border bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 sm:grid-cols-4 sm:px-6">
        {items.map((item) => (
          <div key={item.label} className="text-center sm:text-left">
            <div className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {item.value.toLocaleString()}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wide text-ink/45">{item.label}</div>
          </div>
        ))}
      </div>
      <p className="sr-only">
        {source === "live" ? "Counts loaded from local /data snapshot." : "Showing static fallback counts."}
      </p>
    </section>
  );
}
