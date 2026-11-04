import type { ComponentType } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Crosshair,
  EyeOff,
  Gavel,
  ListTree,
  Scale,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceiptHeroSvg } from "@/components/marketing/receipt-hero-svg";
import { LiveStats } from "@/components/marketing/live-stats";
import { QuickstartTabs } from "@/components/marketing/quickstart-tabs";
import { PipelineDiagram } from "@/components/system/pipeline-diagram";

const GITHUB = "https://github.com/monishkajha17/evalverse";

const WHY = [
  {
    icon: Sparkles,
    title: "Fluent but wrong",
    body: "Text judges score confident prose. They miss that the total came from a hallucination, not the receipt.",
  },
  {
    icon: Crosshair,
    title: "Right answer, wrong place",
    body: "The number matches, but the agent looked at a tip line or tax row. Evidence boxes catch the mismatch.",
  },
  {
    icon: AlertTriangle,
    title: "Acting while unsure",
    body: "The model abstains in text, then still calls log_expense. Tool-call verification surfaces the contradiction.",
  },
];

const FEATURES: Array<{
  href: string;
  title: string;
  body: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  {
    href: "/traces/",
    title: "Multimodal traces",
    body: "Spans, media, and tool calls in one timeline — images, audio, and video attached where they happened.",
    icon: ListTree,
  },
  {
    href: "/evaluators/",
    title: "Evidence-grounded evaluators",
    body: "Judges that check boxes, timestamps, and citations against the media — not just the string answer.",
    icon: Scale,
  },
  {
    href: "/system/",
    title: "Stage attribution",
    body: "Pin failures to perception, reasoning, or tool use so you know which stage to fix.",
    icon: Activity,
  },
  {
    href: "/judge/",
    title: "Judge audit",
    body: "Calibration, disagreements, and media-dependence checks so the judge itself is measurable.",
    icon: Gavel,
  },
  {
    href: "/policies/",
    title: "Online evaluation and policies",
    body: "Sample live traffic, attach evaluators, and keep production traces under continuous review.",
    icon: Shield,
  },
  {
    href: "/evaluations/",
    title: "Tool-call verification",
    body: "Schema, argument grounding, order policy, and action-despite-abstention — checked on every trace.",
    icon: Wrench,
  },
];

const EMPTY_COUNTS = {
  datasets: null,
  traces: null,
  queueJobs: null,
  evaluators: null,
  results: null,
  policies: null,
};

export default function LandingPage() {
  return (
    <div>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
        <div className="space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">EvalVerse</p>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Did your agent actually look and listen?
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-ink/65">
            EvalVerse evaluates multimodal agents (images, audio, video) with evidence, traces and
            measured judges.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" variant="teal">
              <Link href="/overview/">Open the demo</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/connect/">Connect your server</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href={GITHUB} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-white p-4 shadow-panel sm:p-6">
          <ReceiptHeroSvg className="mx-auto h-auto w-full max-w-md" />
        </div>
      </section>

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Why text-only evals miss it
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">
            Fluency is cheap. Grounding is not. Multimodal agents fail in places string matchers never see.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {WHY.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="space-y-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-teal">
                    <Icon className="h-4 w-4" aria-hidden />
                  </div>
                  <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-ink/60">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">What you get</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink/60">
          Open any card to jump into the matching Studio surface.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <Link
                key={f.href}
                href={f.href}
                className="group block space-y-2 rounded-lg border border-border bg-white p-5 transition-colors hover:border-teal/40 hover:bg-teal/[0.03]"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-teal" aria-hidden />
                  <h3 className="text-sm font-semibold text-ink group-hover:text-teal">{f.title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-ink/60">{f.body}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <LiveStats />

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">How it works</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink/60">
          From ingest to Studio — the same pipeline the server runs for every evaluation.
        </p>
        <div className="mt-8">
          <PipelineDiagram counts={EMPTY_COUNTS} />
        </div>
      </section>

      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Quickstart</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">
            Send a trace with the SDK, OTLP, or the CLI. Full walkthrough on{" "}
            <Link href="/quickstart/" className="text-teal hover:underline">
              /quickstart
            </Link>
            .
          </p>
          <div className="mt-8">
            <QuickstartTabs />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Models and data</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/45">Models</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink/75">
              <li>
                <span className="font-medium text-ink">Meta Muse Spark</span> — agent under test and
                primary judge family
              </li>
              <li>
                <span className="font-medium text-ink">Muse Wonder</span> — higher-capacity judge for
                disagreement and audit suites
              </li>
              <li>
                <span className="font-medium text-ink">Muse Voice Transcribe</span> — transcripts,
                speakers, and turn timestamps for audio evals
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/45">Data</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink/75">
              <li>
                <span className="font-medium text-ink">CORD v2</span> — receipt OCR / document
                understanding (CC BY 4.0)
              </li>
              <li>
                <span className="font-medium text-ink">LibriSpeech</span> — read speech for audio
                fidelity and temporal alignment (CC BY 4.0)
              </li>
            </ul>
            <p className="mt-4 flex items-start gap-2 text-xs text-ink/50">
              <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Studio never phones home for these datasets; snapshot files ship under{" "}
              <code className="mono">/data</code>.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
