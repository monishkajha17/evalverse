"""API server tests (FastAPI TestClient + temp SQLite)."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalverse.server.app import create_app


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "test.db",
        media_dir=tmp_path / "media",
        api_key="dev",
    )
    with TestClient(app) as c:
        yield c


def _auth(project: str = "default", key: str = "dev") -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "X-Project": project}


def test_health(client: TestClient):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_auth_required(client: TestClient):
    r = client.get("/api/v1/traces")
    assert r.status_code == 401
    r = client.get("/api/v1/traces", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_project_isolation(client: TestClient):
    body = {"id": "t-iso", "name": "a", "status": "completed", "source": "sdk"}
    assert client.post("/api/v1/traces", headers=_auth("p1"), json=body).status_code == 200
    assert client.get("/api/v1/traces/t-iso", headers=_auth("p1")).status_code == 200
    assert client.get("/api/v1/traces/t-iso", headers=_auth("p2")).status_code == 404
    listed = client.get("/api/v1/traces", headers=_auth("p2")).json()
    assert listed == []


def test_idempotent_trace_create(client: TestClient):
    body = {
        "id": "t-idem",
        "name": "once",
        "status": "completed",
        "source": "sdk",
        "spans": [{"id": "s1", "name": "root", "type": "custom", "status": "completed"}],
    }
    r1 = client.post("/api/v1/traces", headers=_auth(), json=body)
    r2 = client.post("/api/v1/traces", headers=_auth(), json=body)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"] == "t-idem"
    # Still a single span.
    assert len(r2.json()["spans"]) == 1


def test_cycle_rejection(client: TestClient):
    body = {
        "id": "t-cycle",
        "name": "cycle",
        "status": "completed",
        "source": "sdk",
        "spans": [
            {"id": "a", "name": "a", "type": "custom", "parent_ids": ["b"]},
            {"id": "b", "name": "b", "type": "custom", "parent_ids": ["a"]},
        ],
    }
    r = client.post("/api/v1/traces", headers=_auth(), json=body)
    assert r.status_code == 400


def test_unknown_parent_rejection(client: TestClient):
    body = {
        "id": "t-parent",
        "name": "bad-parent",
        "status": "completed",
        "source": "sdk",
        "spans": [
            {"id": "a", "name": "a", "type": "custom", "parent_ids": ["missing"]},
        ],
    }
    r = client.post("/api/v1/traces", headers=_auth(), json=body)
    assert r.status_code == 400


def test_media_dedupe(client: TestClient, tmp_path: Path):
    data = b"hello-image-bytes"
    files = {"file": ("a.png", io.BytesIO(data), "image/png")}
    form = {"modality": "image"}
    r1 = client.post("/api/v1/media", headers=_auth(), files=files, data=form)
    files2 = {"file": ("b.png", io.BytesIO(data), "image/png")}
    r2 = client.post("/api/v1/media", headers=_auth(), files=files2, data=form)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert r1.json()["sha256"] == r2.json()["sha256"]


def test_session_grouping(client: TestClient):
    for i, agent in enumerate(["a1", "a2"]):
        body = {
            "id": f"t-sess-{i}",
            "session_id": "sess-1",
            "agent": agent,
            "name": f"n{i}",
            "status": "completed" if i == 0 else "failed",
            "source": "sdk",
            "spans": [
                {
                    "id": f"tool-{i}",
                    "name": "t",
                    "type": "tool",
                    "status": "completed",
                }
            ],
        }
        assert client.post("/api/v1/traces", headers=_auth(), json=body).status_code == 200

    sessions = client.get("/api/v1/sessions", headers=_auth()).json()
    assert len(sessions) == 1
    s = sessions[0]
    assert s["session_id"] == "sess-1"
    assert s["trace_count"] == 2
    assert s["tool_call_count"] == 2
    assert set(s["agents"]) == {"a1", "a2"}
    assert s["error_count"] >= 1

    detail = client.get("/api/v1/sessions/sess-1", headers=_auth()).json()
    assert len(detail["traces"]) == 2


def test_trace_list_aggregates(client: TestClient):
    body = {
        "id": "t-agg",
        "name": "agg",
        "status": "completed",
        "source": "sdk",
        "spans": [
            {
                "id": "m1",
                "name": "model",
                "type": "model",
                "status": "completed",
                "latency_ms": 12.5,
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
            {
                "id": "t1",
                "name": "tool",
                "type": "tool",
                "status": "completed",
                "parent_ids": ["m1"],
            },
        ],
    }
    assert client.post("/api/v1/traces", headers=_auth(), json=body).status_code == 200
    rows = client.get("/api/v1/traces", headers=_auth()).json()
    row = next(x for x in rows if x["id"] == "t-agg")
    assert row["span_count"] == 2
    assert row["tool_call_count"] == 1
    assert row["input_tokens"] == 10
    assert row["output_tokens"] == 5
    assert row["latency_ms"] == 12.5


def test_media_size_limit(client: TestClient):
    big = b"x" * (10 * 1024 * 1024 + 1)
    files = {"file": ("big.bin", io.BytesIO(big), "application/octet-stream")}
    r = client.post("/api/v1/media", headers=_auth(), files=files, data={"modality": "image"})
    assert r.status_code == 400
