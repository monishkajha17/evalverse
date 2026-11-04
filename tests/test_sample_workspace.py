"""Onboarding sample workspace: seed, idempotency, isolation, hygiene."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalverse.server.app import create_app

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "data" / "sample_workspace"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EVALVERSE_SEED_ON_REGISTER", "true")
    app = create_app(
        db_path=tmp_path / "sw.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        allow_dev_key=True,
        start_workers=False,
    )
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client_no_seed(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EVALVERSE_SEED_ON_REGISTER", "false")
    app = create_app(
        db_path=tmp_path / "sw2.db",
        media_dir=tmp_path / "media2",
        api_key="dev",
        allow_dev_key=True,
        start_workers=False,
    )
    with TestClient(app) as c:
        yield c


def _register(client: TestClient, email: str, password: str = "password1"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "name": email.split("@")[0]},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _headers(reg: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {reg['api_key']}", "X-Project": reg["project"]}


def _as_list(payload):
    if isinstance(payload, list):
        return payload
    return payload.get("items") or payload.get("traces") or payload.get("sessions") or []


@pytest.mark.skipif(not (SAMPLE / "manifest.json").is_file(), reason="sample workspace not built")
def test_manifest_hygiene():
    text = (SAMPLE / "manifest.json").read_text().lower()
    assert "evk_" not in text
    assert "token" not in text
    assert "password" not in text


@pytest.mark.skipif(not (SAMPLE / "manifest.json").is_file(), reason="sample workspace not built")
def test_register_seeds_sample_data(client: TestClient):
    reg = _register(client, "seed-user@example.com")
    h = _headers(reg)
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {reg['token']}"})
    assert me.status_code == 200
    assert me.json()["has_sample_data"] is True

    items = _as_list(client.get("/api/v1/traces", headers=h).json())
    assert len(items) >= 1
    assert all("sample" in (t.get("tags") or []) for t in items)
    sess_items = _as_list(client.get("/api/v1/sessions", headers=h).json())
    assert any(str(s.get("session_id") or "").startswith("sample:") for s in sess_items)

    scores = client.get(
        "/api/v1/scores",
        headers=h,
        params={"run_id": f"import:sample:{reg['project']}", "profile": "balanced"},
    )
    assert scores.status_code == 200, scores.text


@pytest.mark.skipif(not (SAMPLE / "manifest.json").is_file(), reason="sample workspace not built")
def test_seed_idempotent(client_no_seed: TestClient):
    reg = _register(client_no_seed, "idem@example.com")
    h = _headers(reg)
    r1 = client_no_seed.post("/api/v1/onboarding/seed-demo", headers=h)
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["added"] >= 1
    assert body1["skipped"] == 0

    r2 = client_no_seed.post("/api/v1/onboarding/seed-demo", headers=h)
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["added"] == 0
    assert body2["skipped"] == body1["added"]

    items = _as_list(client_no_seed.get("/api/v1/traces", headers=h).json())
    assert len(items) == body1["added"]


@pytest.mark.skipif(not (SAMPLE / "manifest.json").is_file(), reason="sample workspace not built")
def test_delete_removes_only_sample(client_no_seed: TestClient):
    reg = _register(client_no_seed, "del@example.com")
    h = _headers(reg)
    # User-owned non-sample trace
    own = client_no_seed.post(
        "/api/v1/traces",
        headers=h,
        json={
            "id": "user-owned-1",
            "status": "completed",
            "source": "sdk",
            "tags": ["live"],
            "name": "mine",
        },
    )
    assert own.status_code == 200, own.text

    seeded = client_no_seed.post("/api/v1/onboarding/seed-demo", headers=h)
    assert seeded.status_code == 200
    assert seeded.json()["added"] >= 1

    deleted = client_no_seed.delete("/api/v1/onboarding/seed-demo", headers=h)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["removed"] >= 1

    items = _as_list(client_no_seed.get("/api/v1/traces", headers=h).json())
    ids = {t["id"] for t in items}
    assert ids == {"user-owned-1"}
    me = client_no_seed.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {reg['token']}"}
    )
    assert me.json()["has_sample_data"] is False


@pytest.mark.skipif(not (SAMPLE / "manifest.json").is_file(), reason="sample workspace not built")
def test_second_user_isolation(client: TestClient):
    a = _register(client, "iso-a@example.com")
    b = _register(client, "iso-b@example.com")
    ha = _headers(a)
    hb = _headers(b)

    a_items = _as_list(client.get("/api/v1/traces", headers=ha).json())
    b_items = _as_list(client.get("/api/v1/traces", headers=hb).json())
    a_ids = {t["id"] for t in a_items}
    b_ids = {t["id"] for t in b_items}
    assert a_ids
    assert b_ids
    assert a_ids.isdisjoint(b_ids)

    # B cannot fetch A's sample trace
    tid = next(iter(a_ids))
    r = client.get(f"/api/v1/traces/{tid}", headers=hb)
    assert r.status_code == 404


def test_seed_missing_pack_404(client_no_seed: TestClient, tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EVALVERSE_SAMPLE_WORKSPACE", str(tmp_path / "missing_pack"))
    reg = _register(client_no_seed, "nopack@example.com")
    h = _headers(reg)
    r = client_no_seed.post("/api/v1/onboarding/seed-demo", headers=h)
    assert r.status_code == 404
    detail = r.json()["error"]
    assert "sample" in json.dumps(detail).lower()


def test_register_succeeds_without_pack(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EVALVERSE_SEED_ON_REGISTER", "true")
    monkeypatch.setenv("EVALVERSE_SAMPLE_WORKSPACE", str(tmp_path / "no_such_pack"))
    app = create_app(
        db_path=tmp_path / "np.db",
        media_dir=tmp_path / "npm",
        api_key="dev",
        allow_dev_key=True,
        start_workers=False,
    )
    with TestClient(app) as client:
        reg = _register(client, "stillok@example.com")
        assert reg["token"]
        me = client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {reg['token']}"}
        )
        assert me.status_code == 200
        assert me.json()["has_sample_data"] is False
