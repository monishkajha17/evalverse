"""Temporal events API/SDK/importer + claim_grounding evaluator tests."""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from evalverse import evaluators as ev
from evalverse.events import build_audio_events, build_video_events
from evalverse.importer import import_results_local
from evalverse.sdk import EvalVerse
from evalverse.server.app import create_app


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "e.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=False,
    )
    with TestClient(app) as c:
        yield c


def H(project="default"):
    return {"Authorization": "Bearer dev", "X-Project": project}


def _make_trace(client, tid="t-ev-1"):
    r = client.post(
        "/api/v1/traces",
        headers=H(),
        json={
            "id": tid,
            "name": "events-demo",
            "agent": "a",
            "status": "completed",
            "source": "sdk",
            "spans": [{"id": "s1", "name": "model", "type": "model", "status": "completed"}],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_events_api_batch_and_idempotency(client):
    _make_trace(client, "t-ev-idem")
    body = {
        "events": [
            {
                "client_id": "gt:1",
                "source": "ground_truth",
                "label": "turn 1",
                "start_ms": 0,
                "end_ms": 1000,
                "time_base": "media",
            },
            {
                "client_id": "asr:1",
                "source": "asr",
                "label": "hello",
                "start_ms": 0,
                "end_ms": 1000,
            },
        ]
    }
    r1 = client.post("/api/v1/traces/t-ev-idem/events", headers=H(), json=body)
    assert r1.status_code == 200, r1.text
    assert len(r1.json()) == 2
    r2 = client.post("/api/v1/traces/t-ev-idem/events", headers=H(), json=body)
    assert r2.status_code == 200
    assert len(r2.json()) == 2
    # Same ids returned (idempotent)
    assert {e["id"] for e in r1.json()} == {e["id"] for e in r2.json()}

    listed = client.get("/api/v1/traces/t-ev-idem/events", headers=H()).json()
    assert len(listed) == 2
    asr_only = client.get(
        "/api/v1/traces/t-ev-idem/events", headers=H(), params={"source": "asr"}
    ).json()
    assert len(asr_only) == 1 and asr_only[0]["source"] == "asr"

    detail = client.get("/api/v1/traces/t-ev-idem", headers=H()).json()
    assert detail["events_summary"] == {"asr": 1, "ground_truth": 1}


def test_sdk_span_event(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "sdk.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=False,
    )
    with TestClient(app) as http:
        ev_client = EvalVerse(api_key="dev", project="default", client=http, sync=True)
        with ev_client.trace(name="sdk-ev", agent="sdk") as tr:
            with tr.span("work", type="model") as sp:
                sp.event("mention", 100, 400, source="sdk", payload={"k": 1})
                sp.set_output({"answer": "ok"})
        detail = http.get(f"/api/v1/traces/{tr.id}", headers=H()).json()
        assert detail["events_summary"].get("sdk", 0) == 1
        events = http.get(f"/api/v1/traces/{tr.id}/events", headers=H()).json()
        assert events[0]["label"] == "mention"
        assert events[0]["start_ms"] == 100
        assert events[0]["span_id"]


def test_importer_audio_and_video_events(tmp_path: Path, client):
    # Tiny png as stand-in media for attach paths
    img = tmp_path / "clip.png"
    Image.new("RGB", (8, 8), color=(10, 20, 30)).save(img)
    audio_rel = str(img)  # path used as audio stand-in
    video_rel = str(img)

    audio_results = {
        "cases": [
            {
                "id": "a1",
                "modality": "audio",
                "audio": audio_rel,
                "turns": [
                    {"index": 1, "speaker_id": "A", "start_ms": 0, "end_ms": 500, "text": "hi"},
                    {"index": 2, "speaker_id": "B", "start_ms": 500, "end_ms": 1200, "text": "bye"},
                ],
                "answer": "2",
            }
        ],
        "runs": [
            {
                "agent": "ag",
                "case_id": "a1",
                "condition": "clean",
                "answer": "2",
                "span_ms": [500, 1200],
                "asr_turns": {"1": "hi", "2": "bye"},
            }
        ],
        "traces": [
            {
                "id": "ag|a1|clean",
                "agent": "ag",
                "case_id": "a1",
                "variant": "clean",
                "assets": [{"id": "aud1", "path": audio_rel, "modality": "audio"}],
                "spans": [
                    {"id": "s1", "name": "attach_audio", "type": "media", "parent_span_ids": []},
                    {
                        "id": "s2_1",
                        "name": "transcribe turn 1",
                        "type": "media",
                        "parent_span_ids": ["s1"],
                        "attributes": {
                            "turn": 1,
                            "start_ms": 0,
                            "end_ms": 500,
                            "text": "hi",
                        },
                    },
                    {
                        "id": "s2_2",
                        "name": "transcribe turn 2",
                        "type": "media",
                        "parent_span_ids": ["s1"],
                        "attributes": {
                            "turn": 2,
                            "start_ms": 500,
                            "end_ms": 1200,
                            "text": "bye",
                        },
                    },
                    {
                        "id": "s3",
                        "name": "model_call",
                        "type": "model",
                        "parent_span_ids": ["s2_1", "s2_2"],
                        "output": {"answer": "2", "span_ms": [500, 1200]},
                    },
                ],
            }
        ],
        "results": [],
    }
    video_results = {
        "cases": [
            {
                "id": "v1",
                "modality": "video",
                "video": video_rel,
                "events": [
                    {"type": "item", "text": "MILK", "t_ms": 0, "box": [1, 2, 3, 4]},
                    {"type": "total", "text": "12.00", "t_ms": 2000, "box": [5, 6, 7, 8]},
                ],
                "truth_span_ms": [2000, 3500],
                "answer": "12.00",
            }
        ],
        "runs": [
            {
                "agent": "ag",
                "case_id": "v1",
                "condition": "clean",
                "answer": "12.00",
                "span_ms": [2000, 3500],
            }
        ],
        "traces": [
            {
                "id": "ag|v1|clean",
                "agent": "ag",
                "case_id": "v1",
                "variant": "clean",
                "assets": [{"id": "vid1", "path": video_rel, "modality": "video"}],
                "spans": [
                    {"id": "s1", "name": "attach_video", "type": "media", "parent_span_ids": []},
                    {
                        "id": "s2_1",
                        "name": "sample frame 1",
                        "type": "media",
                        "parent_span_ids": ["s1"],
                        "attributes": {"t_ms": 0, "frame_index": 1},
                    },
                    {
                        "id": "s2_2",
                        "name": "sample frame 2",
                        "type": "media",
                        "parent_span_ids": ["s1"],
                        "attributes": {"t_ms": 2000, "frame_index": 2},
                    },
                    {
                        "id": "s3",
                        "name": "model_call",
                        "type": "model",
                        "parent_span_ids": ["s2_1", "s2_2"],
                        "output": {"answer": "12.00", "span_ms": [2000, 3500]},
                    },
                ],
            }
        ],
        "results": [],
    }

    svc = client.app.state.service
    ap = tmp_path / "results_audio.json"
    vp = tmp_path / "results_video.json"
    ap.write_text(json.dumps(audio_results))
    vp.write_text(json.dumps(video_results))

    s1 = import_results_local(ap, tag="audio", service=svc)
    s2 = import_results_local(ap, tag="audio", service=svc)
    assert s1["traces"] == 1
    assert s2["traces_skipped"] == 1
    # Re-import must not duplicate events
    evs1 = client.get("/api/v1/traces/ag|a1|clean/events", headers=H()).json()
    n1 = len(evs1)
    import_results_local(ap, tag="audio", service=svc)
    evs2 = client.get("/api/v1/traces/ag|a1|clean/events", headers=H()).json()
    assert len(evs2) == n1
    sources = {e["source"] for e in evs2}
    assert "asr" in sources and "ground_truth" in sources
    assert "agent_citation" in sources

    import_results_local(vp, tag="video", service=svc)
    vevs = client.get("/api/v1/traces/ag|v1|clean/events", headers=H()).json()
    vsources = {e["source"] for e in vevs}
    assert "ground_truth" in vsources
    assert "sampled_frame" in vsources
    assert "agent_citation" in vsources

    # Media events endpoint
    mid = vevs[0]["media_id"]
    if mid:
        me = client.get(f"/api/v1/media/{mid}/events", headers=H())
        assert me.status_code == 200
        assert len(me.json()) >= 1


def test_build_events_helpers_no_dup_client_ids():
    case = {
        "modality": "audio",
        "turns": [{"index": 1, "start_ms": 0, "end_ms": 100, "text": "a", "speaker_id": "S"}],
    }
    run = {"asr_turns": {"1": "a"}, "span_ms": [0, 100]}
    spans = [
        {
            "id": "s2_1",
            "name": "transcribe turn 1",
            "attributes": {"turn": 1, "start_ms": 0, "end_ms": 100, "text": "a"},
        }
    ]
    evs = build_audio_events(case=case, run=run, spans=spans, media_id="m1")
    cids = [e["client_id"] for e in evs]
    assert len(cids) == len(set(cids))

    vcase = {
        "modality": "video",
        "events": [{"type": "total", "text": "1", "t_ms": 1000}],
    }
    vspans = [{"id": "s2_1", "name": "sample frame 1", "attributes": {"t_ms": 1000}}]
    vevs = build_video_events(case=vcase, run={"span_ms": [1000, 2000]}, spans=vspans)
    assert {e["source"] for e in vevs} >= {"ground_truth", "sampled_frame", "agent_citation"}


def _claim_judge_factory(mode: str = "mixed"):
    """Build a mock judge that returns controllable claim grounding responses."""

    state = {"n": 0}

    def judge(prompt, image_bytes=None, model=None, timeout_s=60.0, **_):
        state["n"] += 1
        lower = prompt.lower()
        if "extract" in lower and "claims" in lower:
            return json.dumps({"claims": ["total is 12.00", "tax is 1.00", "date is Monday"]}), {}
        if "completeness" in lower or "reference facts" in lower or "fraction of the" in lower:
            return json.dumps({"completeness": 0.5, "explanation": "half"}), {}
        if "TIMEOUT_CLAIM" in prompt or (mode == "timeout" and "CLAIM:" in prompt):
            time.sleep(0.05)
            # Simulate soft timeout by sleeping past a tiny timeout in caller tests
            raise TimeoutError("simulated")
        if mode == "invalid" and "CLAIM:" in prompt:
            return "not-json", {}
        if "CLAIM:" in prompt:
            claim = prompt.split("CLAIM:", 1)[1].strip().lower()
            if mode == "all_supported" or "total" in claim:
                return json.dumps(
                    {
                        "verdict": "supported",
                        "evidence_box": [1, 2, 3, 4],
                        "evidence_time_ms": None,
                        "explanation": "ok",
                    }
                ), {}
            if "tax" in claim or mode == "contradicted":
                return json.dumps(
                    {
                        "verdict": "contradicted",
                        "evidence_box": None,
                        "evidence_time_ms": None,
                        "explanation": "wrong",
                    }
                ), {}
            return json.dumps(
                {
                    "verdict": "not_found",
                    "evidence_box": None,
                    "evidence_time_ms": None,
                    "explanation": "missing",
                }
            ), {}
        return json.dumps({"claims": []}), {}

    return judge, state


def test_claim_grounding_supported_contradicted_not_found():
    judge, _ = _claim_judge_factory("mixed")
    meta = ev.REGISTRY["claim_grounding"]
    case = {"id": "c1", "modality": "image", "image": None}
    run = {"answer": "The total is 12.00, tax is 1.00, date is Monday"}
    # Clear cache between tests
    ev._CLAIM_JUDGE_CACHE.clear()
    res = ev._call(
        meta,
        agent="a",
        case_id="c1",
        variant="clean",
        case=case,
        run=run,
        judge_fn=judge,
        judge_model="muse-wonder-1.0",
    )
    assert res["status"] == "completed"
    assert res["score"] == pytest.approx(1 / 3)
    assert res["label"] == "hallucinated"
    em = res["execution_metadata"]
    assert em["n_supported"] == 1
    assert em["n_contradicted"] == 1
    assert em["n_not_found"] == 1
    assert em["hallucination"] == pytest.approx(2 / 3)
    assert em["completeness_skipped"] is True
    assert em["completeness_reason"] == "no reference facts"
    assert any(e.get("role") == "supports" and e.get("judge_claimed") for e in res["evidence"])
    assert "total is 12.00" in res["explanation"]


def test_claim_grounding_invalid_json_and_timeout():
    meta = ev.REGISTRY["claim_grounding"]
    case = {"id": "c2", "modality": "image"}
    run = {"answer": "total is 12"}

    ev._CLAIM_JUDGE_CACHE.clear()
    judge_inv, _ = _claim_judge_factory("invalid")
    res = ev._call(
        meta,
        agent="a",
        case_id="c2",
        variant="clean",
        case=case,
        run=run,
        judge_fn=judge_inv,
    )
    assert res["status"] == "completed"
    # All claims errored → judged_n=0 → groundedness 0
    assert res["execution_metadata"]["n_error"] == 3
    assert all(c["status"] == "error" for c in res["execution_metadata"]["claims"])

    ev._CLAIM_JUDGE_CACHE.clear()

    def timeout_judge(prompt, image_bytes=None, model=None, timeout_s=60.0, **_):
        if "extract" in prompt.lower():
            return json.dumps({"claims": ["only claim"]}), {}
        raise TimeoutError("boom")

    res2 = ev._call(
        meta,
        agent="a",
        case_id="c2",
        variant="clean",
        case=case,
        run=run,
        judge_fn=timeout_judge,
    )
    assert res2["status"] == "completed"
    assert res2["execution_metadata"]["n_error"] >= 1


def test_claim_grounding_completeness_with_facts():
    judge, _ = _claim_judge_factory("all_supported")
    meta = ev.REGISTRY["claim_grounding"]
    case = {
        "id": "c3",
        "modality": "image",
        "expectation": {"facts": ["total is 12.00", "tax is 1.00"]},
    }
    run = {"answer": "The total is 12.00"}
    ev._CLAIM_JUDGE_CACHE.clear()
    res = ev._call(
        meta,
        agent="a",
        case_id="c3",
        variant="clean",
        case=case,
        run=run,
        judge_fn=judge,
    )
    assert res["status"] == "completed"
    assert res["execution_metadata"]["completeness_skipped"] is False
    assert res["execution_metadata"]["completeness"] == pytest.approx(0.5)
    assert res["label"] == "grounded" or res["score"] >= 0.9 or res["score"] == 1.0


def test_claim_grounding_offline_skipped():
    meta = ev.REGISTRY["claim_grounding"]
    res = ev._call(
        meta,
        agent="a",
        case_id="c4",
        variant="clean",
        case={"id": "c4", "modality": "image"},
        run={"answer": "x"},
    )
    assert res["status"] == "skipped"


def test_claim_grounding_via_evaluations(tmp_path: Path):
    # Seed a CORD-like image trace; workers on so POST /evaluations runs the job.
    app = create_app(
        db_path=tmp_path / "cg.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=True,
        worker_size=1,
    )
    judge, _ = _claim_judge_factory("all_supported")
    app.state.service.judge_fn = judge
    with TestClient(app) as client:
        img = tmp_path / "receipt.png"
        Image.new("RGB", (32, 32), color=(200, 180, 160)).save(img)
        data = img.read_bytes()
        up = client.post(
            "/api/v1/media",
            headers=H(),
            files={"file": ("receipt.png", data, "image/png")},
            data={"modality": "image"},
        )
        assert up.status_code == 200
        mid = up.json()["id"]

        client.post(
            "/api/v1/traces",
            headers=H(),
            json={
                "id": "cord|receipt_01|clean",
                "name": "cord",
                "agent": "cord",
                "status": "completed",
                "source": "import",
                "output": {"answer": "The total is 12.00"},
                "metadata": {"case_id": "receipt_01", "variant": "clean"},
                "media": [{"media_id": mid, "role": "input"}],
                "spans": [
                    {
                        "id": "s2",
                        "name": "model_call",
                        "type": "model",
                        "status": "completed",
                        "output": {"answer": "The total is 12.00", "box": [1, 2, 3, 4]},
                    }
                ],
            },
        )

        assert "claim_grounding" in ev.REGISTRY
        run = client.post(
            "/api/v1/evaluations",
            headers=H(),
            json={"trace_ids": ["cord|receipt_01|clean"], "evaluator_ids": ["claim_grounding"]},
        )
        assert run.status_code == 200, run.text
        run_id = run.json()["id"]

        detail = None
        for _ in range(100):
            detail = client.get(f"/api/v1/evaluations/{run_id}", headers=H()).json()
            if detail["status"] in ("completed", "partial", "failed"):
                break
            time.sleep(0.05)
        assert detail is not None
        assert detail["status"] == "completed", detail
        assert detail["results"], detail
        result = detail["results"][0]
        assert result["evaluator_id"] == "claim_grounding"
        assert result["status"] == "completed"
        assert result["score"] is not None
        print("claim_grounding result:", json.dumps(result, indent=2, default=str))
