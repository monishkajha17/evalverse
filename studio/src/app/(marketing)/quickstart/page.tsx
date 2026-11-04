import Link from "next/link";
import { HighlightedCode } from "@/components/marketing/highlighted-code";
import { CodeSection } from "@/components/marketing/code-section";
import { POLICY_CURL } from "@/components/marketing/snippets";

const INSTALL = `pip install -e .
# or from the repo root
python -m pip install -r requirements.txt`;

const SERVER = `export EVALVERSE_API_KEY=dev
export EVALVERSE_CORS_ORIGINS=http://localhost:3000
python -m evalverse.server
# API: http://127.0.0.1:8000`;

export default function QuickstartPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <p className="mk-mono text-xs uppercase tracking-[0.14em] text-[var(--mk-accent)]">Docs</p>
      <h1 className="mk-headline mt-3 text-4xl sm:text-5xl">Quickstart</h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--mk-muted)]">
        From install to an online policy. Snippets use the real local endpoints from this repository.
      </p>

      <ol className="mt-14 space-y-12">
        <li className="space-y-3">
          <h2 className="text-lg tracking-tight">1. Install</h2>
          <p className="text-sm text-[var(--mk-muted)]">
            Clone the repo and install the Python package in editable mode.
          </p>
          <HighlightedCode code={INSTALL} label="shell" />
        </li>

        <li className="space-y-3">
          <h2 className="text-lg tracking-tight">2. Start the server</h2>
          <p className="text-sm text-[var(--mk-muted)]">
            CORS defaults to http://localhost:3000 — override with EVALVERSE_CORS_ORIGINS.
          </p>
          <HighlightedCode code={SERVER} label="shell" />
        </li>

        <li className="space-y-3">
          <h2 className="text-lg tracking-tight">3. Send a trace</h2>
          <p className="text-sm text-[var(--mk-muted)]">
            SDK, OTLP, or curl — then open Traces in Studio.
          </p>
          <CodeSection />
        </li>

        <li className="space-y-3">
          <h2 className="text-lg tracking-tight">4. Create an evaluator in Studio</h2>
          <p className="text-sm text-[var(--mk-muted)]">
            Open Evaluators → New. Rubric and rule types attach to traces and evaluation runs.
          </p>
          <Link href="/evaluators/" className="mk-btn mk-btn-secondary">
            Open Evaluators
          </Link>
        </li>

        <li className="space-y-3">
          <h2 className="text-lg tracking-tight">5. Enable an online policy</h2>
          <p className="text-sm text-[var(--mk-muted)]">
            Sample tagged live traffic and attach evaluator IDs.
          </p>
          <HighlightedCode code={POLICY_CURL} label="curl" />
          <Link href="/policies/" className="mk-btn mk-btn-secondary">
            Open Policies
          </Link>
        </li>
      </ol>

      <div className="mt-16 flex flex-wrap gap-3 border-t border-[var(--mk-line)] pt-8">
        <Link href="/connect/" className="mk-btn mk-btn-primary">
          Connect Studio
        </Link>
        <Link href="/overview/" className="mk-btn mk-btn-secondary">
          Open the demo
        </Link>
      </div>
    </div>
  );
}
