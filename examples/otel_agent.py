#!/usr/bin/env python3
"""Emit a GenAI-style OTLP trace (model + image + two tools) to EvalVerse.

    python examples/otel_agent.py
"""

from __future__ import annotations

import base64
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# 1x1 PNG
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_DATA_URL = "data:image/png;base64," + base64.b64encode(_PNG).decode()


def main() -> None:
    endpoint = "http://127.0.0.1:8000/v1/traces"
    resource = Resource.create(
        {
            "service.name": "otel-agent-example",
            "evalverse.session_id": "otel-demo-session",
        }
    )
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=endpoint,
        headers={"authorization": "Bearer dev", "x-project": "default"},
    )
    # Batch so parent + children arrive together (SimpleSpanProcessor exports on end).
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    tracer = trace.get_tracer("evalverse.examples.otel_agent")

    with tracer.start_as_current_span("chat") as model_span:
        model_span.set_attribute("gen_ai.operation.name", "chat")
        model_span.set_attribute("gen_ai.request.model", "muse-spark-1.3")
        model_span.set_attribute("gen_ai.response.model", "muse-spark-1.3")
        model_span.set_attribute("gen_ai.usage.input_tokens", 42)
        model_span.set_attribute("gen_ai.usage.output_tokens", 12)
        model_span.set_attribute("evalverse.session_id", "otel-demo-session")
        model_span.set_attribute(
            "gen_ai.prompt",
            __import__("json").dumps(
                {
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": "What is the total?"},
                                {"type": "image_url", "image_url": {"url": _DATA_URL}},
                            ],
                        }
                    ]
                }
            ),
        )
        model_span.set_attribute(
            "gen_ai.completion",
            __import__("json").dumps({"answer": "12.00", "box": [10, 10, 20, 20]}),
        )

        with tracer.start_as_current_span("log_expense") as tool1:
            tool1.set_attribute("gen_ai.operation.name", "execute_tool")
            tool1.set_attribute("gen_ai.tool.name", "log_expense")
            tool1.set_attribute(
                "gen_ai.tool.call.arguments",
                __import__("json").dumps({"total": "12.00", "currency": "USD"}),
            )
            tool1.set_attribute(
                "gen_ai.tool.call.result",
                __import__("json").dumps({"ok": True}),
            )

        with tracer.start_as_current_span("check_duplicate") as tool2:
            tool2.set_attribute("gen_ai.operation.name", "execute_tool")
            tool2.set_attribute("gen_ai.tool.name", "check_duplicate")
            tool2.set_attribute(
                "gen_ai.tool.call.arguments",
                __import__("json").dumps({"total": "12.00"}),
            )
            tool2.set_attribute(
                "gen_ai.tool.call.result",
                __import__("json").dumps({"duplicate": False}),
            )

        ctx = model_span.get_span_context()
        trace_id = format(ctx.trace_id, "032x")
        print(f"trace_id={trace_id}")
        print(f"curl -s -H 'Authorization: Bearer dev' localhost:8000/api/v1/traces/{trace_id}")

    provider.force_flush(timeout_millis=10000)
    time.sleep(0.2)
    provider.shutdown()


if __name__ == "__main__":
    main()
