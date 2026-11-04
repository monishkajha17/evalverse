"use client";

import { useEffect, useState } from "react";
import { loadIndex, loadSuite } from "@/lib/data";
import { useFadeUp } from "@/hooks/use-fade-up";

type Stats = {
  receipts: number;
  audio: number;
  traces: number;
  evaluators: number;
  hasVideo: boolean;
  source: "data" | "fallback";
};

const FALLBACK: Stats = {
  receipts: 30,
  audio: 12,
  traces: 248,
  evaluators: 19,
  hasVideo: true,
  source: "fallback",
};

export function StatsSection() {
  const [stats, setStats] = useState<Stats>(FALLBACK);
  const fade = useFadeUp();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadIndex();
        const hasVideo = index.some((e) => e.modality === "video" || e.suite === "video");
        const cord = index.find((e) => e.suite === "cord");
        const audio = index.find((e) => e.suite === "audio");
        let traces = 0;
        let evaluators = FALLBACK.evaluators;
        const preferred = cord?.suite || index[0]?.suite;
        if (preferred) {
          const suite = await loadSuite(preferred);
          traces = suite.traces?.length || suite.runs?.length || 0;
          const versions = suite.meta?.manifest?.evaluator_versions as Record<string, string> | undefined;
          if (versions) evaluators = Object.keys(versions).length;
          else if (suite.registry?.length) evaluators = suite.registry.length;
        }
        // Sum traces from smaller suites only (skip video — large snapshot).
        let totalTraces = traces;
        for (const e of index.filter(
          (x) => x.suite !== preferred && x.modality !== "video" && x.suite !== "video",
        )) {
          try {
            const s = await loadSuite(e.suite);
            totalTraces += s.traces?.length || s.runs?.length || 0;
          } catch {
            /* skip */
          }
        }
        const videoEntry = index.find((x) => x.modality === "video" || x.suite === "video");
        if (videoEntry?.n_cases) {
          // Approximate video traces from index metadata when the file is too large to fetch.
          totalTraces += videoEntry.n_cases * (videoEntry.agents?.length || 1) * (videoEntry.variants?.length || 1);
        }
        if (!cancelled) {
          setStats({
            receipts: cord?.n_cases || FALLBACK.receipts,
            audio: audio?.n_cases || FALLBACK.audio,
            traces: totalTraces || FALLBACK.traces,
            evaluators: evaluators || FALLBACK.evaluators,
            hasVideo,
            source: "data",
          });
        }
      } catch {
        if (!cancelled) setStats(FALLBACK);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = [
    {
      value: stats.receipts,
      label: "Receipts evaluated",
      desc: "CORD v2 document cases in the image suites.",
    },
    {
      value: stats.audio,
      label: "Audio conversations",
      desc: "LibriSpeech-based multi-turn conversations.",
    },
    {
      value: stats.traces,
      label: "Traces stored",
      desc: "Instrumentations across snapshot suites.",
    },
    {
      value: stats.evaluators,
      label: "Evaluators registered",
      desc: "Built-in registry plus suite versions.",
    },
  ];

  return (
    <section ref={fade.ref} className={`${fade.className} mx-auto max-w-6xl px-4 py-20 sm:px-6`}>
      <h2 className="mk-headline text-3xl sm:text-4xl">Measured on real data</h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 mk:grid-cols-4">
        {cards.map((c) => (
          <article key={c.label} className="mk-panel p-5">
            <div className="text-3xl font-light tracking-tight tabular-nums">
              {c.value.toLocaleString()}
            </div>
            <div className="mk-mono mt-2 text-xs uppercase tracking-wide text-[var(--mk-accent)]">
              {c.label}
            </div>
            <p className="mt-2 text-sm text-[var(--mk-muted)]">{c.desc}</p>
            {stats.source === "fallback" ? (
              <p className="mk-mono mt-2 text-[10px] text-[var(--mk-muted)]">fallback</p>
            ) : null}
          </article>
        ))}
      </div>
      <p className="mt-8 max-w-3xl text-sm text-[var(--mk-muted)]">
        Release 0.1: the images, audio
        {stats.hasVideo ? " and video" : ""} suites run on the Meta Model API.
        {stats.hasVideo
          ? " Video is evaluated as timestamped frames."
          : null}
      </p>
    </section>
  );
}
