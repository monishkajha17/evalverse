"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HighlightedCode } from "@/components/marketing/highlighted-code";
import {
  EVIDENCE_JSON,
  EVALUATOR_CURL,
  JUDGE_CLI,
  POLICY_CURL,
  SDK_SNIPPET,
  TOOL_SPAN,
} from "@/components/marketing/snippets";

type PanelTab = "interface" | "code";

type Item = {
  id: string;
  title: string;
  blurb: string;
  code: string;
  codeLabel: string;
};

const ITEMS: Item[] = [
  {
    id: "traces",
    title: "Multimodal traces",
    blurb: "Media lineage, parallel turns, and a join into evaluation — one DAG.",
    code: SDK_SNIPPET,
    codeLabel: "sdk.py",
  },
  {
    id: "evidence",
    title: "Evidence-grounded evaluation",
    blurb: "Teal expected vs crimson claimed. Right number, wrong place.",
    code: EVIDENCE_JSON,
    codeLabel: "evidence_grounding.json",
  },
  {
    id: "builder",
    title: "Evaluators you create",
    blurb: "Rubric prompts with {{input}} chips, a judge model, and a test run.",
    code: EVALUATOR_CURL,
    codeLabel: "curl",
  },
  {
    id: "judge",
    title: "A judge, measured",
    blurb: "False-accept, false-reject, and a without-the-image control.",
    code: JUDGE_CLI,
    codeLabel: "shell",
  },
  {
    id: "online",
    title: "Online evaluation",
    blurb: "Live traces, a 100% sample policy, and an alert when it fires.",
    code: POLICY_CURL,
    codeLabel: "curl",
  },
  {
    id: "tools",
    title: "Tool-call verification",
    blurb: "Schema, grounding, and acting while unsure — checked on the span.",
    code: TOOL_SPAN,
    codeLabel: "tool_span.py",
  },
  {
    id: "ums",
    title: "One score, with its evidence",
    blurb: "UMS is a weighted view. The dimensions beside it are the evidence.",
    code: `# UMS is computed server-side from dimension scores.
# See Studio → System / Judge for the live gauge.`,
    codeLabel: "note",
  },
];

type SnapshotNums = {
  falseAccept: string;
  falseReject: string;
  withoutImage: string;
  ums: string;
  umsCi: string;
  gate: string;
  dims: Array<{ name: string; value: number }>;
  source: "data" | "sample";
  evaluators: number;
};

function useSnapshotNums(): SnapshotNums {
  const [nums, setNums] = useState<SnapshotNums>({
    falseAccept: "0/30",
    falseReject: "0/30",
    withoutImage: "sample",
    ums: "0.85",
    umsCi: "0.79–0.91",
    gate: "PASS",
    dims: [
      { name: "Perception", value: 0.82 },
      { name: "Grounding", value: 0.78 },
      { name: "Honesty", value: 0.79 },
      { name: "Tools", value: 0.88 },
    ],
    source: "sample",
    evaluators: 19,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cord = await (await fetch("/data/cord.json", { cache: "no-store" })).json();
        const audit = (cord.results || []).find(
          (r: { evaluator_id?: string }) => r.evaluator_id === "judge_audit",
        );
        const expl: string = audit?.explanation || "";
        const fa = expl.match(/false-accept\s+([\d/]+)/i)?.[1];
        const fr = expl.match(/false-reject\s+([\d/]+)/i)?.[1];
        const registry = Array.isArray(cord.registry) ? cord.registry.length : 19;
        const dims = (cord.dimension_summary || [])
          .filter((r: { variant?: string; agent?: string }) => r.variant === "clean" && r.agent)
          .slice(0, 4)
          .map((r: { dimension?: string; mean_score?: number }) => ({
            name: String(r.dimension || "dim").slice(0, 18),
            value: typeof r.mean_score === "number" ? r.mean_score : 0,
          }));
        if (!cancelled) {
          setNums((prev) => ({
            ...prev,
            falseAccept: fa || prev.falseAccept,
            falseReject: fr || prev.falseReject,
            withoutImage: "control",
            evaluators: registry || prev.evaluators,
            dims: dims.length ? dims : prev.dims,
            source: fa || fr ? "data" : "sample",
            // UMS block not present in snapshot → keep labelled sample
            ums: prev.ums,
            umsCi: prev.umsCi,
            gate: prev.gate,
          }));
        }
      } catch {
        /* keep sample */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return nums;
}

function PanelShell({
  tab,
  setTab,
  children,
  code,
  codeLabel,
}: {
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  children: React.ReactNode;
  code: string;
  codeLabel: string;
}) {
  return (
    <div className="mk-panel flex min-h-[520px] flex-col overflow-hidden">
      <div className="flex items-center gap-1 border-b border-[var(--mk-line)] px-3 py-2">
        {(["interface", "code"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`mk-mono min-h-[44px] rounded-md px-3 text-xs capitalize ${
              tab === t ? "bg-[rgba(142,197,255,0.12)] text-[var(--mk-accent)]" : "text-[var(--mk-muted)]"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "interface" ? "Interface" : "Code"}
          </button>
        ))}
      </div>
      <div className="relative flex-1 p-4">
        {tab === "interface" ? (
          <div className="mk-crossfade h-full">{children}</div>
        ) : (
          <HighlightedCode code={code} label={codeLabel} />
        )}
      </div>
    </div>
  );
}

function TracesMock() {
  return (
    <div className="space-y-4">
      <svg viewBox="0 0 560 280" className="h-auto w-full" role="img" aria-label="Span DAG">
        <rect x="20" y="110" width="90" height="44" rx="8" fill="#0A1220" stroke="#1B2A41" />
        <text x="38" y="136" fill="#8EC5FF" style={{ fontSize: 11, fontFamily: "monospace" }}>
          media
        </text>
        {[0, 1, 2, 3, 4].map((i) => {
          const y = 24 + i * 48;
          return (
            <g key={i}>
              <path d={`M 110 132 C 150 132, 150 ${y + 18}, 190 ${y + 18}`} fill="none" stroke="#1B2A41" />
              <rect x="190" y={y} width="130" height="36" rx="8" fill="#0A1220" stroke="#1B2A41" />
              <text x="200" y={y + 22} fill="#8CA0BC" style={{ fontSize: 10, fontFamily: "monospace" }}>
                {`transcribe turn ${i + 1}`}
              </text>
              <path d={`M 320 ${y + 18} C 360 ${y + 18}, 360 132, 400 132`} fill="none" stroke="#1B2A41" />
            </g>
          );
        })}
        <rect x="400" y="110" width="100" height="44" rx="8" fill="#0A1220" stroke="#8EC5FF" />
        <text x="418" y="136" fill="#8EC5FF" style={{ fontSize: 11, fontFamily: "monospace" }}>
          model call
        </text>
        <path d="M 500 132 H 520" stroke="#1B2A41" />
        <rect x="460" y="200" width="90" height="44" rx="8" fill="#0A1220" stroke="#2DD4BF" />
        <text x="474" y="226" fill="#2DD4BF" style={{ fontSize: 11, fontFamily: "monospace" }}>
          evaluation
        </text>
        <path d="M 450 154 C 450 180, 490 180, 505 200" fill="none" stroke="#1B2A41" />
      </svg>
      <div className="flex flex-wrap gap-2">
        <span className="mk-chip">original → noise → what the model saw</span>
        <span className="mk-chip">sha256 · a1f3…c9e2</span>
      </div>
    </div>
  );
}

function EvidenceMock() {
  return (
    <div className="relative mx-auto max-w-md">
      <svg viewBox="0 0 360 300" className="h-auto w-full" role="img" aria-label="Evidence boxes">
        <rect x="40" y="20" width="220" height="260" rx="10" fill="#0A1220" stroke="#1B2A41" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="60" y={50 + i * 28} width={140 - i * 8} height="8" rx="2" fill="#1B2A41" />
        ))}
        <rect x="200" y="200" width="40" height="12" rx="2" fill="#E6F1FF" opacity="0.5" />
        <rect x="180" y="188" width="70" height="36" rx="6" fill="rgba(45,212,191,0.12)" stroke="#2DD4BF" strokeWidth="2" />
        <rect
          x="56"
          y="96"
          width="120"
          height="44"
          rx="6"
          fill="rgba(244,63,94,0.08)"
          stroke="#F43F5E"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
        <path d="M 176 118 C 210 118, 220 180, 215 206" fill="none" stroke="#F59E0B" strokeDasharray="4 3" />
      </svg>
      <span className="mk-chip absolute bottom-3 left-3 border-[rgba(245,158,11,0.45)] text-[var(--mk-amber)]">
        Right answer, wrong place
      </span>
    </div>
  );
}

function BuilderMock() {
  return (
    <div className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="mk-mono text-[11px] text-[var(--mk-muted)]">Name</span>
        <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] px-3 py-2 mk-mono text-xs">
          receipt_total_rubric
        </div>
      </label>
      <label className="block space-y-1">
        <span className="mk-mono text-[11px] text-[var(--mk-muted)]">Rubric prompt</span>
        <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] px-3 py-3 text-xs leading-relaxed text-[var(--mk-muted)]">
          Score whether the total is grounded in the receipt given{" "}
          <span className="mk-chip mx-0.5">{"{{input}}"}</span>
          <span className="mk-chip mx-0.5">{"{{output}}"}</span>
          <span className="mk-chip mx-0.5">{"{{tool_calls}}"}</span>
        </div>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mk-mono mb-1 text-[11px] text-[var(--mk-muted)]">Judge model</div>
          <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] px-3 py-2 mk-mono text-xs">
            muse-wonder-1.0 ▾
          </div>
        </div>
        <div>
          <div className="mk-mono mb-1 text-[11px] text-[var(--mk-muted)]">Pass threshold</div>
          <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] px-3 py-2 mk-mono text-xs">
            0.80
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-[rgba(45,212,191,0.35)] bg-[rgba(45,212,191,0.06)] px-3 py-3">
        <div className="mk-mono text-[11px] text-[var(--mk-teal)]">Test on a trace · pass</div>
        <div className="mt-1 text-xs text-[var(--mk-muted)]">score 0.91 · grounded_correct</div>
      </div>
    </div>
  );
}

function JudgeMock({ nums }: { nums: SnapshotNums }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mk-chip border-[rgba(142,197,255,0.35)] text-[var(--mk-accent)]">
          Independent judge
        </span>
        <span className="mk-chip">agent muse-spark-1.3</span>
        <span className="mk-chip">judge muse-wonder-1.0</span>
        {nums.source === "sample" ? <span className="mk-chip">sample</span> : <span className="mk-chip">from /data</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["false-accept", nums.falseAccept],
          ["false-reject", nums.falseReject],
          ["without the image", nums.withoutImage],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-[var(--mk-line)] bg-[#070d18] p-4">
            <div className="text-2xl font-light tracking-tight">{v}</div>
            <div className="mk-mono mt-1 text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnlineMock() {
  const rows = [
    { id: "tr_8f2a", agent: "muse-spark-1.3", tag: "live" },
    { id: "tr_11c0", agent: "muse-spark-1.3", tag: "live" },
    { id: "tr_9aa1", agent: "muse-spark-1.1", tag: "live" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="mk-live-dot" aria-hidden />
        <span className="mk-mono text-xs text-[var(--mk-teal)]">Live</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--mk-line)]">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between border-b border-[var(--mk-line)] px-3 py-2.5 last:border-0"
          >
            <span className="mk-mono text-xs">{r.id}</span>
            <span className="text-xs text-[var(--mk-muted)]">{r.agent}</span>
            <span className="mk-chip">{r.tag}</span>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[var(--mk-line)] bg-[#070d18] p-4">
        <div className="mk-mono text-xs text-[var(--mk-accent)]">Policy · live-sample</div>
        <div className="mt-1 text-xs text-[var(--mk-muted)]">
          sample rate 100% · answer_correctness, evidence_grounding
        </div>
      </div>
      <div className="rounded-xl border border-[rgba(244,63,94,0.35)] bg-[rgba(244,63,94,0.06)] px-3 py-2 text-xs">
        Alert · action_despite_abstention failed on tr_11c0
      </div>
    </div>
  );
}

function ToolsMock() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[rgba(45,212,191,0.35)] bg-[rgba(45,212,191,0.06)] p-4">
        <div className="mk-mono text-xs">check_duplicate ✓</div>
        <div className="mt-1 text-xs text-[var(--mk-muted)]">amount grounded · not a duplicate</div>
      </div>
      <div className="rounded-xl border border-[rgba(244,63,94,0.35)] bg-[rgba(244,63,94,0.06)] p-4">
        <div className="mk-mono text-xs text-[var(--mk-crimson)]">log_expense ✗</div>
        <div className="mt-1 text-xs text-[var(--mk-muted)]">
          logged 42.50 but the receipt says 24.50
        </div>
      </div>
      <div className="rounded-xl border border-[rgba(244,63,94,0.5)] px-3 py-2 mk-mono text-xs text-[var(--mk-crimson)]">
        acted while unsure
      </div>
    </div>
  );
}

function UmsMock({ nums }: { nums: SnapshotNums }) {
  const pct = Math.round(parseFloat(nums.ums) * 100);
  return (
    <div className="grid gap-6 mk:grid-cols-[180px_1fr] items-center">
      <div className="relative mx-auto h-40 w-40">
        <svg viewBox="0 0 120 120" className="h-full w-full">
          <circle cx="60" cy="60" r="48" fill="none" stroke="#1B2A41" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r="48"
            fill="none"
            stroke="#8EC5FF"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 301} 301`}
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="58" textAnchor="middle" fill="#E6F1FF" style={{ fontSize: 22, fontWeight: 300 }}>
            {nums.ums}
          </text>
          <text x="60" y="74" textAnchor="middle" fill="#8CA0BC" style={{ fontSize: 9, fontFamily: "monospace" }}>
            95% CI {nums.umsCi}
          </text>
        </svg>
        <span className="mk-chip absolute -bottom-1 left-1/2 -translate-x-1/2 border-[rgba(45,212,191,0.4)] text-[var(--mk-teal)]">
          gate {nums.gate}
        </span>
        {nums.source === "sample" ? (
          <span className="mk-chip absolute -top-1 right-0">sample</span>
        ) : null}
      </div>
      <div className="space-y-3">
        {nums.dims.map((d) => (
          <div key={d.name}>
            <div className="mb-1 flex justify-between mk-mono text-[11px] text-[var(--mk-muted)]">
              <span>{d.name}</span>
              <span>{d.value.toFixed(2)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#1B2A41]">
              <div
                className="h-full rounded-full bg-[var(--mk-accent)]"
                style={{ width: `${Math.min(100, Math.max(0, d.value * 100))}%` }}
              />
            </div>
          </div>
        ))}
        <p className="text-xs text-[var(--mk-muted)]">
          UMS is a weighted view. The dimensions beside it are the evidence.
        </p>
      </div>
    </div>
  );
}

export function ProductShowcase() {
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<PanelTab>("interface");
  const [paused, setPaused] = useState(false);
  const interacted = useRef(false);
  const listId = useId();
  const nums = useSnapshotNums();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const select = useCallback((i: number, fromUser = false) => {
    setActive(i);
    setTab("interface");
    if (fromUser) {
      interacted.current = true;
      setPaused(true);
    }
  }, []);

  useEffect(() => {
    if (reduceMotion || interacted.current || paused) return;
    const id = window.setInterval(() => {
      if (interacted.current) return;
      setActive((a) => (a + 1) % ITEMS.length);
      setTab("interface");
    }, 8000);
    return () => window.clearInterval(id);
  }, [paused, reduceMotion]);

  const onKeyNav = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      select((i + 1) % ITEMS.length, true);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      select((i - 1 + ITEMS.length) % ITEMS.length, true);
    }
  };

  const item = ITEMS[active];

  const panel = (() => {
    switch (item.id) {
      case "traces":
        return <TracesMock />;
      case "evidence":
        return <EvidenceMock />;
      case "builder":
        return <BuilderMock />;
      case "judge":
        return <JudgeMock nums={nums} />;
      case "online":
        return <OnlineMock />;
      case "tools":
        return <ToolsMock />;
      case "ums":
        return <UmsMock nums={nums} />;
      default:
        return null;
    }
  })();

  return (
    <div
      className="grid items-start gap-6 mk:grid-cols-[1.15fr_0.85fr]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        if (!interacted.current) setPaused(false);
      }}
      onFocusCapture={() => setPaused(true)}
    >
      <div className="order-1 mk:order-none">
        <PanelShell tab={tab} setTab={setTab} code={item.code} codeLabel={item.codeLabel}>
          <div key={item.id} className="mk-crossfade">
            {panel}
          </div>
        </PanelShell>
      </div>

      <div className="order-2 mk:order-none" role="list" aria-label="Product features">
        {ITEMS.map((it, i) => {
          const open = i === active;
          return (
            <div key={it.id} className="border-b border-[var(--mk-line)]" role="listitem">
              <button
                type="button"
                id={`${listId}-${it.id}`}
                aria-expanded={open}
                aria-controls={`${listId}-panel-${it.id}`}
                className="flex w-full min-h-[52px] items-start justify-between gap-3 py-4 text-left"
                onClick={() => select(i, true)}
                onKeyDown={(e) => onKeyNav(e, i)}
              >
                <div>
                  <div className={`text-base tracking-tight ${open ? "text-[var(--mk-text)]" : "text-[var(--mk-muted)]"}`}>
                    {it.title}
                  </div>
                  {open ? <p className="mt-1 text-sm text-[var(--mk-muted)]">{it.blurb}</p> : null}
                </div>
                <span className="mk-mono text-lg text-[var(--mk-muted)]" aria-hidden>
                  {open ? "−" : "+"}
                </span>
              </button>
              <div id={`${listId}-panel-${it.id}`} hidden={!open} className="sr-only">
                {it.blurb}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
