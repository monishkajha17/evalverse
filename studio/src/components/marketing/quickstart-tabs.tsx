"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/marketing/copy-button";

const SDK = `from evalverse.sdk import EvalVerse

ev = EvalVerse(api_url="http://127.0.0.1:8000", api_key="dev", project="default")

with ev.trace(name="receipt_agent", session_id="demo:1", agent="muse-spark-1.3") as tr:
    tr.media("receipt.png", role="input", modality="image")
    with tr.span("extract_total", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="128.00", box=[620, 780, 780, 860])
        sp.tool_call("log_expense", {"amount": 128.0, "currency": "IDR"}, result={"ok": True})
    tr.set_output(answer="128.00")

ev.flush()`;

const OTEL = `# OTLP/HTTP JSON endpoint
# POST http://127.0.0.1:8000/v1/traces
#
# Required headers:
#   Authorization: Bearer <api-key>
#   X-Project: default
#   Content-Type: application/json

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

exporter = OTLPSpanExporter(
    endpoint="http://127.0.0.1:8000/v1/traces",
    headers={
        "authorization": "Bearer dev",
        "x-project": "default",
    },
)`;

const CLI = `# Health / model check (never prints your key)
python -m evalverse.check

# Run a suite (offline smoke)
python -m evalverse.run --mock --limit 3

# Real multimodal run
python -m evalverse.run --agents muse-spark-1.1,muse-spark-1.3 --judge muse-spark-1.3 --limit 3

# Start the API server
python -m evalverse.server`;

export function QuickstartTabs({ className }: { className?: string }) {
  return (
    <Tabs defaultValue="sdk" className={className}>
      <TabsList aria-label="Ingest options">
        <TabsTrigger value="sdk">Python SDK</TabsTrigger>
        <TabsTrigger value="otel">OpenTelemetry</TabsTrigger>
        <TabsTrigger value="cli">CLI</TabsTrigger>
      </TabsList>
      {(
        [
          ["sdk", SDK],
          ["otel", OTEL],
          ["cli", CLI],
        ] as const
      ).map(([id, code]) => (
        <TabsContent key={id} value={id}>
          <div className="overflow-hidden rounded-lg border border-border bg-ink">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="text-[11px] uppercase tracking-wide text-white/50">
                {id === "sdk" ? "sdk.py" : id === "otel" ? "otlp" : "shell"}
              </span>
              <CopyButton text={code} />
            </div>
            <pre className="max-h-[360px] overflow-auto p-4 text-[12px] leading-relaxed text-white/90">
              <code>{code}</code>
            </pre>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
