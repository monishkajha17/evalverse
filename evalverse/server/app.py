"""FastAPI application for the EvalVerse platform core."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

from evalverse.server.db import Database
from evalverse.server.schemas import (
    DatasetCreate,
    DatasetItemCreate,
    DatasetVersionCreate,
    EvaluationCreate,
    EvaluatorCreate,
    EvaluatorTestRequest,
    EvalResultIn,
    PolicyCreate,
    PolicyUpdate,
    PromoteRequest,
    SpansCreate,
    TraceCreate,
    TracePatch,
)
from evalverse.server.service import Service
from evalverse.server.worker import EvalWorkerPool

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = ROOT / "out" / "evalverse.db"
DEFAULT_MEDIA = ROOT / "out" / "media"


def _api_key() -> str:
    return os.environ.get("EVALVERSE_API_KEY", "dev")


def create_app(
    db_path: str | Path | None = None,
    media_dir: str | Path | None = None,
    api_key: str | None = None,
    *,
    start_workers: bool = True,
    worker_size: int | None = None,
) -> FastAPI:
    db = Database(db_path or os.environ.get("EVALVERSE_DB", str(DEFAULT_DB)))
    media = Path(media_dir or os.environ.get("EVALVERSE_MEDIA_DIR", str(DEFAULT_MEDIA)))
    expected_key = api_key if api_key is not None else _api_key()
    svc = Service(db, media)
    pool = EvalWorkerPool(svc, size=worker_size)
    svc.worker = pool
    if start_workers:
        pool.start()

    app = FastAPI(title="EvalVerse", version="0.1.0")
    app.state.db = db
    app.state.service = svc
    app.state.api_key = expected_key
    app.state.media_dir = media
    app.state.worker = pool

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

    @app.on_event("shutdown")
    def _shutdown():
        pool.stop()

    # ---- health / traces / sessions / media (unchanged surface) ----
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

    @app.post("/api/v1/traces/{trace_id}/promote")
    def promote_trace(trace_id: str, body: PromoteRequest, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        exp = body.expectation
        if hasattr(exp, "model_dump"):
            exp = exp.model_dump(exclude_none=True)
        return svc.promote_trace(project, trace_id, body.dataset_id, expectation=exp, tags=body.tags)

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

    # ---- datasets ----
    @app.post("/api/v1/datasets")
    def create_dataset(body: DatasetCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_dataset(project, body.name, body.description, body.metadata)

    @app.get("/api/v1/datasets")
    def list_datasets(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_datasets(project)

    @app.get("/api/v1/datasets/{dataset_id}")
    def get_dataset(dataset_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_dataset(project, dataset_id)

    @app.post("/api/v1/datasets/{dataset_id}/versions")
    def create_version(dataset_id: str, body: DatasetVersionCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_dataset_version(project, dataset_id, body.version, body.metadata)

    @app.post("/api/v1/datasets/{dataset_id}/items")
    def add_item(dataset_id: str, body: DatasetItemCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        exp = body.expectation
        if hasattr(exp, "model_dump"):
            exp = exp.model_dump(exclude_none=True)
        return svc.add_dataset_item(
            project,
            dataset_id,
            input=body.input,
            expectation=exp,
            tags=body.tags,
            metadata=body.metadata,
            version_id=body.version_id,
        )

    @app.get("/api/v1/datasets/{dataset_id}/items")
    def list_items(
        dataset_id: str,
        version_id: Optional[str] = None,
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        return svc.list_dataset_items(project, dataset_id, version_id=version_id)

    @app.get("/api/v1/datasets/{dataset_id}/export")
    def export_dataset(
        dataset_id: str,
        version_id: Optional[str] = None,
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        text = svc.export_dataset_jsonl(project, dataset_id, version_id=version_id)
        return PlainTextResponse(text, media_type="application/x-ndjson")

    @app.post("/api/v1/datasets/{dataset_id}/import")
    async def import_dataset(
        dataset_id: str,
        request: Request,
        version_id: Optional[str] = None,
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        text = (await request.body()).decode("utf-8")
        return svc.import_dataset_jsonl(project, dataset_id, text, version_id=version_id)

    # ---- evaluators ----
    @app.get("/api/v1/evaluators")
    def list_evaluators(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_evaluators(project)

    @app.post("/api/v1/evaluators")
    def create_evaluator(body: EvaluatorCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_evaluator(project, body.model_dump(exclude_none=True))

    @app.put("/api/v1/evaluators/{evaluator_id}")
    def put_evaluator(evaluator_id: str, body: EvaluatorCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.put_evaluator_version(project, evaluator_id, body.model_dump(exclude_none=True))

    @app.get("/api/v1/evaluators/{evaluator_id}")
    def get_evaluator(evaluator_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_evaluator(project, evaluator_id)

    @app.post("/api/v1/evaluators/{evaluator_id}/test")
    def test_evaluator(
        evaluator_id: str, body: EvaluatorTestRequest, ctx: tuple[str, str] = Depends(auth)
    ):
        _, project = ctx
        return svc.test_evaluator(project, evaluator_id, body.trace_id)

    # ---- evaluations ----
    @app.post("/api/v1/evaluations")
    def create_evaluation(body: EvaluationCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_evaluation(
            project,
            trace_ids=body.trace_ids,
            filter=body.filter,
            evaluator_ids=body.evaluator_ids,
            dataset_item_id=body.dataset_item_id,
            dataset_version_id=body.dataset_version_id,
        )

    @app.get("/api/v1/evaluations/{run_id}")
    def get_evaluation(run_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_evaluation(project, run_id)

    # ---- policies / alerts / queue ----
    @app.post("/api/v1/policies")
    def create_policy(body: PolicyCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_policy(project, body.model_dump(exclude_none=True))

    @app.get("/api/v1/policies")
    def list_policies(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_policies(project)

    @app.put("/api/v1/policies/{policy_id}")
    def update_policy(policy_id: str, body: PolicyUpdate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.update_policy(project, policy_id, body.model_dump(exclude_none=True))

    @app.get("/api/v1/alerts")
    def list_alerts(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_alerts(project)

    @app.get("/api/v1/queue")
    def get_queue(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.queue_stats(project)

    return app


# Module-level app for `uvicorn evalverse.server.app:app`
app = create_app()
