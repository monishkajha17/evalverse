export const SDK_SNIPPET = `from evalverse.sdk import EvalVerse

ev = EvalVerse(api_url="http://127.0.0.1:8000", api_key="dev", project="default")

with ev.trace(name="receipt_agent", session_id="demo:1", agent="muse-spark-1.3") as tr:
    tr.media("receipt.png", role="input", modality="image")
    with tr.span("extract_total", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="128.00", box=[620, 780, 780, 860])
        sp.tool_call("log_expense", {"amount": 128.0, "currency": "IDR"}, result={"ok": True})
    tr.set_output(answer="128.00")

ev.flush()`;

export const OTEL_SNIPPET = `# OTLP/HTTP JSON — POST http://127.0.0.1:8000/v1/traces
# Headers: Authorization: Bearer <api-key>
#          X-Project: default
#          Content-Type: application/json

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

exporter = OTLPSpanExporter(
    endpoint="http://127.0.0.1:8000/v1/traces",
    headers={
        "authorization": "Bearer dev",
        "x-project": "default",
    },
)`;

export const CURL_SNIPPET = `curl -s -X POST http://127.0.0.1:8000/api/v1/traces \\
  -H "Authorization: Bearer dev" \\
  -H "X-Project: default" \\
  -H "Content-Type: application/json" \\
  -d '{
    "id": "demo-trace",
    "name": "receipt_agent",
    "session_id": "demo:1",
    "agent": "muse-spark-1.3"
  }'`;

export const EVALUATOR_CURL = `curl -s -X POST http://127.0.0.1:8000/api/v1/evaluators \\
  -H "Authorization: Bearer dev" \\
  -H "X-Project: default" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "receipt_total_rubric",
    "type": "rubric",
    "judge_model": "muse-wonder-1.0",
    "prompt": "Score grounding given {{input}} {{output}} {{tool_calls}}",
    "pass_threshold": 0.8
  }'`;

export const POLICY_CURL = `curl -s -X POST http://127.0.0.1:8000/api/v1/policies \\
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

export const JUDGE_CLI = `python -m evalverse.run \\
  --judge muse-wonder-1.0 \\
  --judge-controls \\
  --agents muse-spark-1.3 \\
  --limit 3`;

export const TOOL_SPAN = `with tr.span("extract_total", type="model", model="muse-spark-1.3") as sp:
    sp.set_output(answer="42.50", box=[120, 400, 300, 460])
    sp.tool_call(
        "check_duplicate",
        {"amount": 42.50},
        result={"duplicate": False},
    )
    sp.tool_call(
        "log_expense",
        {"amount": 42.50, "currency": "IDR"},
        result={"ok": True, "logged": {"amount": 42.50}},
    )`;

export const EVIDENCE_JSON = `{
  "evaluator_id": "evidence_grounding",
  "status": "completed",
  "score": 0.0,
  "verdict": "fail",
  "label": "ungrounded",
  "evidence": [
    {"type": "image_region", "role": "expected", "locator": [141, 521, 913, 587]},
    {"type": "image_region", "role": "claimed", "locator": [120, 400, 300, 460]}
  ]
}`;
