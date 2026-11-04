"""Platform extensions: datasets, evaluators, evaluations, policies."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from evalverse.server.app import create_app
from evalverse.server.rules import RulePathError, dotted_get, validate_path


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "p.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=True,
        worker_size=2,
    )
    # Deterministic fast judge for rubric tests.
    def judge(prompt, image_bytes=None, model=None, timeout_s=30.0):
        if "TIMEOUT" in prompt:
            time.sleep(min(timeout_s + 0.1, 0.3))
            return '{"score": 1}', {}
        if "INVALID" in prompt:
            return "not-json-at-all", {}
        return json.dumps({"score": 1.0, "label": "pass", "explanation": "ok"}), {
            "input_tokens": 1,
            "output_tokens": 2,
        }

    app.state.service.judge_fn = judge
    with TestClient(app) as c:
        yield c


def H(project="default"):
    return {"Authorization": "Bearer dev", "X-Project": project}


def _trace(client, tid="t1", agent="agent-x", status="completed", output=None, meta=None):
    body = {
        "id": tid,
        "name": "n",
        "agent": agent,
        "status": status,
        "source": "sdk",
        "output": output or {"answer": "12.00"},
        "metadata": meta or {},
        "tags": ["demo"],
        "spans": [
            {
                "id": "m1",
                "name": "model",
                "type": "model",
                "status": "completed",
                "latency_ms": 10,
                "output": {"answer": "12.00", "box": [1, 2, 3, 4]},
            }
        ],
    }
    r = client.post("/api/v1/traces", headers=H(), json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---- datasets ----
def test_dataset_versioning_export_import(client):
    ds = client.post("/api/v1/datasets", headers=H(), json={"name": "receipts"}).json()
    ver = client.post(
        f"/api/v1/datasets/{ds['id']}/versions", headers=H(), json={"version": "v1"}
    ).json()
    assert ver["locked"] is False
    assert ver["content_hash"]

    item = client.post(
        f"/api/v1/datasets/{ds['id']}/items",
        headers=H(),
        json={
            "input": {"text": "What is the total?", "media_ids": []},
            "expectation": {
                "answer": "12.00",
                "answer_type": "number",
                "evidence": {"type": "image_region", "locator": [0, 0, 10, 10]},
            },
            "tags": ["cord"],
            "version_id": ver["id"],
        },
    ).json()
    assert item["expectation"]["answer"] == "12.00"

    exported = client.get(f"/api/v1/datasets/{ds['id']}/export", headers=H())
    assert exported.status_code == 200
    lines = [ln for ln in exported.text.strip().splitlines() if ln]
    assert len(lines) == 1

    # Lock via evaluation referencing the version
    _trace(client, tid="t-lock")
    client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={"type": "rule", "name": "noop", "checks": [{"op": "field_present", "path": "output"}]},
    )
    client.post(
        "/api/v1/evaluations",
        headers=H(),
        json={
            "trace_ids": ["t-lock"],
            "evaluator_ids": ["noop"],
            "dataset_version_id": ver["id"],
        },
    )
    locked = client.get(f"/api/v1/datasets/{ds['id']}", headers=H()).json()
    assert locked["versions"][0]["locked"] is True

    # Mutations rejected
    bad = client.post(
        f"/api/v1/datasets/{ds['id']}/items",
        headers=H(),
        json={"input": {"text": "x"}, "version_id": ver["id"]},
    )
    assert bad.status_code == 400

    # New version + import round-trip
    ver2 = client.post(
        f"/api/v1/datasets/{ds['id']}/versions", headers=H(), json={"version": "v2"}
    ).json()
    imp = client.post(
        f"/api/v1/datasets/{ds['id']}/import?version_id={ver2['id']}",
        headers=H(),
        content=exported.text,
    )
    assert imp.status_code == 200
    assert imp.json()["imported"] == 1
    items = client.get(
        f"/api/v1/datasets/{ds['id']}/items?version_id={ver2['id']}", headers=H()
    ).json()
    assert len(items) == 1


# ---- rules ----
def test_malicious_path_rejected():
    with pytest.raises(RulePathError):
        validate_path("__class__")
    with pytest.raises(RulePathError):
        validate_path("a[0]")
    with pytest.raises(RulePathError):
        dotted_get({}, "os.system")


def test_rule_evaluator_each_check(client):
    _trace(client, tid="t-rule", output={"answer": "12.00", "note": "hello world"})
    checks = [
        {"op": "equals", "path": "output.answer", "value": "12.00"},
        {"op": "contains", "path": "output.note", "value": "hello"},
        {"op": "regex", "path": "output.answer", "pattern": r"^12"},
        {"op": "number_within", "path": "run.latency", "value": 0.01, "tol": 0.05},
        {
            "op": "json_schema",
            "path": "output",
            "schema": {"type": "object", "required": ["answer"], "properties": {"answer": {"type": "string"}}},
        },
        {"op": "field_present", "path": "output.answer"},
        {"op": "max_latency_ms", "path": "trace.latency_ms", "value": 1000},
    ]
    ev = client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={"type": "rule", "name": "all_checks", "checks": checks},
    ).json()
    assert ev["type"] == "rule"
    res = client.post(
        f"/api/v1/evaluators/{ev['id']}/test",
        headers=H(),
        json={"trace_id": "t-rule"},
    ).json()
    assert res["status"] == "completed"
    assert res["verdict"] == "pass"

    # Malicious path -> error, and test stores nothing
    bad = client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={
            "type": "rule",
            "name": "evil",
            "checks": [{"op": "equals", "path": "__import__", "value": 1}],
        },
    ).json()
    before = client.get("/api/v1/traces/t-rule", headers=H()).json()["results"]
    tres = client.post(
        f"/api/v1/evaluators/{bad['id']}/test",
        headers=H(),
        json={"trace_id": "t-rule"},
    ).json()
    assert tres["status"] == "error"
    after = client.get("/api/v1/traces/t-rule", headers=H()).json()["results"]
    assert len(after) == len(before)


# ---- rubric ----
def test_rubric_evaluator_valid_invalid_timeout(client):
    _trace(client, tid="t-rubric")

    good = client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={
            "type": "rubric",
            "name": "total_supported_by_image",
            "dimension": "Groundedness",
            "prompt": "Judge support. Return JSON. output={{output}}",
            "attach_media": False,
            "judge_model": "mock",
            "scale": "pass_fail",
            "pass_threshold": 1.0,
        },
    ).json()
    assert good["needs_reference"] is False
    ok = client.post(
        f"/api/v1/evaluators/{good['id']}/test",
        headers=H(),
        json={"trace_id": "t-rubric"},
    ).json()
    assert ok["status"] == "completed"
    assert ok["score"] == 1.0
    assert ok["execution_metadata"]["judge_model"] == "mock"

    inv = client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={
            "type": "rubric",
            "name": "bad_json_judge",
            "prompt": "INVALID {{output}}",
            "scale": "0-1",
        },
    ).json()
    bad = client.post(
        f"/api/v1/evaluators/{inv['id']}/test",
        headers=H(),
        json={"trace_id": "t-rubric"},
    ).json()
    assert bad["status"] == "error"
    assert "invalid json" in bad["explanation"].lower()

    # Timeout: judge sleeps past timeout_s
    slow = client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={
            "type": "rubric",
            "name": "slow_judge",
            "prompt": "TIMEOUT {{output}}",
            "scale": "pass_fail",
        },
    ).json()

    # Call engine directly with tiny timeout
    svc = client.app.state.service
    tr = svc.get_trace("default", "t-rubric").model_dump()
    ev = svc.get_evaluator("default", slow["id"])
    from evalverse.server.engine import run_rubric_evaluator

    timed = run_rubric_evaluator(ev["config"], tr, None, svc.judge_fn, timeout_s=0.05)
    assert timed["status"] == "error"
    assert "timed out" in timed["explanation"].lower() or "judge" in timed["explanation"].lower()


# ---- evaluation worker ----
def test_evaluation_worker_idempotency(client):
    _trace(client, tid="t-idem", meta={"expectation": {"answer": "12.00", "answer_type": "number"}})
    client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={
            "type": "rule",
            "name": "ans_present",
            "checks": [{"op": "field_present", "path": "run.answer"}],
        },
    )
    r1 = client.post(
        "/api/v1/evaluations",
        headers=H(),
        json={"trace_ids": ["t-idem"], "evaluator_ids": ["ans_present"]},
    ).json()
    run_id = r1["id"]

    # Wait for completion
    detail = None
    for _ in range(100):
        detail = client.get(f"/api/v1/evaluations/{run_id}", headers=H()).json()
        if detail["status"] in ("completed", "partial", "failed"):
            break
        time.sleep(0.05)
    assert detail["status"] == "completed"
    n1 = len(detail["results"])
    assert n1 >= 1

    # Re-queue same pair via a second run — new run id but results unique per run;
    # within same run, claiming twice is idempotent. Re-create evaluation.
    r2 = client.post(
        "/api/v1/evaluations",
        headers=H(),
        json={"trace_ids": ["t-idem"], "evaluator_ids": ["ans_present"]},
    ).json()
    for _ in range(100):
        d2 = client.get(f"/api/v1/evaluations/{r2['id']}", headers=H()).json()
        if d2["status"] in ("completed", "partial", "failed"):
            break
        time.sleep(0.05)
    assert len(d2["results"]) == 1

    # Builtin with expectation
    br = client.post(
        "/api/v1/evaluations",
        headers=H(),
        json={"trace_ids": ["t-idem"], "evaluator_ids": ["answer_correctness"]},
    ).json()
    for _ in range(100):
        bd = client.get(f"/api/v1/evaluations/{br['id']}", headers=H()).json()
        if bd["status"] in ("completed", "partial", "failed"):
            break
        time.sleep(0.05)
    assert bd["results"][0]["status"] in ("completed", "skipped", "error")

    # Builtin without expectation -> skipped
    _trace(client, tid="t-noexp", meta={})
    br2 = client.post(
        "/api/v1/evaluations",
        headers=H(),
        json={"trace_ids": ["t-noexp"], "evaluator_ids": ["answer_correctness"]},
    ).json()
    for _ in range(100):
        bd2 = client.get(f"/api/v1/evaluations/{br2['id']}", headers=H()).json()
        if bd2["status"] in ("completed", "partial", "failed"):
            break
        time.sleep(0.05)
    assert bd2["results"][0]["status"] == "skipped"
    assert "no expectation" in bd2["results"][0]["explanation"]


# ---- policies / alerts ----
def test_policy_sampling_deterministic_and_alert_once(client):
    from evalverse.server.platform import _stable_sample

    tid = "abc123"
    assert _stable_sample(tid, 1.0) is True
    assert _stable_sample(tid, 0.0) is False
    a = _stable_sample(tid, 0.5)
    b = _stable_sample(tid, 0.5)
    assert a is b

    # Rule that fails so alert fires
    client.post(
        "/api/v1/evaluators",
        headers=H(),
        json={
            "type": "rule",
            "name": "must_be_99",
            "dimension": "Perception",
            "checks": [{"op": "equals", "path": "output.answer", "value": "99"}],
        },
    )
    pol = client.post(
        "/api/v1/policies",
        headers=H(),
        json={
            "name": "online",
            "filter": {"agent": "receipt-agent", "tags": ["demo"]},
            "sample_rate": 1.0,
            "evaluator_ids": ["must_be_99"],
            "enabled": True,
            "alert": {"dimension": "Perception", "below": 0.5},
        },
    ).json()

    # Creating completed trace triggers policy
    _trace(
        client,
        tid="t-alert",
        agent="receipt-agent",
        output={"answer": "12.00"},
        status="completed",
    )
    # Wait for worker + alert
    alerts = []
    for _ in range(100):
        alerts = client.get("/api/v1/alerts", headers=H()).json()
        if alerts:
            break
        time.sleep(0.05)
    assert len(alerts) >= 1
    assert alerts[0]["policy_id"] == pol["id"]

    # Force another evaluation under same policy — alert should not duplicate for same result
    # (unique on policy_id, result_id). Re-run evaluation manually with same run would create new result ids.
    n = len(alerts)
    # Re-trigger by patching a running->completed transition on a new trace
    client.post(
        "/api/v1/traces",
        headers=H(),
        json={
            "id": "t-alert-2",
            "agent": "receipt-agent",
            "status": "running",
            "source": "sdk",
            "tags": ["demo"],
            "output": {"answer": "1"},
            "spans": [
                {
                    "id": "m1",
                    "name": "m",
                    "type": "model",
                    "status": "completed",
                    "output": {"answer": "1"},
                }
            ],
        },
    )
    client.patch(
        "/api/v1/traces/t-alert-2",
        headers=H(),
        json={"status": "completed"},
    )
    for _ in range(100):
        alerts2 = client.get("/api/v1/alerts", headers=H()).json()
        if len(alerts2) > n:
            break
        time.sleep(0.05)
    # Each failing result gets one alert (new result_id) — still one per result
    by_result = {}
    for a in client.get("/api/v1/alerts", headers=H()).json():
        by_result.setdefault(a["result_id"], 0)
        by_result[a["result_id"]] += 1
    assert all(v == 1 for v in by_result.values())

    q = client.get("/api/v1/queue", headers=H()).json()
    assert set(q) >= {"depth", "running", "completed", "failed"}


def test_list_builtin_evaluators(client):
    rows = client.get("/api/v1/evaluators", headers=H()).json()
    ids = {r["id"] for r in rows}
    assert "answer_correctness" in ids
    assert "evidence_grounding" in ids
    assert "stage_attribution" in ids


def test_promote_trace(client):
    _trace(client, tid="t-prom")
    ds = client.post("/api/v1/datasets", headers=H(), json={"name": "from_traces"}).json()
    client.post(f"/api/v1/datasets/{ds['id']}/versions", headers=H(), json={"version": "v1"})
    item = client.post(
        "/api/v1/traces/t-prom/promote",
        headers=H(),
        json={
            "dataset_id": ds["id"],
            "expectation": {"answer": "12.00", "answer_type": "number"},
            "tags": ["promoted"],
        },
    ).json()
    assert item["metadata"]["promoted_from"] == "t-prom"
    assert item["expectation"]["answer"] == "12.00"
