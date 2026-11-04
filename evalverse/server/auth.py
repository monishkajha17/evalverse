"""Local/self-hosted accounts, sessions, and API keys."""

from __future__ import annotations

import re
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from evalverse.server.crypto import (
    consteq,
    hash_password,
    hash_token,
    new_api_key,
    new_token,
    verify_password,
)

ROOT = Path(__file__).resolve().parent.parent.parent
SESSION_TTL = timedelta(days=30)
LOGIN_WINDOW_S = 300
LOGIN_MAX_FAILURES = 5
_INVALID_LOGIN = "Invalid email or password"
_DUMMY_PASSWORD_HASH = hash_password("__evalverse_login_pad__")

# prefix column stores "visible_prefix|last4"
_PREFIX_SEP = "|"

DEFAULT_SAMPLE_EVALUATORS = [
    "tool_schema_valid",
    "tool_args_correct",
    "tool_args_grounded",
    "tool_order_policy",
    "action_despite_abstention",
    "answer_correctness",
    "evidence_grounding",
    "stage_attribution",
]

# 1x1 PNG
_MIN_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _slug_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    local = re.sub(r"[^a-z0-9]+", "-", local.lower()).strip("-") or "user"
    local = local[:24]
    suffix = secrets.token_hex(2)  # 4 hex chars
    return f"{local}-{suffix}"


def _pack_prefix(prefix: str, last4: str) -> str:
    return f"{prefix}{_PREFIX_SEP}{last4}"


def _unpack_prefix(stored: str) -> tuple[str, str]:
    if _PREFIX_SEP in stored:
        p, last4 = stored.split(_PREFIX_SEP, 1)
        return p, last4
    return stored, stored[-4:] if len(stored) >= 4 else stored


@dataclass
class AuthContext:
    kind: str  # "dev" | "api_key" | "session"
    project: str
    user_id: str | None = None
    api_key_id: str | None = None
    projects: list[str] = field(default_factory=list)


class LoginThrottle:
    """In-memory failure counter: 5 failures / 5 minutes per email+IP."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}

    def _key(self, email: str, ip: str) -> str:
        return f"{normalize_email(email)}|{ip or 'unknown'}"

    def check(self, email: str, ip: str) -> None:
        key = self._key(email, ip)
        now = time.monotonic()
        with self._lock:
            stamps = [t for t in self._failures.get(key, []) if now - t < LOGIN_WINDOW_S]
            self._failures[key] = stamps
            if len(stamps) >= LOGIN_MAX_FAILURES:
                raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")

    def record_failure(self, email: str, ip: str) -> None:
        key = self._key(email, ip)
        now = time.monotonic()
        with self._lock:
            stamps = [t for t in self._failures.get(key, []) if now - t < LOGIN_WINDOW_S]
            stamps.append(now)
            self._failures[key] = stamps
            if len(stamps) >= LOGIN_MAX_FAILURES:
                raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")

    def clear(self, email: str, ip: str) -> None:
        key = self._key(email, ip)
        with self._lock:
            self._failures.pop(key, None)


class AuthService:
    def __init__(self, svc: Any, *, allow_dev_key: bool = True, dev_key: str = "dev"):
        self.svc = svc
        self.db = svc.db
        self.allow_dev_key = allow_dev_key
        self.dev_key = dev_key
        self.throttle = LoginThrottle()

    # ------------------------------------------------------------------ helpers
    def _user_out(self, row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "email": row["email"],
            "name": row["name"],
            "created_at": row["created_at"],
        }

    def _user_projects(self, user_id: str) -> list[dict[str, str]]:
        rows = self.db.fetchall(
            """SELECT project, role FROM project_members
               WHERE user_id = ? ORDER BY project ASC""",
            (user_id,),
        )
        return [{"name": r["project"], "role": r["role"]} for r in rows]

    def _user_project_names(self, user_id: str) -> list[str]:
        return [p["name"] for p in self._user_projects(user_id)]

    def _create_session(self, user_id: str) -> str:
        token = new_token()
        expires = (_now() + SESSION_TTL).isoformat()
        self.db.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hash_token(token), user_id, expires),
        )
        return token

    def _create_api_key_row(
        self, *, user_id: str, project: str, name: str
    ) -> tuple[str, dict[str, Any]]:
        raw, prefix, last4 = new_api_key()
        kid = str(uuid.uuid4())
        created = _now_iso()
        self.db.execute(
            """INSERT INTO api_keys
               (id, user_id, project, name, key_hash, prefix, created_at, last_used_at, revoked_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)""",
            (kid, user_id, project, name, hash_token(raw), _pack_prefix(prefix, last4), created),
        )
        return raw, {
            "id": kid,
            "name": name,
            "key": raw,
            "prefix": prefix,
            "project": project,
            "created_at": created,
        }

    def _api_key_public(self, row) -> dict[str, Any]:
        prefix, last4 = _unpack_prefix(row["prefix"])
        return {
            "id": row["id"],
            "name": row["name"],
            "project": row["project"],
            "prefix": prefix,
            "last4": last4,
            "created_at": row["created_at"],
            "last_used_at": row["last_used_at"],
            "revoked_at": row["revoked_at"],
        }

    # ------------------------------------------------------------------ register / login
    def register(self, *, email: str, password: str, name: str | None = None) -> dict[str, Any]:
        email_n = normalize_email(email)
        if not email_n or "@" not in email_n:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid email",
                    "details": [{"field": "email", "reason": "invalid"}],
                },
            )
        if len(password) < 8:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Password must be at least 8 characters",
                    "details": [{"field": "password", "reason": "min_length"}],
                },
            )
        existing = self.db.fetchone("SELECT id FROM users WHERE email = ?", (email_n,))
        if existing is not None:
            raise HTTPException(status_code=409, detail="Email already registered")

        user_id = str(uuid.uuid4())
        created = _now_iso()
        display = (name or "").strip() or email_n.split("@", 1)[0]
        pw_hash = hash_password(password)

        # Unique project slug
        project = _slug_from_email(email_n)
        for _ in range(8):
            if self.db.fetchone("SELECT name FROM projects WHERE name = ?", (project,)) is None:
                break
            project = _slug_from_email(email_n)
        else:
            project = f"user-{secrets.token_hex(4)}"

        self.svc.ensure_project(project)
        self.db.execute(
            """INSERT INTO users (id, email, name, password_hash, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, email_n, display, pw_hash, created),
        )
        self.db.execute(
            "INSERT INTO project_members (project, user_id, role) VALUES (?, ?, ?)",
            (project, user_id, "owner"),
        )
        token = self._create_session(user_id)
        raw_key, _meta = self._create_api_key_row(
            user_id=user_id, project=project, name="default"
        )
        # Optional onboarding seed — never fail registration if the pack is missing.
        from evalverse.sample_workspace import seed_demo, seed_on_register_enabled

        if seed_on_register_enabled():
            try:
                seed_demo(self.svc, project)
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
            except Exception:
                # Pack corrupt / partial — registration must still succeed.
                pass
        user_row = self.db.fetchone("SELECT * FROM users WHERE id = ?", (user_id,))
        return {
            "user": self._user_out(user_row),
            "token": token,
            "project": project,
            "api_key": raw_key,
        }

    def login(self, *, email: str, password: str, ip: str) -> dict[str, Any]:
        email_n = normalize_email(email)
        self.throttle.check(email_n, ip)
        row = self.db.fetchone("SELECT * FROM users WHERE email = ?", (email_n,))
        # Constant-time-ish: always verify against something
        if row is None:
            verify_password(password, _DUMMY_PASSWORD_HASH)
            try:
                self.throttle.record_failure(email_n, ip)
            except HTTPException:
                raise
            raise HTTPException(status_code=401, detail=_INVALID_LOGIN)
        if not verify_password(password, row["password_hash"]):
            try:
                self.throttle.record_failure(email_n, ip)
            except HTTPException:
                raise
            raise HTTPException(status_code=401, detail=_INVALID_LOGIN)
        self.throttle.clear(email_n, ip)
        token = self._create_session(row["id"])
        projects = self._user_project_names(row["id"])
        return {
            "user": self._user_out(row),
            "token": token,
            "projects": projects,
        }

    def logout(self, token: str) -> dict[str, str]:
        self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
        return {"status": "ok"}

    def me(self, user_id: str) -> dict[str, Any]:
        row = self.db.fetchone("SELECT * FROM users WHERE id = ?", (user_id,))
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid session")
        keys = self.db.fetchall(
            """SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL
               ORDER BY created_at DESC""",
            (user_id,),
        )
        from evalverse.sample_workspace import project_has_sample_data

        projects = self._user_projects(user_id)
        has_sample = False
        for p in projects:
            if project_has_sample_data(self.svc, p["name"]):
                has_sample = True
                break
        return {
            "user": self._user_out(row),
            "projects": projects,
            "api_keys": [
                {
                    "id": k["id"],
                    "name": k["name"],
                    "project": k["project"],
                    "prefix": _unpack_prefix(k["prefix"])[0],
                    "last4": _unpack_prefix(k["prefix"])[1],
                    "created_at": k["created_at"],
                    "last_used_at": k["last_used_at"],
                }
                for k in keys
            ],
            "has_sample_data": has_sample,
        }

    def seed_demo(self, project: str) -> dict[str, int]:
        from evalverse.sample_workspace import seed_demo

        return seed_demo(self.svc, project)

    def unseed_demo(self, project: str) -> dict[str, int]:
        from evalverse.sample_workspace import unseed_demo

        return unseed_demo(self.svc, project)

    # ------------------------------------------------------------------ api keys / projects
    def create_api_key(self, user_id: str, *, name: str, project: str) -> dict[str, Any]:
        name = (name or "").strip()
        if not name:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "name required",
                    "details": [{"field": "name", "reason": "required"}],
                },
            )
        membership = self.db.fetchone(
            "SELECT 1 FROM project_members WHERE project = ? AND user_id = ?",
            (project, user_id),
        )
        if membership is None:
            raise HTTPException(status_code=403, detail="Not a member of this project")
        raw, meta = self._create_api_key_row(user_id=user_id, project=project, name=name)
        return {"id": meta["id"], "name": meta["name"], "key": raw, "prefix": meta["prefix"]}

    def list_api_keys(self, user_id: str) -> list[dict[str, Any]]:
        rows = self.db.fetchall(
            """SELECT * FROM api_keys WHERE user_id = ?
               ORDER BY created_at DESC""",
            (user_id,),
        )
        return [self._api_key_public(r) for r in rows if r["revoked_at"] is None]

    def revoke_api_key(self, user_id: str, key_id: str) -> dict[str, str]:
        row = self.db.fetchone(
            "SELECT * FROM api_keys WHERE id = ? AND user_id = ?", (key_id, user_id)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="API key not found")
        if row["revoked_at"] is None:
            self.db.execute(
                "UPDATE api_keys SET revoked_at = ? WHERE id = ?",
                (_now_iso(), key_id),
            )
        return {"status": "ok"}

    def list_projects(self, user_id: str) -> list[dict[str, str]]:
        return self._user_projects(user_id)

    # ------------------------------------------------------------------ bearer resolve
    def resolve_bearer(self, token: str, x_project: str | None) -> AuthContext:
        if not token:
            raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

        # Dev key (local only)
        if self.allow_dev_key and consteq(token, self.dev_key):
            project = (x_project or "default").strip() or "default"
            return AuthContext(kind="dev", project=project)

        # API key
        if token.startswith("evk_"):
            row = self.db.fetchone(
                "SELECT * FROM api_keys WHERE key_hash = ?", (hash_token(token),)
            )
            if row is None or row["revoked_at"] is not None:
                raise HTTPException(status_code=401, detail="Invalid API key")
            key_project = row["project"]
            requested = (x_project or "").strip()
            if requested and requested != key_project:
                raise HTTPException(status_code=403, detail="API key is not valid for this project")
            self.db.execute(
                "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
                (_now_iso(), row["id"]),
            )
            return AuthContext(
                kind="api_key",
                project=key_project,
                user_id=row["user_id"],
                api_key_id=row["id"],
                projects=[key_project],
            )

        # Session token
        sess = self.db.fetchone(
            "SELECT * FROM sessions WHERE token_hash = ?", (hash_token(token),)
        )
        if sess is None:
            raise HTTPException(status_code=401, detail="Invalid API key")
        try:
            if _parse_iso(sess["expires_at"]) < _now():
                self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (sess["token_hash"],))
                raise HTTPException(status_code=401, detail="Session expired")
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid API key") from None

        projects = self._user_project_names(sess["user_id"])
        requested = (x_project or "").strip()
        if requested:
            if requested not in projects:
                raise HTTPException(status_code=403, detail="Not a member of this project")
            project = requested
        else:
            project = projects[0] if projects else "default"
        return AuthContext(
            kind="session",
            project=project,
            user_id=sess["user_id"],
            projects=projects,
        )

    def require_session(self, token: str) -> AuthContext:
        ctx = self.resolve_bearer(token, None)
        if ctx.kind != "session" or not ctx.user_id:
            raise HTTPException(status_code=401, detail="Session required")
        return ctx

    def require_api_key(self, token: str, x_project: str | None) -> AuthContext:
        ctx = self.resolve_bearer(token, x_project)
        if ctx.kind != "api_key":
            raise HTTPException(status_code=401, detail="API key required")
        return ctx

    # ------------------------------------------------------------------ onboarding
    def create_sample_trace(self, project: str) -> dict[str, str]:
        from evalverse.server.schemas import MediaAttach, SpanIn, TraceCreate, TraceStatus

        case_path = ROOT / "data" / "cases_cord.json"
        image_path = ROOT / "data" / "images_cord" / "cord_total_01.jpg"
        answer = "148,127"
        truth_box = [170, 965, 819, 995]
        case_id = "cord_total_01"
        question = "What is the total amount due on this receipt? Answer with the number only."

        if case_path.is_file():
            import json

            try:
                cases = json.loads(case_path.read_text())
                if cases:
                    c0 = cases[0]
                    answer = str(c0.get("answer") or answer)
                    truth_box = list(c0.get("truth_box") or truth_box)
                    case_id = str(c0.get("id") or case_id)
                    question = str(c0.get("question") or question)
                    img_rel = c0.get("image")
                    if img_rel:
                        candidate = ROOT / img_rel
                        if candidate.is_file():
                            image_path = candidate
            except (OSError, ValueError, TypeError):
                pass

        if image_path.is_file():
            data = image_path.read_bytes()
            mime = "image/jpeg" if image_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
            filename = image_path.name
        else:
            data = _MIN_PNG
            mime = "image/png"
            filename = "sample.png"

        media = self.svc.register_media_bytes(
            project=project,
            data=data,
            modality="image",
            filename=filename,
            mime=mime,
        )

        expectation = {
            "answer": answer,
            "answer_type": "number",
            "truth_box": truth_box,
            "case_id": case_id,
            "variant": "clean",
        }
        tool_amount = answer
        body = TraceCreate(
            name="sample-receipt",
            agent="onboarding",
            status=TraceStatus.completed,
            source="sdk",
            tags=["sample", "onboarding", "live"],
            input={"question": question},
            output={"answer": answer},
            metadata={
                "expectation": expectation,
                "variant": "clean",
                "case_id": case_id,
                "onboarding": True,
            },
            spans=[
                SpanIn(
                    id="model-1",
                    name="extract_total",
                    type="model",
                    status="completed",
                    model="sample",
                    output={"answer": answer, "box": truth_box, "evidence": "total line"},
                    latency_ms=120,
                ),
                SpanIn(
                    id="tool-1",
                    name="check_duplicate",
                    type="tool",
                    status="completed",
                    parent_ids=["model-1"],
                    input={"amount": tool_amount},
                    output={"duplicate": False, "amount": tool_amount},
                    latency_ms=5,
                ),
                SpanIn(
                    id="tool-2",
                    name="log_expense",
                    type="tool",
                    status="completed",
                    parent_ids=["tool-1"],
                    input={"amount": tool_amount, "currency": "IDR", "category": "meals"},
                    output={"ok": True, "logged": {"amount": tool_amount}},
                    latency_ms=5,
                ),
            ],
            media=[MediaAttach(media_id=media.id, role="input", span_id="model-1")],
        )
        detail = self.svc.create_trace(project, body)
        # Run default evaluators so Studio is not empty
        try:
            self.svc.create_evaluation(
                project,
                trace_ids=[detail.id],
                evaluator_ids=list(DEFAULT_SAMPLE_EVALUATORS),
            )
        except HTTPException:
            # If some evaluators are missing from registry, try a minimal set
            available = {e["id"] for e in self.svc.list_evaluators(project)}
            ids = [e for e in DEFAULT_SAMPLE_EVALUATORS if e in available]
            if not ids:
                ids = [e for e in ("answer_correctness", "tool_schema_valid") if e in available]
            if ids:
                self.svc.create_evaluation(project, trace_ids=[detail.id], evaluator_ids=ids)
        return {"trace_id": detail.id}
