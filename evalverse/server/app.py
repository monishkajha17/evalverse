"""FastAPI application for the EvalVerse platform core."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from evalverse.server.db import Database
from evalverse.server.schemas import EvalResultIn, SpansCreate, TraceCreate, TracePatch
from evalverse.server.service import Service

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = ROOT / "out" / "evalverse.db"
DEFAULT_MEDIA = ROOT / "out" / "media"


def _api_key() -> str:
    return os.environ.get("EVALVERSE_API_KEY", "dev")


def create_app(
    db_path: str | Path | None = None,
    media_dir: str | Path | None = None,
    api_key: str | None = None,
) -> FastAPI:
    db = Database(db_path or os.environ.get("EVALVERSE_DB", str(DEFAULT_DB)))
    media = Path(media_dir or os.environ.get("EVALVERSE_MEDIA_DIR", str(DEFAULT_MEDIA)))
    expected_key = api_key if api_key is not None else _api_key()
    svc = Service(db, media)

    app = FastAPI(title="EvalVerse", version="0.1.0")
    app.state.db = db
    app.state.service = svc
    app.state.api_key = expected_key
    app.state.media_dir = media

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def auth(
        authorization: Optional[str] = Header(default=None),
        x_project: Optional[str] = Header(default=None, alias="X-Project"),
    ) -> tuple[str, str]:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
        token = authorization.split(" ", 1)[1].strip()
        if token != app.state.api_key:
            raise HTTPException(status_code=401, detail="Invalid API key")
        project = (x_project or "default").strip() or "default"
        return token, project

    @app.exception_handler(HTTPException)
    async def http_exc_handler(_request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict) and "code" in detail:
            return JSONResponse(status_code=exc.status_code, content={"error": detail})
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": "HTTP_ERROR", "message": str(detail), "details": []}},
        )

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/v1/traces")
    def create_trace(body: TraceCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_trace(project, body)

    @app.patch("/api/v1/traces/{trace_id}")
    def patch_trace(trace_id: str, body: TracePatch, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.patch_trace(project, trace_id, body)

    @app.post("/api/v1/traces/{trace_id}/spans")
    def add_spans(trace_id: str, body: SpansCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.add_spans(project, trace_id, body.spans or [])

    @app.get("/api/v1/traces")
    def list_traces(
        session_id: Optional[str] = None,
        agent: Optional[str] = None,
        status: Optional[str] = None,
        source: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = Query(default=50, ge=1, le=1000),
        offset: int = Query(default=0, ge=0),
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        return svc.list_traces(
            project,
            session_id=session_id,
            agent=agent,
            status=status,
            source=source,
            q=q,
            limit=limit,
            offset=offset,
        )

    @app.get("/api/v1/traces/{trace_id}")
    def get_trace(trace_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_trace(project, trace_id)

    @app.get("/api/v1/sessions")
    def list_sessions(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_sessions(project)

    @app.get("/api/v1/sessions/{session_id}")
    def get_session(session_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_session(project, session_id)

    @app.post("/api/v1/media")
    async def upload_media(
        file: UploadFile = File(...),
        modality: str = Form(...),
        parent_id: Optional[str] = Form(default=None),
        transformation: Optional[str] = Form(default=None),
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        return await svc.upload_media(
            project,
            file,
            modality=modality,
            parent_id=parent_id,
            transformation=transformation,
        )

    @app.get("/api/v1/media/{media_id}/file")
    def get_media_file(media_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        path, mime = svc.get_media_file(project, media_id)
        return FileResponse(path, media_type=mime, filename=path.name)

    @app.post("/api/v1/eval_results")
    def upsert_eval_result(body: EvalResultIn, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        before = svc.db.fetchone("SELECT id FROM eval_results WHERE id = ?", (body.id,))
        svc.upsert_eval_result(
            project=project,
            run_id=body.run_id,
            result_id=body.id,
            trace_id=body.trace_id,
            evaluator_id=body.evaluator_id,
            evaluator_version=body.evaluator_version,
            dimension=body.dimension,
            status=body.status,
            score=body.score,
            verdict=body.verdict,
            label=body.label,
            explanation=body.explanation,
            evidence=body.evidence,
            meta=body.meta,
        )
        return {"id": body.id, "created": before is None}

    return app


# Module-level app for `uvicorn evalverse.server.app:app`
app = create_app()
