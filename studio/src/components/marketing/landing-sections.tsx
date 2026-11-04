"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BrowserFrame } from "@/components/marketing/browser-frame";
import { CodeSection } from "@/components/marketing/code-section";
import { FadeUp } from "@/components/marketing/fade-up";
import { GitHubMark } from "@/components/marketing/github-mark";
import { GlossaryTerm } from "@/components/marketing/glossary-term";
import { HeroFlow } from "@/components/marketing/hero-flow";
import {
  EVIDENCE_CASE,
  FINDINGS,
  FRAMEWORK_DIMS,
  GITHUB,
  RELEASE,
} from "@/components/marketing/landing-constants";
import {
  computeDimensionMarks,
  cordUmsFromSuite,
  type CordUmsView,
  type DimMark,
} from "@/components/marketing/landing-metrics";
import { loadIndex, loadSuite } from "@/lib/data";
import type { SuiteData } from "@/lib/types";

type CrossModalExample = {
  caseId: string;
  claimText: string;
  claimValue: string;
  receiptValue: string;
  expected: string;
  agentVerdict: string;
  caught: boolean;
  image: string;
  traceId: string;
};

type LandingData = {
  dimMarks: Record<string, DimMark>;
  wonder: {
    falseAccept: string;
    falseReject: string;
    withImage: string;
    withoutImage: string;
    agent: string;
    judge: string;
    independent: boolean;
  };
  compare: Array<{
    agent: string;
    correct: number;
    confidentlyWrong: number;
    couldNotRead: number;
    n: number;
  }>;
  exampleTraces: Array<{ id: string; agent: string; variant: string }>;
  crossModalExample: CrossModalExample | null;
  ums: CordUmsView;
  source: "data" | "snapshot";
};

const FALLBACK_MARKS: Record<string, DimMark> = {
  Perception: "measured in this release",
  Groundedness: "measured in this release",
  "Temporal grounding": "measured in this release",
  "Cross-modal consistency": "small sample (4 pairs)",
  Hallucination: "measured in this release",
  Completeness: "measured in this release",
  Reasoning: "measured in this release",
};

const FALLBACK: LandingData = {
  dimMarks: FALLBACK_MARKS,
  wonder: {
    falseAccept: "0/30",
    falseReject: "0/30",
    withImage: "1.000",
    withoutImage: "0.517",
    agent: "muse-spark-1.3",
    judge: "muse-wonder-1.0",
    independent: true,
  },
  compare: [
    { agent: "muse-spark-1.1", correct: 57, confidentlyWrong: 17, couldNotRead: 16, n: 90 },
    { agent: "muse-spark-1.3", correct: 54, confidentlyWrong: 13, couldNotRead: 23, n: 90 },
  ],
  exampleTraces: [
    { id: "muse-spark-1.3|cord_total_05|clean", agent: "muse-spark-1.3", variant: "clean" },
    { id: "muse-spark-1.3|cord_total_01|clean", agent: "muse-spark-1.3", variant: "clean" },
    { id: "muse-spark-1.1|cord_total_02|blur", agent: "muse-spark-1.1", variant: "blur" },
  ],
  crossModalExample: null,
  ums: cordUmsFromSuite(null),
  source: "snapshot",
};

function pickCrossModalExample(suite: SuiteData): CrossModalExample | null {
  const cases = suite.cases || [];
  const runs = suite.runs || [];
  const preferred =
    runs.find(
      (r) =>
        r.condition === "clean" &&
        String(r.expected_verdict || cases.find((c) => c.id === r.case_id)?.expected_verdict || "")
          .toLowerCase() === "inconsistent",
    ) || runs.find((r) => r.condition === "clean");
  if (!preferred) return null;
  const c = cases.find((x) => x.id === preferred.case_id);
  if (!c) return null;
  const expected = String(preferred.expected_verdict || c.expected_verdict || "");
  const got = String(preferred.verdict || "");
  const trace = (suite.traces || []).find(
    (t) => t.case_id === c.id && t.variant === preferred.condition && t.agent === preferred.agent,
  );
  return {
    caseId: c.id,
    claimText: String(c.claim_text || ""),
    claimValue: String(c.claim_value ?? ""),
    receiptValue: String(c.receipt_value ?? ""),
    expected,
    agentVerdict: got,
    caught: expected.toLowerCase() === got.toLowerCase() && expected.toLowerCase() === "inconsistent",
    image: String(c.image || ""),
    traceId: trace?.id || `${preferred.agent}|${c.id}|${preferred.condition}`,
  };
}

function boxToPct(
  box: [number, number, number, number],
  _size: [number, number],
): { left: string; top: string; width: string; height: string } {
  // boxes are on a 0–1000 normalized grid in this suite
  const scale = 1000;
  const [x0, y0, x1, y1] = box;
  return {
    left: `${(x0 / scale) * 100}%`,
    top: `${(y0 / scale) * 100}%`,
    width: `${((x1 - x0) / scale) * 100}%`,
    height: `${((y1 - y0) / scale) * 100}%`,
  };
}

function parseWonderAudit(suite: SuiteData) {
  const audit = suite.results.find((r) => r.evaluator_id === "judge_audit");
  const expl = audit?.explanation || "";
  const fa = expl.match(/false-accept\s+([\d/]+)/i)?.[1] || FALLBACK.wonder.falseAccept;
  const fr = expl.match(/false-reject\s+([\d/]+)/i)?.[1] || FALLBACK.wonder.falseReject;
  const jmd = suite.results.find((r) => r.evaluator_id === "judge_media_dependence");
  const jExpl = jmd?.explanation || "";
  const withImage = jExpl.match(/accuracy_with_image=([0-9.]+)/i)?.[1] || FALLBACK.wonder.withImage;
  const withoutImage =
    jExpl.match(/accuracy_without_image=([0-9.]+)/i)?.[1] || FALLBACK.wonder.withoutImage;
  const agent =
    (Array.isArray(suite.meta?.agents) && suite.meta.agents[0]) ||
    FALLBACK.wonder.agent;
  const judge = (typeof suite.meta?.judge === "string" && suite.meta.judge) || FALLBACK.wonder.judge;
  return {
    falseAccept: fa,
    falseReject: fr,
    withImage,
    withoutImage,
    agent: String(agent),
    judge: String(judge),
    independent: String(agent) !== String(judge),
  };
}

function degradedCompare(suite: SuiteData) {
  const out: LandingData["compare"] = [];
  for (const agent of ["muse-spark-1.1", "muse-spark-1.3"]) {
    const rows = suite.runs.filter(
      (r) => r.agent === agent && ["blur", "noise", "lowres"].includes(String(r.condition)),
    );
    if (!rows.length) continue;
    out.push({
      agent,
      n: rows.length,
      correct: rows.filter((r) => r.correct).length,
      confidentlyWrong: rows.filter(
        (r) => r.label === "misread" || r.label === "mislocated",
      ).length,
      couldNotRead: rows.filter((r) => r.label === "abstained").length,
    });
  }
  return out.length ? out : FALLBACK.compare;
}

function useLandingData(): LandingData {
  const [data, setData] = useState<LandingData>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const index = await loadIndex();
        const suitesById: Record<string, SuiteData> = {};
        await Promise.all(
          index.map(async (entry) => {
            try {
              suitesById[entry.suite] = await loadSuite(entry.suite);
            } catch {
              /* skip suite */
            }
          }),
        );

        const cord = suitesById.cord || (await loadSuite("cord"));
        const wonderSuite = suitesById.wonder || (await loadSuite("wonder"));
        const crossSuite = suitesById.crossmodal;
        const crossModalExample = crossSuite ? pickCrossModalExample(crossSuite) : null;
        const dimMarks = computeDimensionMarks(index, suitesById);
        const ums = cordUmsFromSuite(cord);
        const traces = (cord.traces || [])
          .filter((t) => t.variant === "clean" || t.variant === "blur")
          .slice(0, 3)
          .map((t) => ({ id: t.id, agent: t.agent, variant: t.variant }));

        if (!cancelled) {
          setData({
            dimMarks: Object.keys(dimMarks).length ? dimMarks : FALLBACK.dimMarks,
            wonder: parseWonderAudit(wonderSuite),
            compare: degradedCompare(cord),
            exampleTraces: traces.length ? traces : FALLBACK.exampleTraces,
            crossModalExample,
            ums,
            source: "data",
          });
        }
      } catch {
        if (!cancelled) setData(FALLBACK);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

function markFor(name: string, marks: Record<string, DimMark>): DimMark {
  return marks[name] || "defined, no data yet";
}

function SectionHead({
  kicker,
  title,
  def,
  glossary,
}: {
  kicker?: string;
  title: React.ReactNode;
  def: React.ReactNode;
  glossary?: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      {kicker ? <p className="mk-label">{kicker}</p> : null}
      <h2 className="mk-headline mt-3 text-3xl sm:text-4xl">{title}</h2>
      <p className="mk-def">{def}</p>
      {glossary}
    </div>
  );
}

function DagPanel() {
  return (
    <BrowserFrame url="evalverse · traces">
      <div className="p-4 sm:p-5">
        <svg
          viewBox="0 0 560 260"
          className="mk-dag-draw h-auto w-full"
          role="img"
          aria-label="Span graph: media to parallel frames to model call to evaluation"
        >
          <rect
            className="mk-dag-node"
            style={{ animationDelay: "0.2s" }}
            x="16"
            y="100"
            width="88"
            height="40"
            rx="8"
            fill="#0A1220"
            stroke="#8EC5FF"
          />
          <text x="34" y="124" fill="#8EC5FF" style={{ fontSize: 11, fontFamily: "monospace" }}>
            media
          </text>
          {[0, 1, 2].map((i) => {
            const y = 36 + i * 70;
            return (
              <g key={i}>
                <path
                  d={`M 104 120 C 140 120, 140 ${y + 18}, 176 ${y + 18}`}
                  fill="none"
                  stroke="#1B2A41"
                  strokeWidth="1.5"
                  style={{ animationDelay: `${0.15 * i}s` }}
                />
                <rect
                  className="mk-dag-node"
                  style={{ animationDelay: `${0.35 + 0.1 * i}s` }}
                  x="176"
                  y={y}
                  width="120"
                  height="36"
                  rx="8"
                  fill="#0A1220"
                  stroke="#1B2A41"
                />
                <text x="188" y={y + 22} fill="#8CA0BC" style={{ fontSize: 10, fontFamily: "monospace" }}>
                  {i === 1 ? "frame / turn" : `parallel ${i + 1}`}
                </text>
                <path
                  d={`M 296 ${y + 18} C 330 ${y + 18}, 330 120, 364 120`}
                  fill="none"
                  stroke="#1B2A41"
                  strokeWidth="1.5"
                  style={{ animationDelay: `${0.4 + 0.1 * i}s` }}
                />
              </g>
            );
          })}
          <rect
            className="mk-dag-node"
            style={{ animationDelay: "0.7s" }}
            x="364"
            y="100"
            width="96"
            height="40"
            rx="8"
            fill="#0A1220"
            stroke="#8EC5FF"
          />
          <text x="378" y="124" fill="#8EC5FF" style={{ fontSize: 11, fontFamily: "monospace" }}>
            model
          </text>
          <path
            d="M 460 120 H 484"
            fill="none"
            stroke="#1B2A41"
            strokeWidth="1.5"
            style={{ animationDelay: "0.85s" }}
          />
          <rect
            className="mk-dag-node"
            style={{ animationDelay: "0.95s" }}
            x="484"
            y="100"
            width="60"
            height="40"
            rx="8"
            fill="#0A1220"
            stroke="#2DD4BF"
          />
          <text x="492" y="124" fill="#2DD4BF" style={{ fontSize: 10, fontFamily: "monospace" }}>
            eval
          </text>
        </svg>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="mk-chip">original → blur / noise → model view</span>
          <span className="mk-chip">lineage · hash kept</span>
        </div>
      </div>
    </BrowserFrame>
  );
}

function EvidencePanel() {
  const truth = boxToPct(EVIDENCE_CASE.truthBox, EVIDENCE_CASE.size);
  const claimed = boxToPct(EVIDENCE_CASE.claimedBox, EVIDENCE_CASE.size);
  const showWrongPlace = EVIDENCE_CASE.stageKey === "correct_ungrounded";

  return (
    <BrowserFrame url={`evalverse · ${EVIDENCE_CASE.caseId}`}>
      <div className="grid gap-3 p-4 sm:grid-cols-[1.1fr_0.9fr] sm:p-5">
        <div className="relative overflow-hidden rounded-lg border border-[var(--mk-line)] bg-[#070d18]">
          <div
            className="relative mx-auto w-full max-w-[280px]"
            style={{ aspectRatio: `${EVIDENCE_CASE.size[0]} / ${EVIDENCE_CASE.size[1]}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={EVIDENCE_CASE.image}
              alt={`Receipt ${EVIDENCE_CASE.caseId} from CORD v2`}
              className="absolute inset-0 h-full w-full object-contain"
            />
            <div
              className="absolute border-2 border-[var(--mk-teal)] bg-[rgba(45,212,191,0.12)]"
              style={truth}
              title="True region"
            />
            <div
              className="absolute border-2 border-dashed border-[var(--mk-crimson)] bg-[rgba(244,63,94,0.1)]"
              style={claimed}
              title="Agent cited region"
            />
          </div>
          {showWrongPlace ? (
            <span className="mk-chip absolute bottom-2 left-2 border-[rgba(245,158,11,0.45)] text-[var(--mk-amber)]">
              {EVIDENCE_CASE.stageLabel}
            </span>
          ) : null}
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] p-3">
            <div className="mk-mono text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">
              Evaluator result
            </div>
            <div className="mt-1 text-sm">{EVIDENCE_CASE.evaluator.id}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="mk-chip border-[rgba(244,63,94,0.4)] text-[var(--mk-crimson)]">
                {EVIDENCE_CASE.evaluator.status}
              </span>
              <span className="mk-mono text-xs text-[var(--mk-muted)]">
                score {EVIDENCE_CASE.evaluator.score.toFixed(2)}
              </span>
              <span className="mk-chip">{EVIDENCE_CASE.evaluator.verdict}</span>
              <span className="mk-chip">{EVIDENCE_CASE.evaluator.label}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--mk-muted)]">
              {EVIDENCE_CASE.evaluator.explanation}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] p-3 text-xs leading-relaxed text-[var(--mk-muted)]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="mk-mono text-[10px] uppercase tracking-wide">Create your own evaluator</div>
              <span className="mk-example-badge">Example</span>
            </div>
            <label className="block">
              <span className="mk-mono text-[10px] text-[var(--mk-muted)]">Name</span>
              <input
                className="mk-field mt-1 w-full"
                defaultValue="receipt_grounding"
                readOnly
                aria-readonly
              />
            </label>
            <label className="mt-2 block">
              <span className="mk-mono text-[10px] text-[var(--mk-muted)]">Rubric prompt</span>
              <textarea
                className="mk-field mt-1 min-h-[64px] w-full resize-none"
                readOnly
                aria-readonly
                defaultValue="Score grounding given {{input}} {{output}}. Fail if the cited region misses the evidence."
              />
            </label>
            <label className="mt-2 block">
              <span className="mk-mono text-[10px] text-[var(--mk-muted)]">Judge model</span>
              <select className="mk-field mt-1 w-full" defaultValue="muse-wonder-1.0" disabled>
                <option value="muse-wonder-1.0">muse-wonder-1.0</option>
              </select>
            </label>
            <button type="button" className="mk-btn mk-btn-secondary mt-3 min-h-[36px] w-full text-[11px]" disabled>
              Test
            </button>
          </div>
          <p className="text-[10px] text-[var(--mk-muted)]">
            {EVIDENCE_CASE.caseId} · {EVIDENCE_CASE.agent} · {EVIDENCE_CASE.variant} ·{" "}
            {EVIDENCE_CASE.source}
          </p>
        </div>
      </div>
    </BrowserFrame>
  );
}

function JudgePanel({ wonder }: { wonder: LandingData["wonder"] }) {
  return (
    <BrowserFrame url="evalverse · judge">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {wonder.independent ? (
            <span className="mk-chip border-[rgba(142,197,255,0.35)] text-[var(--mk-accent)]">
              Independent judge: Muse Wonder graded Muse Spark
            </span>
          ) : null}
          <span className="mk-chip">agent {wonder.agent}</span>
          <span className="mk-chip">judge {wonder.judge}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["false accepts", wonder.falseAccept],
            ["false rejects", wonder.falseReject],
            ["accuracy with image", wonder.withImage],
            ["accuracy without image", wonder.withoutImage],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-[var(--mk-line)] bg-[#070d18] p-4">
              <div className="text-2xl font-light tracking-tight">{v}</div>
              <div className="mk-mono mt-1 text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">
                {k}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--mk-muted)]">Numbers from /data/wonder.json · Release {RELEASE}.</p>
      </div>
    </BrowserFrame>
  );
}

function ToolPanel() {
  return (
    <BrowserFrame url="evalverse · tool calls">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="mk-example-badge">Example</span>
          <span className="text-xs text-[var(--mk-muted)]">Illustrative tool-call checks — not live statistics.</span>
        </div>
        {[
          {
            name: "log_expense",
            status: "pass",
            detail: "Arguments valid · amount matches the cited total · currency IDR",
          },
          {
            name: "log_expense",
            status: "fail",
            detail: "Amount 128.00 does not match the grounded total 68,180",
          },
          {
            name: "book_slot",
            status: "blocked",
            detail: "No action when the agent answered unknown (could not read the input)",
          },
        ].map((row, i) => (
          <div
            key={`${row.name}-${i}`}
            className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] px-3 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="mk-mono text-xs">{row.name}</span>
              <span
                className={`mk-chip ${
                  row.status === "pass"
                    ? "border-[rgba(45,212,191,0.4)] text-[var(--mk-teal)]"
                    : row.status === "fail"
                      ? "border-[rgba(244,63,94,0.4)] text-[var(--mk-crimson)]"
                      : "border-[rgba(245,158,11,0.4)] text-[var(--mk-amber)]"
                }`}
              >
                {row.status}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-[var(--mk-muted)]">{row.detail}</p>
          </div>
        ))}
      </div>
    </BrowserFrame>
  );
}

function OfflinePanel({ compare }: { compare: LandingData["compare"] }) {
  return (
    <BrowserFrame url="evalverse · experiments">
      <div className="overflow-x-auto p-4 sm:p-5">
        <p className="mb-3 text-xs text-[var(--mk-muted)]">
          muse-spark-1.1 vs 1.3 on blur, noise and lowres · from /data/cord.json
        </p>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Correct</th>
              <th>Confidently wrong</th>
              <th>Could not read</th>
            </tr>
          </thead>
          <tbody>
            {compare.map((row) => (
              <tr key={row.agent}>
                <td className="mk-mono">{row.agent}</td>
                <td>
                  {row.correct}/{row.n}
                </td>
                <td>{row.confidentlyWrong}</td>
                <td>{row.couldNotRead}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BrowserFrame>
  );
}

function OnlinePanel({ traces }: { traces: LandingData["exampleTraces"] }) {
  return (
    <BrowserFrame url="evalverse · policies">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mk-example-badge">Example</span>
          <span className="text-xs text-[var(--mk-muted)]">Policy and trace list for illustration.</span>
        </div>
        <div className="rounded-lg border border-[var(--mk-line)] bg-[#070d18] p-3">
          <div className="mk-mono text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">Policy</div>
          <div className="mt-1 text-sm">live-sample</div>
          <p className="mt-2 text-xs text-[var(--mk-muted)]">
            Filter tags: live · sample rate 1.0 · evaluators: answer_correctness, evidence_grounding
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--mk-line)]">
          {traces.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mk-line)] px-3 py-2.5 last:border-0"
            >
              <span className="mk-mono break-all text-[11px]">{r.id}</span>
              <span className="text-xs text-[var(--mk-muted)]">{r.agent}</span>
              <span className="mk-chip">{r.variant}</span>
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

function ScorePanel({ ums }: { ums: LandingData["ums"] }) {
  const dims = useMemo(
    () => ums.dimensions.filter((d) => typeof d.score === "number"),
    [ums.dimensions],
  );
  const pct = Math.round(ums.overallUms * 100);
  const overallCi = `${ums.overallCi[0].toFixed(2)}–${ums.overallCi[1].toFixed(2)}`;
  const missing =
    ums.missingDimensions.length > 0
      ? ums.missingDimensions.join(", ")
      : "none";

  return (
    <BrowserFrame url="evalverse · scores">
      <div className="grid items-center gap-6 p-4 sm:grid-cols-[160px_1fr] sm:p-5">
        <div className="relative mx-auto h-36 w-36">
          <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
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
            <text x="60" y="56" textAnchor="middle" fill="#E6F1FF" style={{ fontSize: 20, fontWeight: 300 }}>
              {ums.overallUms.toFixed(2)}
            </text>
            <text x="60" y="72" textAnchor="middle" fill="#8CA0BC" style={{ fontSize: 9, fontFamily: "monospace" }}>
              CI {overallCi}
            </text>
          </svg>
          <span
            className={`mk-chip absolute -bottom-1 left-1/2 -translate-x-1/2 ${
              ums.gate.pass
                ? "border-[rgba(45,212,191,0.4)] text-[var(--mk-teal)]"
                : "border-[rgba(244,63,94,0.4)] text-[var(--mk-crimson)]"
            }`}
          >
            gate {ums.gate.pass ? "PASS" : "FAIL"}
          </span>
        </div>
        <div className="space-y-3">
          <div className="space-y-1 text-sm text-[var(--mk-fg)]">
            <p>
              All image conditions:{" "}
              <span className="font-medium tabular-nums">{ums.overallUms.toFixed(4)}</span>{" "}
              <span className="mk-mono text-[11px] text-[var(--mk-muted)]">({overallCi})</span>
            </p>
            <p>
              Clean images only:{" "}
              <span className="font-medium tabular-nums">{ums.cleanUms.toFixed(4)}</span>
            </p>
          </div>
          {dims.map((d) => (
            <div key={d.name}>
              <div className="mb-1 flex justify-between mk-mono text-[11px] text-[var(--mk-muted)]">
                <span>{d.name}</span>
                <span>{d.score.toFixed(2)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#1B2A41]">
                <div
                  className="h-full rounded-full bg-[var(--mk-accent)]"
                  style={{ width: `${Math.min(100, Math.max(0, d.score * 100))}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-xs text-[var(--mk-muted)]">
            Weakest: {ums.weakest.dimension} ({ums.weakest.score.toFixed(2)}). Dimensions with no
            data ({missing}) are left out and the weights re-balance.
          </p>
          <p className="mk-mono text-[10px] text-[var(--mk-muted)]">{ums.sourceNote}</p>
        </div>
      </div>
    </BrowserFrame>
  );
}

function FindingBars({
  bars,
}: {
  bars: ReadonlyArray<{ label: string; value: number; max: number }>;
}) {
  return (
    <div className="mt-4 space-y-2.5">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="mb-1 flex justify-between mk-mono text-[10px] text-[var(--mk-muted)]">
            <span>{b.label}</span>
            <span>
              {b.value}/{b.max}
            </span>
          </div>
          <div className="mk-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, (b.value / b.max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const MARQUEE_MODALITIES = [
  "Multimodal evals",
  "Images",
  "Video",
  "Voice",
  "Text",
  "Tool calls",
  "Cross-modal",
] as const;

const MARQUEE_DIMENSIONS = [
  "Perception",
  "Groundedness",
  "Temporal grounding",
  "Hallucination",
  "Completeness",
  "Reasoning",
  "Cross-modal consistency",
] as const;

const SHIFT_STAGES = [
  { label: "Text", fail: "Fluent but wrong", glyph: "Aa" },
  { label: "Image", fail: "Looked at the wrong place", glyph: "▣" },
  { label: "Voice", fail: "Misheard or misunderstood", glyph: "⌁" },
  { label: "Video", fail: "Right answer, wrong moment", glyph: "▶" },
  { label: "Actions", fail: "Acted when unsure", glyph: "⇒" },
] as const;

const MODALITY_MATRIX = [
  {
    name: "Image",
    input: "the photo",
    checks: "the answer, the region it cited, and what changes when the photo is blurred or noisy.",
    href: "/docs/concepts/modalities/",
  },
  {
    name: "Video",
    input: "sampled frames with timestamps",
    checks: "the moment it cited, event order, and the same questions with no frames.",
    href: "/docs/concepts/modalities/",
  },
  {
    name: "Voice",
    input: "a transcript per speaker turn",
    checks: "which stage failed, hearing or reasoning, and whether it cited the right moment.",
    href: "/docs/concepts/modalities/",
  },
  {
    name: "Text",
    input: "the prompt and the reply",
    checks: "which claims are supported by the evidence and which are not.",
    href: "/docs/concepts/evidence/",
  },
  {
    name: "Tool calls",
    input: "the arguments and the result",
    checks: "valid arguments, the right amount, the right order, and no action when unsure.",
    href: "/docs/concepts/traces-and-spans/",
  },
  {
    name: "Voice with image",
    input: "a spoken claim and a photo",
    checks: "whether what was said matches what the photo shows.",
    href: "/docs/concepts/cross-modal-consistency/",
  },
] as const;

function MarqueeBand({
  items,
  band,
}: {
  items: readonly string[];
  band: "a" | "b";
}) {
  const group = (
    <div className="mk-marquee-group">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="inline-flex items-center gap-3">
          {i > 0 ? <span className="mk-marquee-diamond" aria-hidden /> : null}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`mk-marquee mk-marquee-band-${band}`} aria-hidden="true">
      <div className={`mk-marquee-track mk-marquee-track-${band}`}>
        {group}
        {group}
      </div>
    </div>
  );
}

export function LandingSections() {
  const data = useLandingData();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
        <div className="mk-aurora" aria-hidden />
        <div className="mk-grid-fade" aria-hidden />
        <div className="relative z-10 mx-auto max-w-[1120px]">
          <p className="mk-label">Evaluation and observability for multimodal AI agents</p>
          <h1 className="mk-hero-title mt-4">
            <span className="mk-hero-title-line">Multimodal evals</span>
            <span className="mk-hero-title-line mk-headline-grad mk-hero-title-grad">
              for AI agents that see, hear and act.
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--mk-muted)] sm:text-lg">
            Agents are moving from reading text to seeing images, hearing voices and watching video.
            EvalVerse checks what they did with each one, and shows you where it went wrong.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup/" className="mk-btn mk-btn-primary">
              Start building
            </Link>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="mk-btn mk-btn-secondary">
              <GitHubMark />
              GitHub
            </a>
            <Link href="/overview/" className="text-sm text-[var(--mk-accent)] underline-offset-4 hover:underline">
              Open the live demo →
            </Link>
          </div>
          <p className="mk-mono mt-6 text-[11px] text-[var(--mk-muted)]">
            Built on the Meta Model API · Muse Spark · Muse Wonder · Muse Voice Transcribe
          </p>
        </div>
        <div className="mk-marquee-stack">
          <p className="sr-only">
            EvalVerse covers multimodal evals across images, video, voice, text, tool calls and
            cross-modal checks, including perception, groundedness, temporal grounding,
            hallucination, completeness, reasoning and cross-modal consistency.
          </p>
          <MarqueeBand items={MARQUEE_MODALITIES} band="a" />
          <MarqueeBand items={MARQUEE_DIMENSIONS} band="b" />
        </div>
        <div className="relative z-10 mx-auto mt-10 max-w-[1120px] px-4 sm:px-6">
          <HeroFlow />
        </div>
      </section>

      {/* The Shift */}
      <FadeUp id="shift" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <p className="mk-label">The shift</p>
          <h2 className="mk-headline mt-3 max-w-3xl text-3xl sm:text-4xl">
            Agents moved from reading text to seeing, hearing and watching.
          </h2>
          <p className="mk-def">
            Agents used to take text in and give text back. Now they read receipts from photos,
            listen to calls, watch screen recordings and take actions. Most evaluation still only
            grades the words they return.
          </p>

          <div className="mk-shift-stepper" aria-label="Modalities and the failures they can hide">
            <div className="mk-shift-rail" aria-hidden>
              <span className="mk-shift-pulse" />
            </div>
            {SHIFT_STAGES.map((stage) => (
              <div key={stage.label} className="mk-shift-stage">
                <span className="mk-shift-glyph" aria-hidden>
                  <span className="mk-mono text-[11px] leading-none">{stage.glyph}</span>
                </span>
                <span className="mk-shift-stage-label">{stage.label}</span>
                <span className="mk-shift-stage-fail">{stage.fail}</span>
              </div>
            ))}
          </div>

          <h3 className="mt-14 text-xl font-light tracking-tight sm:text-2xl">
            One platform, every modality
          </h3>
          <div className="mk-modality-matrix">
            <div className="mk-modality-matrix-head" aria-hidden>
              <span>Modality</span>
              <span>What goes in</span>
              <span>What EvalVerse checks</span>
            </div>
            {MODALITY_MATRIX.map((row) => (
              <Link key={row.name} href={row.href} className="mk-modality-matrix-row">
                <span className="mk-modality-name">{row.name}</span>
                <span className="mk-modality-cell">{row.input}</span>
                <span className="mk-modality-cell">{row.checks}</span>
              </Link>
            ))}
          </div>
        </div>
      </FadeUp>

      {/* How it works */}
      <FadeUp className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6">
          <SectionHead
            title="How it works"
            def="Three steps from a raw agent run to a clear failure."
          />
          <ol className="mk-steps mt-10 max-w-2xl">
            <li>
              <div className="mk-step-num">Step 1</div>
              <h3 className="mt-1 text-xl font-light tracking-tight">Send what your agent did</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">
                Use the Python SDK, OpenTelemetry, or the Try it page to send a{" "}
                <GlossaryTerm term="trace">trace</GlossaryTerm> — the full record of one agent run.
              </p>
            </li>
            <li>
              <div className="mk-step-num">Step 2</div>
              <h3 className="mt-1 text-xl font-light tracking-tight">EvalVerse checks it</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">
                <GlossaryTerm term="evaluator">Evaluators</GlossaryTerm> compare the answer with the
                evidence; a <GlossaryTerm term="judge">judge</GlossaryTerm> grades what rules cannot.
              </p>
            </li>
            <li>
              <div className="mk-step-num">Step 3</div>
              <h3 className="mt-1 text-xl font-light tracking-tight">See where it failed</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">
                A verdict per run, a score per dimension, and a trace you can open.
              </p>
            </li>
          </ol>
        </div>
      </FadeUp>

      {/* 01 Observe */}
      <FadeUp id="observe" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <SectionHead
            kicker="01 / Observe"
            title="Multimodal traces"
            def={
              <>
                A <GlossaryTerm term="trace">trace</GlossaryTerm> is the full record of one agent
                run. Most tools keep only the text. EvalVerse also keeps the image, audio or video
                itself, how it was changed, and every{" "}
                <GlossaryTerm term="span">span</GlossaryTerm> in between, including steps that run
                in parallel and join.
              </>
            }
          />
          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-[var(--mk-line)] bg-[#070d18] p-4">
              <p className="mk-mono mb-3 text-[10px] uppercase tracking-wide text-[var(--mk-muted)]">
                What EvalVerse stores for each input
              </p>
              <table className="mk-table">
                <thead>
                  <tr>
                    <th>Input</th>
                    <th>Stored</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Image</td>
                    <td>The file, its hash, and any blur or noise applied</td>
                  </tr>
                  <tr>
                    <td>Video</td>
                    <td>Sampled frames with timestamps</td>
                  </tr>
                  <tr>
                    <td>Text</td>
                    <td>The prompt and the reply</td>
                  </tr>
                  <tr>
                    <td>Voice</td>
                    <td>A transcript per speaker turn, with times</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mk-panel-grad p-1">
              <DagPanel />
            </div>
          </div>
          <div className="mt-6">
            <Link href="/traces/" className="mk-link-arrow">
              Open a trace <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </FadeUp>

      {/* 02 Evaluate */}
      <FadeUp id="evaluate" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <SectionHead
            kicker="02 / Evaluate"
            title="Evaluators that check where the agent looked"
            def={
              <>
                An <GlossaryTerm term="evaluator">evaluator</GlossaryTerm> is a check that scores
                one thing about a run. Ours also look at where the agent got its answer: the area of
                an image, or the moment in a video or audio clip.
              </>
            }
          />
          <div className="mk-panel-grad mt-10 p-1">
            <EvidencePanel />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/evaluators/" className="mk-link-arrow">
              Evaluators <span aria-hidden>→</span>
            </Link>
            <Link href="/evaluators/" className="mk-link-arrow">
              Create an evaluator <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </FadeUp>

      {/* Framework */}
      <FadeUp id="framework" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <SectionHead
            title="Questions we ask about every run"
            def="The evaluation framework. Each row is one dimension we score when the suite has data for it."
          />
          <div className="mt-10">
            {FRAMEWORK_DIMS.map((dim) => (
              <div key={dim.name} className="mk-dl-row">
                <div>
                  <div className="text-base font-medium tracking-tight">{dim.name}</div>
                  <div className="mk-mono mt-2 text-[10px] text-[var(--mk-accent)]">
                    {markFor(dim.name, data.dimMarks)}
                  </div>
                </div>
                <div>
                  <p className="text-sm leading-relaxed text-[var(--mk-muted)]">{dim.def}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {dim.media.map((m) => (
                      <span key={m} className="mk-chip">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-sm text-[var(--mk-muted)]">
            Also tracked: media dependence (did it need the file?), robustness (what happens when
            quality drops), honesty (declining vs confidently wrong), tool use and judge trust.
          </p>
          <div className="mt-6">
            <Link href="/docs/concepts/evaluation-dimensions/" className="mk-link-arrow">
              Read the framework <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </FadeUp>

      {data.crossModalExample ? (
        <FadeUp id="cross-modal" className="border-t border-[var(--mk-line)]">
          <div className="mx-auto grid max-w-[1120px] items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <SectionHead
              title="When the voice and the picture disagree"
              def="Cross-modal consistency checks whether a spoken or typed claim matches what the receipt shows — and whether the agent catches the mismatch."
            />
            <div className="mk-panel-grad p-1">
              <div className="rounded-[calc(var(--mk-radius)-2px)] bg-[var(--mk-bg)] p-5">
                <p className="mk-label">Case {data.crossModalExample.caseId}</p>
                <p className="mt-3 text-sm leading-relaxed text-[var(--mk-fg)]">
                  <span className="text-[var(--mk-muted)]">Said: </span>
                  {data.crossModalExample.claimText || data.crossModalExample.claimValue}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--mk-fg)]">
                  <span className="text-[var(--mk-muted)]">Receipt shows: </span>
                  {data.crossModalExample.receiptValue}
                </p>
                <p className="mt-3 text-sm leading-relaxed">
                  Expected <span className="font-medium">{data.crossModalExample.expected}</span>
                  {" · "}
                  agent said{" "}
                  <span className="font-medium">{data.crossModalExample.agentVerdict}</span>
                  {" — "}
                  {data.crossModalExample.caught
                    ? "the agent caught the contradiction."
                    : data.crossModalExample.expected.toLowerCase() ===
                        data.crossModalExample.agentVerdict.toLowerCase()
                      ? "verdict matched expectation."
                      : "the agent missed it."}
                </p>
                {data.crossModalExample.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={data.crossModalExample.image}
                    alt=""
                    className="mt-4 max-h-48 w-full rounded object-contain"
                  />
                ) : null}
                <div className="mt-4">
                  <Link
                    href={`/traces/view/?id=${encodeURIComponent(data.crossModalExample.traceId)}&suite=crossmodal`}
                    className="mk-link-arrow"
                  >
                    Open the trace <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </FadeUp>
      ) : null}

      {/* 03 Trust */}
      <FadeUp id="trust" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto grid max-w-[1120px] items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <SectionHead
            kicker="03 / Trust the judge"
            title="A judge you can measure"
            def={
              <>
                Some answers cannot be checked by a rule, so another AI grades them. That AI is
                called a <GlossaryTerm term="judge">judge</GlossaryTerm>. EvalVerse tests the judge
                too: we give it answers we already know are right or wrong, and we check whether it
                still grades when the image is hidden.
              </>
            }
          />
          <div className="mk-panel-grad p-1">
            <JudgePanel wonder={data.wonder} />
          </div>
        </div>
      </FadeUp>

      {/* 04 Act */}
      <FadeUp id="act" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto grid max-w-[1120px] items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <SectionHead
            kicker="04 / Act safely"
            title="Tool calls with checks"
            def="Agents do not just answer, they act: log an expense, book a slot. EvalVerse checks each tool call: valid arguments, the right amount, the right order, and no action when the input could not be read."
          />
          <div className="mk-panel-grad p-1">
            <ToolPanel />
          </div>
        </div>
      </FadeUp>

      {/* 05 Offline / Online */}
      <FadeUp id="monitor" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <SectionHead
            kicker="05 / Offline and online"
            title="Before you ship, and after"
            def={
              <>
                <GlossaryTerm term="offline evaluation">Offline evaluation</GlossaryTerm> catches
                regressions on a fixed set.{" "}
                <GlossaryTerm term="online evaluation">Online evaluation</GlossaryTerm> watches live
                traffic under a <GlossaryTerm term="policy">policy</GlossaryTerm>.
              </>
            }
          />
          <div className="mk-split mt-10">
            <div>
              <h3 className="text-xl font-light tracking-tight">Offline · Before you ship</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">
                Run a fixed set of examples against each version of your agent, compare the results
                and catch regressions.
              </p>
              <div className="mk-panel-grad mt-5 p-1">
                <OfflinePanel compare={data.compare} />
              </div>
              <div className="mt-4">
                <Link href="/experiments/" className="mk-link-arrow">
                  Experiments <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
            <div className="mk-split-rule hidden min-h-full md:block" aria-hidden />
            <div>
              <h3 className="text-xl font-light tracking-tight">Online · After you ship</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">
                Send traces from your running agent. A policy picks which traces to check (a sample,
                or all) and which evaluators to run, and raises an alert when a check fails.
              </p>
              <div className="mk-panel-grad mt-5 p-1">
                <OnlinePanel traces={data.exampleTraces} />
              </div>
              <div className="mt-4">
                <Link href="/policies/" className="mk-link-arrow">
                  Policies <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </FadeUp>

      {/* 06 Score */}
      <FadeUp id="score" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto grid max-w-[1120px] items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <SectionHead
            kicker="06 / Score"
            title="One number, with the evidence beside it"
            def={
              <>
                <GlossaryTerm term="UMS">UMS</GlossaryTerm> stands for Unified Multimodal Score. It
                combines the dimensions above into one number from 0 to 1, using weights you choose.
                It always comes with a{" "}
                <GlossaryTerm term="confidence interval">confidence interval</GlossaryTerm> (how
                much to trust it) and a pass or fail <GlossaryTerm term="gate">gate</GlossaryTerm>{" "}
                for releases. The individual dimensions sit beside it because one number can hide a
                weak spot.
              </>
            }
          />
          <div>
            <div className="mk-panel-grad p-1">
              <ScorePanel ums={data.ums} />
            </div>
            <div className="mt-6">
              <Link href="/overview/" className="mk-link-arrow">
                Score <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </FadeUp>

      {/* What we found */}
      <FadeUp id="measured" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <SectionHead title="What we found" def={FINDINGS.sampleLine} />
          <div className="mt-10 grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
            {FINDINGS.items.map((item) => (
              <div key={item.id} className="border-t border-[var(--mk-line)] pt-5">
                <h3 className="text-lg font-light tracking-tight">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--mk-muted)]">{item.body}</p>
                <FindingBars bars={item.bars} />
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs text-[var(--mk-muted)]">
            Small samples. Intervals in Studio. Run date {FINDINGS.runDate}.
          </p>
        </div>
      </FadeUp>

      {/* Developer band */}
      <FadeUp id="code" className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <SectionHead
            title="Instrument once. Send traces from anywhere."
            def="Python SDK, OpenTelemetry, or a plain HTTP call — same project and API key."
          />
          <div className="mt-8">
            <CodeSection />
          </div>
        </div>
      </FadeUp>

      {/* Docs teaser */}
      <FadeUp className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6">
          <p className="mk-label">Docs</p>
          <h2 className="mk-headline mt-3 text-3xl">Read the docs</h2>
          <div className="mt-8 divide-y divide-[var(--mk-line)] border-y border-[var(--mk-line)]">
            {[
              {
                href: "/docs/overview/",
                title: "Overview",
                desc: "What EvalVerse is and how the pieces fit.",
              },
              {
                href: "/docs/quickstart/",
                title: "Quickstart",
                desc: "Run the server and send your first trace.",
              },
              {
                href: "/docs/sdk/",
                title: "SDK",
                desc: "Python client for traces, spans and tool calls.",
              },
              {
                href: "/docs/api/",
                title: "API reference",
                desc: "Auth, traces, evaluators, policies and scores.",
              },
            ].map((row) => (
              <Link
                key={row.title}
                href={row.href}
                className="flex flex-col gap-1 py-5 transition-colors hover:bg-[rgba(142,197,255,0.04)] sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
              >
                <span className="text-xl font-light tracking-tight">{row.title}</span>
                <span className="text-sm text-[var(--mk-muted)] sm:text-right">{row.desc}</span>
              </Link>
            ))}
          </div>
        </div>
      </FadeUp>

      {/* Final CTA */}
      <section className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
          <h2 className="mk-headline max-w-2xl text-3xl sm:text-5xl">Point your agent at EvalVerse</h2>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup/" className="mk-btn mk-btn-primary">
              Start building
            </Link>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="mk-btn mk-btn-secondary">
              <GitHubMark />
              GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
