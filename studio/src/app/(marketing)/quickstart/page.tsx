import Link from "next/link";
import { CopyButton } from "@/components/marketing/copy-button";
import { QuickstartTabs } from "@/components/marketing/quickstart-tabs";
import { Button } from "@/components/ui/button";

const INSTALL = `pip install -e .
# or from the repo root
python -m pip install -r requirements.txt`;

const SERVER = `export EVALVERSE_API_KEY=dev
export EVALVERSE_CORS_ORIGINS=http://localhost:3000
python -m evalverse.server
# API: http://127.0.0.1:8000`;

const POLICY = `# In Studio → Policies, or via API:
curl -s -X POST http://127.0.0.1:8000/api/v1/policies \\
  -H "Authorization: Bearer dev" \\
  -H "X-Project: default" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "live-sample",
    "filter": {"tags": ["live"]},
    "sample_rate": 1.0,
    "evaluator_ids": ["answer_correctness", "evidence_grounding"],
    "enabled": true
  }'`;

const STEPS: Array<{ title: string; body: string; code?: string }> = [
  {
    title: "1. Install",
    body: "Clone the repo and install the Python package in editable mode.",
    code: INSTALL,
  },
  {
    title: "2. Start the server",
    body: "Run the EvalVerse API locally. CORS defaults to http://localhost:3000; override with EVALVERSE_CORS_ORIGINS.",
    code: SERVER,
  },
  {
    title: "3. Send a trace",
    body: "Use the SDK, OTLP, or CLI snippets below. Then open Traces in Studio.",
  },
  {
    title: "4. Create an evaluator in Studio",
    body: "Open Evaluators → New. Rubric and rule types attach to traces and evaluation runs.",
  },
  {
    title: "5. Enable an online policy",
    body: "Sample tagged live traffic and attach evaluator IDs. Policies run as traces arrive.",
    code: POLICY,
  },
];

export default function QuickstartPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal">Quickstart</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
        From install to an online policy
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/60">
        Five steps to evaluate a multimodal agent end to end. Snippets use the real local endpoints
        from this repository.
      </p>

      <ol className="mt-12 space-y-10">
        {STEPS.map((step) => (
          <li key={step.title} className="space-y-3">
            <h2 className="text-lg font-semibold text-ink">{step.title}</h2>
            <p className="text-sm leading-relaxed text-ink/65">{step.body}</p>
            {step.code ? (
              <div className="overflow-hidden rounded-lg border border-border bg-ink">
                <div className="flex justify-end border-b border-white/10 px-3 py-2">
                  <CopyButton text={step.code} />
                </div>
                <pre className="overflow-auto p-4 text-[12px] leading-relaxed text-white/90">
                  <code>{step.code}</code>
                </pre>
              </div>
            ) : null}
            {step.title.startsWith("3.") ? (
              <div className="pt-2">
                <QuickstartTabs />
              </div>
            ) : null}
            {step.title.startsWith("4.") ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/evaluators/">Open Evaluators</Link>
              </Button>
            ) : null}
            {step.title.startsWith("5.") ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/policies/">Open Policies</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-14 flex flex-wrap gap-3 border-t border-border pt-8">
        <Button asChild variant="teal">
          <Link href="/connect/">Connect Studio</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/overview/">Open the demo</Link>
        </Button>
      </div>
    </div>
  );
}
