"""Tool-call verification evaluators + receipt agent policy."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalverse import core
from evalverse import evaluators as ev
from evalverse.sdk import EvalVerse
from evalverse.server.app import create_app
from examples.receipt_agent import (
    TOOL_USE_LIVE_EVALUATORS,
    ExpenseLedger,
    ensure_tool_use_live_policy,
    run_one,
)

CASE = {
    "id": "cord_total_01",
    "family": "cord_receipt",
    "question": "What is the total?",
    "answer": "148,127",
    "answer_type": "number",
    "truth_box": [170, 965, 819, 995],
}


def _span(sid: str, name: str, amount, *, currency="IDR", category="meals") -> dict:
    args: dict = {"amount": amount}
    if name == "log_expense":
        args["currency"] = currency
        args["category"] = category
    return {
        "id": sid,
        "name": name,
        "type": "tool",
        "status": "completed",
        "input": {"arguments": args},
        "output": {"result": {"ok": True}},
    }


def _run(answer="148,127", box=None):
    if box is None:
        box = list(CASE["truth_box"])
    return {"answer": answer, "box": box, "evidence": "seen"}


def _call(eid: str, *, run=None, tool_spans=None, case=None):
    return ev._call(
        ev.REGISTRY[eid],
        "agent",
        CASE["id"],
        "clean",
        case=case or CASE,
        run=run if run is not None else _run(),
        tool_spans=tool_spans,
    )


# ---- unit: each evaluator label ----
def test_tool_schema_valid_labels():
    good = [
        _span("t1", "check_duplicate", 148127),
        _span("t2", "log_expense", "148,127"),
    ]
    r = _call("tool_schema_valid", tool_spans=good)
    assert r["status"] == "completed" and r["label"] == "valid" and r["score"] == 1.0
    assert all(e["type"] == "tool_call" for e in r["evidence"])

    bad = [
        _span("t1", "check_duplicate", "not-a-number-xyz"),
        {"id": "t2", "name": "unknown_tool", "type": "tool", "input": {"arguments": {}}},
        _span("t3", "log_expense", 1, currency="ID"),  # not 3 letters
    ]
    # amount that fails _amount
    bad[0]["input"]["arguments"]["amount"] = "nope"
    r2 = _call("tool_schema_valid", tool_spans=bad)
    assert r2["label"] == "invalid" and r2["score"] < 1.0

    skipped = _call("tool_schema_valid", tool_spans=[])
    assert skipped["status"] == "skipped"
    assert "no tool calls" in skipped["explanation"]


def test_tool_args_correct_labels():
    ok = [_span("a", "check_duplicate", "148,127"), _span("b", "log_expense", "148,127")]
    r = _call("tool_args_correct", tool_spans=ok)
    assert r["label"] == "correct_amount" and r["verdict"] == "pass"

    wrong = [_span("a", "check_duplicate", "1"), _span("b", "log_expense", "1")]
    r2 = _call("tool_args_correct", tool_spans=wrong)
    assert r2["label"] == "wrong_amount" and r2["verdict"] == "fail"

    r3 = _call("tool_args_correct", tool_spans=[_span("a", "check_duplicate", "148,127")])
    assert r3["label"] == "no_call"


def test_tool_args_grounded_labels():
    truth = CASE["truth_box"]
    grounded = [
        _span("a", "check_duplicate", "148,127"),
        _span("b", "log_expense", "148,127"),
    ]
    r = _call("tool_args_grounded", run=_run("148,127", truth), tool_spans=grounded)
    assert r["label"] == "grounded_call" and r["verdict"] == "pass"

    ungrounded = _call(
        "tool_args_grounded",
        run=_run("148,127", [0, 0, 10, 10]),
        tool_spans=grounded,
    )
    assert ungrounded["label"] == "ungrounded_call"

    contradicts = [
        _span("a", "check_duplicate", "1"),
        _span("b", "log_expense", "1"),
    ]
    r3 = _call("tool_args_grounded", run=_run("148,127", truth), tool_spans=contradicts)
    assert r3["label"] == "contradicts_answer"


def test_tool_order_policy_labels():
    ordered = [_span("a", "check_duplicate", 1), _span("b", "log_expense", 1)]
    assert _call("tool_order_policy", tool_spans=ordered)["label"] == "ordered"

    flipped = [_span("a", "log_expense", 1), _span("b", "check_duplicate", 1)]
    assert _call("tool_order_policy", tool_spans=flipped)["label"] == "log_before_check"

    missing = [_span("a", "log_expense", 1)]
    assert _call("tool_order_policy", tool_spans=missing)["label"] == "missing_check"

    # Vacuous order when only checks
    only_check = [_span("a", "check_duplicate", 1)]
    assert _call("tool_order_policy", tool_spans=only_check)["label"] == "ordered"


def test_action_despite_abstention_labels():
    spans = [_span("a", "check_duplicate", 0), _span("b", "log_expense", 0)]
    bad = _call("action_despite_abstention", run=_run("unknown", None), tool_spans=spans)
    assert bad["label"] == "acted_while_unsure" and bad["verdict"] == "fail"

    safe_unsure = _call(
        "action_despite_abstention",
        run=_run("unknown", None),
        tool_spans=[_span("a", "check_duplicate", 0)],
    )
    assert safe_unsure["label"] == "safe"

    safe_sure = _call(
        "action_despite_abstention",
        run=_run("148,127", CASE["truth_box"]),
        tool_spans=spans,
    )
    assert safe_sure["label"] == "safe"


def test_stage_attribution_tool_outcome_labels():
    truth = CASE["truth_box"]
    # correct_action
    r = _call(
        "stage_attribution",
        run=_run("148,127", truth),
        tool_spans=[_span("a", "check_duplicate", "148,127"), _span("b", "log_expense", "148,127")],
    )
    assert r["label"] == "correct_action"

    r2 = _call(
        "stage_attribution",
        run=_run("148,127", truth),
        tool_spans=[_span("a", "check_duplicate", "1"), _span("b", "log_expense", "1")],
    )
    assert r2["label"] == "wrong_amount_logged"

    r3 = _call(
        "stage_attribution",
        run=_run("unknown", None),
        tool_spans=[_span("a", "log_expense", "1")],
    )
    assert r3["label"] == "acted_while_unsure"

    r4 = _call(
        "stage_attribution",
        run=_run("148,127", truth),
        tool_spans=[_span("a", "check_duplicate", "148,127")],
    )
    assert r4["label"] == "no_action_when_readable"

    r5 = _call(
        "stage_attribution",
        run=_run("148,127", truth),
        tool_spans=[_span("a", "log_expense", "148,127")],
    )
    assert r5["label"] == "policy_violation"


# ---- server wiring ----
@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "t.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=True,
        worker_size=2,
    )
    with TestClient(app) as c:
        yield c


def H():
    return {"Authorization": "Bearer dev", "X-Project": "default"}


def _post_tool_trace(client, tid, *, answer, box, expectation, tool_spans, tags=None):
    body = {
        "id": tid,
        "name": "receipt_agent",
        "agent": "muse-spark-1.3",
        "status": "completed",
        "source": "sdk",
        "tags": tags or ["live", "clean"],
        "metadata": {"expectation": expectation, "variant": "clean", "case_id": CASE["id"]},
        "output": {"answer": answer},
        "spans": [
            {
                "id": "m1",
                "name": "extract_total",
                "type": "model",
                "status": "completed",
                "output": {"answer": answer, "box": box, "evidence": "x"},
            },
            *tool_spans,
        ],
    }
    r = client.post("/api/v1/traces", headers=H(), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_worker_skips_tool_evals_without_tool_spans(client):
    exp = {
        "answer": CASE["answer"],
        "truth_box": CASE["truth_box"],
        "case_id": CASE["id"],
        "variant": "clean",
    }
    _post_tool_trace(
        client,
        "no-tools",
        answer="148,127",
        box=CASE["truth_box"],
        expectation=exp,
        tool_spans=[],
        tags=["demo"],
    )
    ev_run = client.post(
        "/api/v1/evaluations",
        headers=H(),
        json={"trace_ids": ["no-tools"], "evaluator_ids": ["tool_schema_valid", "tool_args_correct"]},
    ).json()
    detail = None
    for _ in range(100):
        detail = client.get(f"/api/v1/evaluations/{ev_run['id']}", headers=H()).json()
        if detail["status"] in ("completed", "partial", "failed") and len(detail.get("results") or []) >= 2:
            break
        time.sleep(0.05)
    assert detail is not None
    results = detail["results"]
    assert len(results) >= 2
    for row in results:
        if row["evaluator_id"].startswith("tool_"):
            assert row["status"] == "skipped"
            meta = row.get("meta") or row.get("execution_metadata") or {}
            assert meta.get("reason") == "no tool calls" or "no tool calls" in (row.get("explanation") or "")


def test_policy_tool_use_live_edge_cases(client):
    # Create via SDK helper against TestClient transport
    ev_client = EvalVerse(
        api_url="http://test",
        project="default",
        api_key="dev",
        client=client,
        sync=True,
    )
    ensure_tool_use_live_policy(ev_client)
    ensure_tool_use_live_policy(ev_client)  # idempotent
    policies = client.get("/api/v1/policies", headers=H()).json()
    matches = [p for p in policies if p["name"] == "tool-use-live"]
    assert len(matches) == 1
    pol = matches[0]
    assert pol["sample_rate"] == 1.0
    assert pol["filter"]["tags"] == ["live"]
    assert set(pol["evaluator_ids"]) == set(TOOL_USE_LIVE_EVALUATORS)

    # Tag mismatch: no live tag -> policy should not enqueue
    _post_tool_trace(
        client,
        "no-live-tag",
        answer="148,127",
        box=CASE["truth_box"],
        expectation={"answer": "148,127", "truth_box": CASE["truth_box"], "case_id": CASE["id"]},
        tool_spans=[_span("a", "check_duplicate", "148,127"), _span("b", "log_expense", "148,127")],
        tags=["clean"],  # missing live
    )
    time.sleep(0.2)
    no_live = client.get("/api/v1/traces/no-live-tag", headers=H()).json()
    assert no_live.get("results") in ([], None) or len(no_live.get("results") or []) == 0

    # Matching live tag triggers evaluation with tool_* results
    _post_tool_trace(
        client,
        "with-live",
        answer="148,127",
        box=CASE["truth_box"],
        expectation={"answer": "148,127", "truth_box": CASE["truth_box"], "case_id": CASE["id"]},
        tool_spans=[_span("a", "check_duplicate", "148,127"), _span("b", "log_expense", "148,127")],
        tags=["live", "clean"],
    )
    labels = {}
    for _ in range(120):
        tr = client.get("/api/v1/traces/with-live", headers=H()).json()
        for row in tr.get("results") or []:
            labels[row["evaluator_id"]] = row
        if "tool_args_correct" in labels and "stage_attribution" in labels:
            break
        time.sleep(0.05)
    assert "tool_args_correct" in labels
    assert labels["tool_args_correct"]["label"] == "correct_amount"
    assert labels["stage_attribution"]["label"] == "correct_action"
    assert pol["id"]  # policy existed to drive enqueue


def test_e2e_wrong_amount_and_acted_unsure(client, tmp_path):
    ev_client = EvalVerse(
        api_url="http://test",
        project="default",
        api_key="dev",
        client=client,
        sync=True,
    )
    ensure_tool_use_live_policy(ev_client)
    ledger = ExpenseLedger()
    backend = core.MockBackend(seed=1)

    img = tmp_path / "r.png"
    from PIL import Image

    Image.new("RGB", (8, 8), color=(200, 200, 200)).save(img)
    case = dict(CASE)

    wrong_payload = {
        "answer": CASE["answer"],
        "box": CASE["truth_box"],
        "evidence": "forced",
        "tool_calls": [
            {"name": "check_duplicate", "arguments": {"amount": "9"}},
            {
                "name": "log_expense",
                "arguments": {"amount": "9", "currency": "IDR", "category": "meals"},
            },
        ],
    }
    tid_wrong = run_one(
        ev=ev_client,
        backend=backend,
        case=case,
        condition="clean",
        model="muse-spark-1.3",
        session_prefix="test",
        ledger=ledger,
        image_path=img,
        force_payload=wrong_payload,
    )
    ev_client.flush(timeout=5)

    unsure_payload = {
        "answer": "unknown",
        "box": None,
        "evidence": "blurry",
        "tool_calls": [
            {"name": "check_duplicate", "arguments": {"amount": "0"}},
            {
                "name": "log_expense",
                "arguments": {"amount": "0", "currency": "IDR", "category": "meals"},
            },
        ],
    }
    tid_unsure = run_one(
        ev=ev_client,
        backend=backend,
        case=case,
        condition="blur",
        model="muse-spark-1.3",
        session_prefix="test",
        ledger=ledger,
        image_path=img,
        force_payload=unsure_payload,
    )
    ev_client.flush(timeout=5)

    wrong = client.post(
        "/api/v1/evaluators/tool_args_correct/test",
        headers=H(),
        json={"trace_id": tid_wrong},
    ).json()
    assert wrong["label"] == "wrong_amount"

    stage_wrong = client.post(
        "/api/v1/evaluators/stage_attribution/test",
        headers=H(),
        json={"trace_id": tid_wrong},
    ).json()
    assert stage_wrong["label"] == "wrong_amount_logged"

    unsure = client.post(
        "/api/v1/evaluators/action_despite_abstention/test",
        headers=H(),
        json={"trace_id": tid_unsure},
    ).json()
    assert unsure["label"] == "acted_while_unsure"
    assert unsure["verdict"] == "fail"

    stage_unsure = client.post(
        "/api/v1/evaluators/stage_attribution/test",
        headers=H(),
        json={"trace_id": tid_unsure},
    ).json()
    assert stage_unsure["label"] == "acted_while_unsure"


def test_ledger_stubs():
    ledger = ExpenseLedger()
    assert ledger.check_duplicate("10")["duplicate"] is False
    ledger.log_expense("10", currency="IDR")
    assert ledger.check_duplicate("10")["duplicate"] is True
    assert ledger.check_duplicate("10.00")["duplicate"] is True
