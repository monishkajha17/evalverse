import Link from "next/link";
import { HeroOverlay } from "@/components/marketing/hero-overlay";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { CodeSection } from "@/components/marketing/code-section";
import { StatsSection } from "@/components/marketing/stats-section";
import { TourVideo } from "@/components/marketing/tour-video";
import { FadeUp } from "@/components/marketing/fade-up";

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <HeroOverlay />
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <h1 className="mk-headline text-4xl sm:text-6xl">
            Did your agent actually
            <br />
            <span className="mk-headline-grad">look and listen?</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[var(--mk-muted)] sm:text-lg">
            Traces, evidence-grounded evaluators and measured judges for agents that see, hear and
            act.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/quickstart/" className="mk-btn mk-btn-primary">
              Start building
            </Link>
            <Link href="/overview/" className="mk-btn mk-btn-secondary">
              Open the live demo
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            <span className="mk-chip">
              Built on the Meta Model API: Muse Spark · Muse Wonder · Muse Voice Transcribe
            </span>
            <span className="mk-chip">Evaluated on CORD v2 · LibriSpeech</span>
          </div>
        </div>
      </section>

      <FadeUp className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
        <h2 className="mk-headline text-3xl sm:text-5xl">From a first trace to measured trust</h2>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--mk-muted)] sm:text-base">
          Instrument once. Evaluate with evidence. Ship with a judge you can measure.
        </p>
      </FadeUp>

      <FadeUp className="mx-auto max-w-6xl px-4 py-16 sm:px-6" id="product">
        <ProductShowcase />
      </FadeUp>

      <FadeUp className="border-t border-[var(--mk-line)]" id="code">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="mk-headline text-3xl sm:text-4xl">Code</h2>
          <p className="mt-3 max-w-xl text-sm text-[var(--mk-muted)]">
            Real endpoints from this repo — Authorization, X-Project, and OTLP{" "}
            <code className="mk-mono text-[var(--mk-accent)]">POST /v1/traces</code>.
          </p>
          <div className="mt-8">
            <CodeSection />
          </div>
        </div>
      </FadeUp>

      <StatsSection />

      <FadeUp className="border-t border-[var(--mk-line)] py-20">
        <TourVideo />
      </FadeUp>

      <section className="border-t border-[var(--mk-line)]">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <h2 className="mk-headline text-3xl sm:text-5xl">Point your agent at EvalVerse</h2>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/quickstart/" className="mk-btn mk-btn-primary">
              Start building
            </Link>
            <Link href="/connect/" className="mk-btn mk-btn-secondary">
              Connect your server
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
