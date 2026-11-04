export const SDK_SNIPPET = `from evalverse.sdk import EvalVerse

ev = EvalVerse(api_url="http://127.0.0.1:8000", api_key="dev", project="default")

with ev.trace(name="receipt_agent", session_id="demo:1", agent="muse-spark-1.3") as tr:
    tr.media("data/images/receipt_01.png", role="input", modality="image")
    with tr.span("extract_total", type="model", model="muse-spark-1.3") as sp:
        sp.set_output(answer="128.00", box=[620, 780, 780, 860])
        sp.tool_call("log_expense", {"amount": 128.0, "currency": "IDR"}, result={"ok": True})
    tr.set_output(answer="128.00")
    trace_id = tr.id

ev.flush()
print("trace_id=", trace_id)`;

export const OTEL_SNIPPET = `from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

endpoint = "http://127.0.0.1:8000/v1/traces"
provider = TracerProvider(resource=Resource.create({"service.name": "landing-demo"}))
provider.add_span_processor(
    BatchSpanProcessor(
        OTLPSpanExporter(
            endpoint=endpoint,
            headers={"authorization": "Bearer dev", "x-project": "default"},
        )
    )
)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("evalverse.landing")

with tracer.start_as_current_span("receipt_agent") as span:
    span.set_attribute("gen_ai.request.model", "muse-spark-1.3")
    span.set_attribute("gen_ai.completion", '{"answer":"128.00"}')
    print("trace_id=", format(span.get_span_context().trace_id, "032x"))

provider.force_flush(timeout_millis=10000)
provider.shutdown()`;

export const CURL_SNIPPET = `curl -s -X POST http://127.0.0.1:8000/api/v1/traces \\
  -H "Authorization: Bearer dev" \\
  -H "X-Project: default" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "receipt_agent",
    "session_id": "demo:1",
    "agent": "muse-spark-1.3",
    "status": "completed",
    "output": {"answer": "128.00"}
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
