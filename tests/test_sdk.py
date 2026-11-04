"""SDK + importer tests against an in-process FastAPI app."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalverse.importer import import_results, import_results_local
from evalverse.sdk import EvalVerse
from evalverse.server.app import create_app


@pytest.fixture()
def app_and_dir(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "sdk.db",
        media_dir=tmp_path / "media",
        api_key="dev",
    )
    return app, tmp_path


@pytest.fixture()
def ev(app_and_dir):
    app, _ = app_and_dir
    # FastAPI TestClient is an httpx.Client — use it as the SDK transport.
    http = TestClient(app)
    client = EvalVerse(
        api_url="http://testserver",
        api_key="dev",
        project="default",
        client=http,
        sync=True,  # TestClient is not safe from the SDK background thread
    )
    yield client
    client.close()


def test_sdk_trace_spans_and_tools(ev: EvalVerse, tmp_path: Path):
    img = tmp_path / "receipt.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\nfake")

    with ev.trace(name="demo", session_id="s1", agent="agent-x", input={"q": 1}) as tr:
        tid = tr.id
        tr.media(img, role="input")
        with tr.span("model", type="model", model="muse-spark-1.3") as sp:
            sp.set_output(answer="12.00")
            sp.set_usage(input_tokens=3, output_tokens=2)
            sp.tool_call("log_expense", {"total": "12.00"}, result={"ok": True})
            sp.tool_call("check_duplicate", {"total": "12.00"}, result={"duplicate": False})
        tr.set_output(total="12.00")

    ev.flush(timeout=10)
    got = ev.get_trace(tid)
    assert got is not None
    assert got["id"] == tid
    assert got["status"] == "completed"
    types = {s["type"] for s in got["spans"]}
    assert "model" in types
    assert "tool" in types
    assert got["tool_call_count"] == 2
    assert len(got["media"]) >= 1


def test_sdk_span_failure_reraises(ev: EvalVerse):
    with pytest.raises(RuntimeError, match="boom"):
        with ev.trace(name="fail") as tr:
            with tr.span("bad", type="custom"):
                raise RuntimeError("boom")
    ev.flush(timeout=5)
    got = ev.get_trace(tr.id)
    assert got is not None
    assert got["status"] == "failed"
    assert any(s["status"] == "failed" for s in got["spans"])


def test_sdk_observe_decorator(ev: EvalVerse, app_and_dir):
    app, _ = app_and_dir

    @ev.observe(type="tool", name="add")
    def add(a, b):
        return a + b

    assert add(2, 3) == 5
    ev.flush(timeout=5)
    rows = ev._request("GET", "/api/v1/traces")
    assert any(r["tool_call_count"] >= 1 or r["span_count"] >= 1 for r in rows)


def test_sdk_evaluate_not_implemented(ev: EvalVerse):
    with pytest.raises(NotImplementedError, match="next release"):
        ev.evaluate(trace="x")


def test_importer_idempotency(app_and_dir, tmp_path: Path):
    app, _ = app_and_dir
    svc = app.state.service

    img = tmp_path / "img.png"
    img.write_bytes(b"png-bytes-for-import")
    results = {
        "meta": {"agents": ["mock-agent"], "conditions": ["clean"]},
        "cases": [
            {
                "id": "case_01",
                "question": "total?",
                "answer": "1",
                "image": str(img),
            }
        ],
        "traces": [
            {
                "id": "mock-agent|case_01|clean",
                "agent": "mock-agent",
                "case_id": "case_01",
                "variant": "clean",
                "variant_transform": "identity",
                "assets": [
                    {
                        "id": "asset1",
                        "path": str(img),
                        "modality": "image",
                        "transformation": "identity",
                    }
                ],
                "spans": [
                    {
                        "id": "s1",
                        "name": "attach_image",
                        "type": "media",
                        "status": "completed",
                        "parent_span_ids": [],
                    },
                    {
                        "id": "s2",
                        "name": "model_call",
                        "type": "model",
                        "status": "completed",
                        "parent_span_ids": ["s1"],
                        "model": "mock-agent",
                        "latency_s": 0.01,
                        "output": {"answer": "1"},
                    },
                ],
            }
        ],
        "results": [
            {
                "id": "mock-agent|case_01|clean|answer_correctness",
                "evaluator_id": "answer_correctness",
                "evaluator_version": "1.0.0",
                "dimension": "Perception",
                "target": {
                    "agent": "mock-agent",
                    "case_id": "case_01",
                    "variant": "clean",
                },
                "status": "completed",
                "score": 1.0,
                "verdict": "pass",
                "label": "correct",
                "explanation": "ok",
                "evidence": [],
            }
        ],
    }
    results_path = tmp_path / "results_mock.json"
    results_path.write_text(json.dumps(results))

    s1 = import_results_local(results_path, tag="mock", service=svc)
    s2 = import_results_local(results_path, tag="mock", service=svc)

    assert s1["traces"] == 1
    assert s2["traces"] == 0
    assert s2["traces_skipped"] == 1
    assert s1["results"] == 1
    assert s2["results"] == 0
    assert s2["results_skipped"] >= 1

    tr = svc.get_trace("default", "mock-agent|case_01|clean")
    assert tr.session_id == "mock:case_01"
    assert tr.source == "import"
    assert len(tr.spans) == 2
    assert len(tr.results) == 1

    sessions = svc.list_sessions("default")
    assert any(s.session_id == "mock:case_01" for s in sessions)


def test_importer_http_roundtrip(app_and_dir, tmp_path: Path):
    app, _ = app_and_dir
    img = tmp_path / "r.png"
    img.write_bytes(b"abc")
    results = {
        "meta": {},
        "cases": [{"id": "c1", "image": str(img)}],
        "traces": [
            {
                "id": "ag|c1|clean",
                "agent": "ag",
                "case_id": "c1",
                "variant": "clean",
                "assets": [{"id": "m1", "path": str(img), "modality": "image"}],
                "spans": [
                    {
                        "id": "s1",
                        "name": "root",
                        "type": "custom",
                        "status": "completed",
                        "parent_span_ids": [],
                    }
                ],
            }
        ],
        "results": [
            {
                "id": "ag|c1|clean|e1",
                "evaluator_id": "e1",
                "evaluator_version": "1",
                "dimension": "X",
                "target": {"agent": "ag", "case_id": "c1", "variant": "clean"},
                "status": "completed",
                "score": 0.5,
            }
        ],
    }
    path = tmp_path / "results_http.json"
    path.write_text(json.dumps(results))

    with TestClient(app) as http:
        a = import_results(path, tag="http", client=http)
        b = import_results(path, tag="http", client=http)
    assert a["traces"] == 1
    assert b["traces_skipped"] == 1
    assert a["results"] >= 1
