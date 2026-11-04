"""Accounts, API keys, project isolation, and onboarding sample-trace."""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalverse.server.app import create_app


@pytest.fixture()
def client(tmp_path: Path):
    app = create_app(
        db_path=tmp_path / "auth.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        allow_dev_key=True,
    )
    with TestClient(app) as c:
        yield c


def _register(client: TestClient, email: str = "alice@example.com", password: str = "password1", name: str = "Alice"):
    r = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "name": name},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_register_login_logout_me(client: TestClient):
    reg = _register(client)
    assert reg["user"]["email"] == "alice@example.com"
    assert reg["token"]
    assert reg["project"]
    assert reg["api_key"].startswith("evk_")
    project = reg["project"]
    session = reg["token"]

    # me
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {session}"})
    assert me.status_code == 200
    body = me.json()
    assert body["user"]["email"] == "alice@example.com"
    assert any(p["name"] == project for p in body["projects"])
    assert body["api_keys"]
    assert "key" not in body["api_keys"][0]
    assert "last4" in body["api_keys"][0]
    assert body["api_keys"][0]["prefix"].startswith("evk_")

    # login
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "Alice@Example.com", "password": "password1"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["email"] == "alice@example.com"
    assert project in login.json()["projects"]
    token2 = login.json()["token"]

    # logout
    assert client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token2}"}).status_code == 200
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token2}"}).status_code == 401


def test_duplicate_email_and_bad_input(client: TestClient):
    _register(client, email="bob@example.com")
    r = client.post(
        "/api/v1/auth/register",
        json={"email": "BOB@example.com", "password": "password1"},
    )
    assert r.status_code == 409

    short = client.post(
        "/api/v1/auth/register",
        json={"email": "short@example.com", "password": "short"},
    )
    assert short.status_code == 422


def test_login_wrong_credentials_identical_message(client: TestClient):
    _register(client, email="carol@example.com")
    a = client.post("/api/v1/auth/login", json={"email": "carol@example.com", "password": "wrongpass"})
    b = client.post("/api/v1/auth/login", json={"email": "missing@example.com", "password": "password1"})
    assert a.status_code == 401 and b.status_code == 401
    assert a.json()["error"]["message"] == b.json()["error"]["message"]


def test_login_throttle(client: TestClient):
    _register(client, email="dave@example.com")
    msgs = []
    for i in range(6):
        r = client.post(
            "/api/v1/auth/login",
            json={"email": "dave@example.com", "password": "bad-password"},
        )
        msgs.append(r.status_code)
    assert 429 in msgs
    assert msgs[-1] == 429


def test_api_key_shown_once_and_revoke(client: TestClient):
    reg = _register(client, email="eve@example.com")
    session = reg["token"]
    project = reg["project"]
    first_key = reg["api_key"]

    # Full key never appears again on list / me
    keys = client.get("/api/v1/api-keys", headers={"Authorization": f"Bearer {session}"}).json()
    assert all("key" not in k or k.get("key") is None for k in keys)
    assert all(first_key not in str(k) for k in keys)

    created = client.post(
        "/api/v1/api-keys",
        headers={"Authorization": f"Bearer {session}"},
        json={"name": "ci", "project": project},
    )
    assert created.status_code == 201
    raw = created.json()["key"]
    assert raw.startswith("evk_")
    kid = created.json()["id"]

    # Works
    h = {"Authorization": f"Bearer {raw}", "X-Project": project}
    assert client.get("/api/v1/traces", headers=h).status_code == 200

    # Revoke
    assert client.delete(f"/api/v1/api-keys/{kid}", headers={"Authorization": f"Bearer {session}"}).status_code == 200
    assert client.get("/api/v1/traces", headers=h).status_code == 401


def test_cross_project_api_key_forbidden(client: TestClient):
    a = _register(client, email="a@example.com")
    b = _register(client, email="b@example.com")
    h = {"Authorization": f"Bearer {a['api_key']}", "X-Project": b["project"]}
    r = client.get("/api/v1/traces", headers=h)
    assert r.status_code == 403


def test_users_cannot_read_each_others_traces(client: TestClient):
    a = _register(client, email="u1@example.com")
    b = _register(client, email="u2@example.com")
    ha = {"Authorization": f"Bearer {a['api_key']}", "X-Project": a["project"]}
    hb = {"Authorization": f"Bearer {b['api_key']}", "X-Project": b["project"]}

    body = {"id": "secret-trace", "name": "private", "status": "completed", "source": "sdk"}
    assert client.post("/api/v1/traces", headers=ha, json=body).status_code == 200
    assert client.get("/api/v1/traces/secret-trace", headers=ha).status_code == 200
    assert client.get("/api/v1/traces/secret-trace", headers=hb).status_code == 404
    # Session of B cannot select A's project
    sess_b = b["token"]
    r = client.get(
        "/api/v1/traces/secret-trace",
        headers={"Authorization": f"Bearer {sess_b}", "X-Project": a["project"]},
    )
    assert r.status_code == 403


def test_sample_trace_creates_evaluations(client: TestClient):
    reg = _register(client, email="sample@example.com")
    h = {"Authorization": f"Bearer {reg['api_key']}", "X-Project": reg["project"]}
    r = client.post("/api/v1/onboarding/sample-trace", headers=h)
    assert r.status_code == 200, r.text
    tid = r.json()["trace_id"]
    detail = None
    for _ in range(120):
        detail = client.get(f"/api/v1/traces/{tid}", headers=h).json()
        if detail.get("results"):
            break
        time.sleep(0.05)
    assert detail is not None
    assert detail["id"] == tid
    assert detail["media"]
    assert any(s["type"] == "model" for s in detail["spans"])
    assert sum(1 for s in detail["spans"] if s["type"] == "tool") >= 2
    assert detail["results"], "expected evaluation results on sample trace"


def test_dev_key_still_works(client: TestClient):
    h = {"Authorization": "Bearer dev", "X-Project": "default"}
    r = client.post(
        "/api/v1/traces",
        headers=h,
        json={"id": "dev-t", "status": "completed", "source": "sdk"},
    )
    assert r.status_code == 200
