"""cross_modal_judge + playground cross_check tests (mocked judge, no live models)."""

from __future__ import annotations

import io
import json
import time
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from evalverse import evaluators as ev
from evalverse.server.app import create_app
from evalverse.server.engine import run_builtin


def _png_bytes(color=(200, 100, 50), size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="PNG")
    return buf.getvalue()


def _wav_bytes(duration_s: float = 0.4, sr: int = 16000) -> bytes:
    n = int(sr * duration_s)
    samples = (np.sin(2 * np.pi * 440 * np.arange(n) / sr) * 0.2 * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EVALVERSE_ALLOW_MOCK", "1")
    monkeypatch.setenv("EVALVERSE_PLAYGROUND_DAILY", "50")
    app = create_app(
        db_path=tmp_path / "cmj.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=True,
        worker_size=2,
        allow_dev_key=True,
    )
    with TestClient(app) as c:
        yield c


def H(project="default"):
    return {"Authorization": "Bearer dev", "X-Project": project}


def _poll(client: TestClient, run_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    detail = None
    while time.time() < deadline:
        r = client.get(f"/api/v1/playground/runs/{run_id}", headers=H())
        assert r.status_code == 200, r.text
        detail = r.json()
        if detail["status"] in ("completed", "failed"):
            return detail
        time.sleep(0.05)
    assert detail is not None
    return detail


def _judge_factory(mode: str = "mixed"):
    state = {"n": 0}

    def judge(prompt, image_bytes=None, model=None, timeout_s=60.0, **_):
        state["n"] += 1
        lower = prompt.lower()
        if "extract" in lower and "claims" in lower:
            if mode == "no_claims":
                return json.dumps({"claims": []}), {}
            return json.dumps(
                {"claims": ["total is 148127", "tax is wrong", "date is Monday"]}
            ), {}
        if mode == "timeout" and "CLAIM:" in prompt:
            raise TimeoutError("simulated timeout")
        if mode == "invalid" and "CLAIM:" in prompt:
            return "not-json{{{", {}
        if "CLAIM:" in prompt:
            claim = prompt.split("CLAIM:", 1)[1].strip().lower()
            if mode == "all_supported" or "total" in claim:
                return json.dumps(
                    {
                        "verdict": "supported",
                        "evidence_box": [10, 20, 30, 40],
                        "evidence_time_ms": None,
                        "explanation": "matches",
                    }
                ), {}
            if "wrong" in claim or "tax" in claim:
                return json.dumps(
                    {
                        "verdict": "contradicted",
                        "evidence_box": None,
                        "evidence_time_ms": None,
                        "explanation": "does not match receipt",
                    }
                ), {}
            return json.dumps(
                {
                    "verdict": "not_found",
                    "evidence_box": None,
                    "evidence_time_ms": None,
                    "explanation": "absent",
                }
            ), {}
        return json.dumps({"claims": []}), {}

    return judge, state


def test_registry_modalities():
    meta = ev.REGISTRY["cross_modal_judge"]
    assert meta["category"] == "model_judge"
    assert meta["dimension"] == "Cross-modal consistency"
    assert meta["needs_reference"] is False
    assert "image+audio" in meta["modalities"]
    assert "image+text" in meta["modalities"]
    assert "video+audio" in meta["modalities"]


def test_contradiction_and_supported():
    judge, _ = _judge_factory("mixed")
    meta = ev.REGISTRY["cross_modal_judge"]
    ev._CROSS_MODAL_JUDGE_CACHE.clear()
    case = {"id": "c1", "modality": "cross_modal", "claim_channel": "voice", "image": "x.jpg"}
    run = {"transcript": "The total is 148127 and the tax is wrong", "channel": "voice"}
    trace = {
        "media": [{"modality": "image", "path": "", "sha256": "abc"}],
        "spans": [
            {"id": "s1", "name": "attach receipt image"},
            {
                "id": "s3",
                "name": "transcribe voice",
                "attributes": {"turn": 1, "text": "The total is 148127 and the tax is wrong"},
            },
        ],
        "input": {"transcript": "The total is 148127 and the tax is wrong"},
    }
    # Provide fake image bytes via a temp file path
    res = ev._call(
        meta,
        agent="a",
        case_id="c1",
        variant="clean",
        case=case,
        run=run,
        trace=trace,
        judge_fn=judge,
        judge_model="muse-wonder-1.0",
    )
    assert res["status"] == "completed"
    assert res["label"] == "contradictions_found"
    assert res["score"] == pytest.approx(1 - 1 / 3)
    em = res["execution_metadata"]
    assert em["n_contradicted"] == 1
    assert em["n_supported"] >= 1
    assert any(e.get("role") == "contradicts" and e.get("judge_claimed") for e in res["evidence"])
    assert any(e.get("role") == "supports" and e.get("judge_claimed") for e in res["evidence"])
    assert em["claims"]


def test_supported_only():
    judge, _ = _judge_factory("all_supported")
    meta = ev.REGISTRY["cross_modal_judge"]
    ev._CROSS_MODAL_JUDGE_CACHE.clear()
    case = {"id": "c2", "modality": "cross_modal", "claim_channel": "text"}
    run = {"claim_text": "The total is 148127", "channel": "text"}
    trace = {
        "spans": [
            {"id": "s1", "name": "attach receipt image"},
            {"id": "s2", "name": "attach claim text", "attributes": {"text": "The total is 148127"}},
        ],
        "input": {"claim_text": "The total is 148127"},
        "media": [{"modality": "image", "sha256": "img1"}],
    }
    res = ev._call(
        meta,
        agent="a",
        case_id="c2",
        variant="clean",
        case=case,
        run=run,
        trace=trace,
        judge_fn=judge,
    )
    assert res["status"] == "completed"
    assert res["label"] == "consistent"
    assert res["score"] == pytest.approx(1.0)


def test_no_claims_inconclusive():
    judge, _ = _judge_factory("no_claims")
    meta = ev.REGISTRY["cross_modal_judge"]
    ev._CROSS_MODAL_JUDGE_CACHE.clear()
    res = ev._call(
        meta,
        agent="a",
        case_id="c3",
        variant="clean",
        case={"id": "c3", "modality": "cross_modal", "claim_channel": "text"},
        run={"claim_text": "hello"},
        trace={
            "spans": [
                {"id": "s1", "name": "attach receipt image"},
                {"id": "s2", "name": "attach claim text", "attributes": {"text": "hello"}},
            ],
            "input": {"claim_text": "hello"},
            "media": [{"modality": "image", "sha256": "z"}],
        },
        judge_fn=judge,
    )
    assert res["status"] == "inconclusive"
    assert res["label"] == "inconclusive"
    assert res["score"] is None


def test_invalid_json_continues():
    judge, _ = _judge_factory("invalid")
    meta = ev.REGISTRY["cross_modal_judge"]
    ev._CROSS_MODAL_JUDGE_CACHE.clear()
    res = ev._call(
        meta,
        agent="a",
        case_id="c4",
        variant="clean",
        case={"id": "c4", "modality": "cross_modal", "claim_channel": "voice"},
        run={"transcript": "total is 12"},
        trace={
            "spans": [
                {"id": "s1", "name": "attach receipt image"},
                {
                    "id": "s3",
                    "name": "transcribe voice",
                    "attributes": {"turn": 1, "text": "total is 12"},
                },
            ],
            "input": {"transcript": "total is 12"},
            "media": [{"modality": "image", "sha256": "q"}],
        },
        judge_fn=judge,
    )
    assert res["status"] == "inconclusive"  # all claims errored
    assert res["execution_metadata"]["n_error"] >= 1


def test_timeout_continues():
    judge, _ = _judge_factory("timeout")
    meta = ev.REGISTRY["cross_modal_judge"]
    ev._CROSS_MODAL_JUDGE_CACHE.clear()
    res = ev._call(
        meta,
        agent="a",
        case_id="c5",
        variant="clean",
        case={"id": "c5", "modality": "cross_modal", "claim_channel": "voice"},
        run={"transcript": "total is 12"},
        trace={
            "spans": [
                {"id": "s1", "name": "attach receipt image"},
                {
                    "id": "s3",
                    "name": "transcribe voice",
                    "attributes": {"turn": 1, "text": "total is 12"},
                },
            ],
            "input": {"transcript": "total is 12"},
            "media": [{"modality": "image", "sha256": "t"}],
        },
        judge_fn=judge,
    )
    assert res["status"] == "inconclusive"
    assert res["execution_metadata"]["n_error"] >= 1


def test_skips_single_modality_trace():
    out = run_builtin(
        "cross_modal_judge",
        {
            "id": "img-only",
            "agent": "a",
            "media": [{"modality": "image", "sha256": "1"}],
            "spans": [{"id": "s1", "name": "attach_image", "type": "media"}],
            "metadata": {"variant": "clean"},
        },
        expectation=None,
        judge_fn=_judge_factory("mixed")[0],
    )
    assert out["status"] == "skipped"
    assert "needs two modalities" in out["explanation"]


def test_playground_cross_check_image_audio(client):
    png = _png_bytes()
    wav = _wav_bytes()
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={
            "mode": "cross_check",
            "mock": "true",
            "judge_model": "muse-wonder-1.0",
            "evaluator_ids": "cross_modal_judge",
        },
        files=[
            ("files", ("receipt.png", png, "application/octet-stream")),
            ("files", ("claim.wav", wav, "application/octet-stream")),
        ],
    )
    assert r.status_code == 202, r.text
    detail = _poll(client, r.json()["run_id"])
    assert detail["status"] == "completed", detail.get("error")
    assert detail.get("mode") == "cross_check"
    tid = detail["trace_ids"][0]
    tr = client.get(f"/api/v1/traces/{tid}", headers=H()).json()
    names = [s["name"] for s in tr["spans"]]
    assert "attach receipt image" in names
    assert "attach voice clip" in names
    assert "transcribe voice" in names
    assert "evaluation" in names
    assert "model_call" not in names and "model call" not in names
    cmj = next(
        (x for x in detail["results"] if x.get("evaluator_id") == "cross_modal_judge"), None
    )
    assert cmj is not None, detail["results"]
    assert cmj["status"] in ("completed", "inconclusive", "skipped", "error")


def test_playground_cross_check_image_text(client):
    png = _png_bytes()
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={
            "mode": "cross_check",
            "mock": "true",
            "text": "The total on my receipt is 148,127 rupiah.",
            "evaluator_ids": "cross_modal_judge",
        },
        files=[("files", ("receipt.png", png, "image/png"))],
    )
    assert r.status_code == 202, r.text
    detail = _poll(client, r.json()["run_id"])
    assert detail["status"] == "completed", detail.get("error")
    cmj = next(
        (x for x in detail["results"] if x.get("evaluator_id") == "cross_modal_judge"), None
    )
    assert cmj is not None


def test_playground_cross_check_auth_and_limits(client):
    # Unauthorised
    r = client.post(
        "/api/v1/playground/runs",
        data={"mode": "cross_check", "mock": "true", "text": "hi"},
        files=[("files", ("a.png", _png_bytes(), "image/png"))],
    )
    assert r.status_code == 401

    # Missing audio/text
    r2 = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={"mode": "cross_check", "mock": "true"},
        files=[("files", ("a.png", _png_bytes(), "image/png"))],
    )
    assert r2.status_code == 400
    assert "audio" in r2.json()["error"]["message"].lower() or "text" in r2.json()["error"]["message"].lower()
