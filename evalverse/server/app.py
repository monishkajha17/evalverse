"""FastAPI application for the EvalVerse platform core."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
import json as _json

from evalverse.providers.registry import list_providers
from evalverse.server.auth import AuthService
from evalverse.server.db import Database
from evalverse.server.otlp import ingest_otlp_json
from evalverse.server.schemas import (
    ApiKeyCreate,
    DatasetCreate,
    DatasetItemCreate,
    DatasetVersionCreate,
    EvaluationCreate,
    EvaluatorCreate,
    EvaluatorTestRequest,
    EvalResultIn,
    ExperimentCreate,
    ExperimentRunRequest,
    LoginRequest,
    PolicyCreate,
    PolicyUpdate,
    PromoteRequest,
    RegisterRequest,
    ReviewCreate,
    SpansCreate,
    TemporalEventsCreate,
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


def _allow_dev_key_default() -> bool:
    return os.environ.get("EVALVERSE_ALLOW_DEV_KEY", "true").lower() in ("1", "true", "yes", "on")


def create_app(
    db_path: str | Path | None = None,
    media_dir: str | Path | None = None,
    api_key: str | None = None,
    *,
    start_workers: bool = True,
    worker_size: int | None = None,
    allow_dev_key: bool | None = None,
) -> FastAPI:
    db = Database(db_path or os.environ.get("EVALVERSE_DB", str(DEFAULT_DB)))
    media = Path(media_dir or os.environ.get("EVALVERSE_MEDIA_DIR", str(DEFAULT_MEDIA)))
    expected_key = api_key if api_key is not None else _api_key()
    allow_dev = _allow_dev_key_default() if allow_dev_key is None else allow_dev_key
    svc = Service(db, media)
    pool = EvalWorkerPool(svc, size=worker_size)
    svc.worker = pool
    if start_workers:
        pool.start()
    accounts = AuthService(svc, allow_dev_key=allow_dev, dev_key=expected_key)

    app = FastAPI(title="EvalVerse", version="0.1.0")
    app.state.db = db
    app.state.service = svc
    app.state.api_key = expected_key
    app.state.media_dir = media
    app.state.worker = pool
    app.state.accounts = accounts
    app.state.allow_dev_key = allow_dev

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in os.environ.get("EVALVERSE_CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _bearer_token(authorization: Optional[str]) -> str:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
        return authorization.split(" ", 1)[1].strip()

    def auth(
        authorization: Optional[str] = Header(default=None),
        x_project: Optional[str] = Header(default=None, alias="X-Project"),
    ) -> tuple[str, str]:
        token = _bearer_token(authorization)
        ctx = accounts.resolve_bearer(token, x_project)
        return token, ctx.project

    def session_auth(
        authorization: Optional[str] = Header(default=None),
    ) -> tuple[str, str]:
        token = _bearer_token(authorization)
        ctx = accounts.require_session(token)
        return token, ctx.user_id  # type: ignore[return-value]

    def api_key_auth(
        authorization: Optional[str] = Header(default=None),
        x_project: Optional[str] = Header(default=None, alias="X-Project"),
    ) -> tuple[str, str]:
        token = _bearer_token(authorization)
        ctx = accounts.require_api_key(token, x_project)
        return token, ctx.project

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

    # ---- health ----
    @app.get("/api/v1/health")
    def health():
        return {"status": "ok"}

    # ---- auth (public: register / login) ----
    @app.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
    def register(body: RegisterRequest):
        return accounts.register(email=body.email, password=body.password, name=body.name)

    @app.post("/api/v1/auth/login")
    def login(body: LoginRequest, request: Request):
        ip = request.client.host if request.client else "unknown"
        return accounts.login(email=body.email, password=body.password, ip=ip)

    @app.post("/api/v1/auth/logout")
    def logout(ctx: tuple[str, str] = Depends(session_auth)):
        token, _ = ctx
        return accounts.logout(token)

    @app.get("/api/v1/auth/me")
    def auth_me(ctx: tuple[str, str] = Depends(session_auth)):
        _, user_id = ctx
        return accounts.me(user_id)

    @app.post("/api/v1/api-keys", status_code=status.HTTP_201_CREATED)
    def create_api_key(body: ApiKeyCreate, ctx: tuple[str, str] = Depends(session_auth)):
        _, user_id = ctx
        return accounts.create_api_key(user_id, name=body.name, project=body.project)

    @app.get("/api/v1/api-keys")
    def list_api_keys(ctx: tuple[str, str] = Depends(session_auth)):
        _, user_id = ctx
        return accounts.list_api_keys(user_id)

    @app.delete("/api/v1/api-keys/{key_id}")
    def revoke_api_key(key_id: str, ctx: tuple[str, str] = Depends(session_auth)):
        _, user_id = ctx
        return accounts.revoke_api_key(user_id, key_id)

    @app.get("/api/v1/projects")
    def list_projects(ctx: tuple[str, str] = Depends(session_auth)):
        _, user_id = ctx
        return accounts.list_projects(user_id)

    @app.post("/api/v1/onboarding/sample-trace")
    def onboarding_sample_trace(ctx: tuple[str, str] = Depends(api_key_auth)):
        _, project = ctx
        return accounts.create_sample_trace(project)

    # ---- traces / sessions / media ----
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

    @app.post("/api/v1/traces/{trace_id}/events")
    def add_events(trace_id: str, body: TemporalEventsCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.add_events(project, trace_id, body.events or [])

    @app.get("/api/v1/traces/{trace_id}/events")
    def list_trace_events(
        trace_id: str,
        source: Optional[str] = None,
        media_id: Optional[str] = None,
        from_ms: Optional[float] = None,
        to_ms: Optional[float] = None,
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        return svc.list_trace_events(
            project,
            trace_id,
            source=source,
            media_id=media_id,
            from_ms=from_ms,
            to_ms=to_ms,
        )

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

    @app.get("/api/v1/media/{media_id}/events")
    def list_media_events(media_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_media_events(project, media_id)

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

    # ---- OTLP receiver ----
    @app.post("/v1/traces")
    async def otlp_traces(
        request: Request,
        authorization: Optional[str] = Header(default=None),
        x_project: Optional[str] = Header(default=None, alias="X-Project"),
    ):
        # Auth (OTLP exporters often send Authorization / custom headers)
        token = _bearer_token(authorization)
        project = accounts.resolve_bearer(token, x_project).project

        ctype = (request.headers.get("content-type") or "").lower()
        body = await request.body()
        if "protobuf" in ctype or "application/x-protobuf" in ctype:
            try:
                from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
                    ExportTraceServiceRequest,
                )
            except ImportError as exc:
                raise HTTPException(
                    status_code=415,
                    detail=(
                        "OTLP protobuf received but opentelemetry-proto is not installed. "
                        "Send OTLP/HTTP JSON (Content-Type: application/json) or install "
                        "opentelemetry-exporter-otlp-proto-http / opentelemetry-proto."
                    ),
                ) from exc
            msg = ExportTraceServiceRequest()
            msg.ParseFromString(body)
            # Convert protobuf to JSON-like dict via MessageToDict (camelCase).
            from google.protobuf.json_format import MessageToDict

            payload = MessageToDict(msg, preserving_proto_field_name=False)
            return ingest_otlp_json(svc, project, payload)

        # JSON (default)
        import json as _json

        try:
            payload = _json.loads(body.decode("utf-8") if body else "{}")
        except Exception as exc:
            if body and body[:1] not in (b"{", b"["):
                raise HTTPException(
                    status_code=415,
                    detail=(
                        "Unable to parse body as OTLP/HTTP JSON. If you are sending protobuf, "
                        "set Content-Type to application/x-protobuf and ensure "
                        "opentelemetry-proto is installed."
                    ),
                ) from exc
            raise HTTPException(status_code=400, detail=f"Invalid OTLP JSON: {exc}") from exc
        return ingest_otlp_json(svc, project, payload)

    # ---- experiments ----
    @app.post("/api/v1/experiments")
    def create_experiment(body: ExperimentCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_experiment(project, body.model_dump(exclude_none=True))

    @app.get("/api/v1/experiments")
    def list_experiments(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.list_experiments(project)

    @app.get("/api/v1/experiments/{experiment_id}")
    def get_experiment(experiment_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_experiment(project, experiment_id)

    @app.post("/api/v1/experiments/{experiment_id}/runs")
    def run_experiment(
        experiment_id: str,
        body: ExperimentRunRequest | None = None,
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        mock = body.mock if body else None
        return svc.run_experiment(project, experiment_id, mock=mock)

    @app.get("/api/v1/experiments/{experiment_id}/compare")
    def compare_experiments(
        experiment_id: str,
        a: str = Query(...),
        b: str = Query(...),
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        return svc.compare_experiment_runs(project, experiment_id, a, b)

    # ---- reviews / calibration ----
    @app.post("/api/v1/reviews")
    def create_review(body: ReviewCreate, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.create_review(project, body.model_dump(exclude_none=True))

    @app.get("/api/v1/reviews/queue")
    def reviews_queue(ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.review_queue(project)

    @app.get("/api/v1/calibration")
    def calibration(evaluator_id: str = Query(...), ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.calibration(project, evaluator_id)

    # ---- playground (Try-it) ----
    @app.post("/api/v1/playground/runs", status_code=status.HTTP_202_ACCEPTED)
    async def playground_create_run(
        request: Request,
        question: str = Form(default=""),
        agent_model: Optional[str] = Form(default="muse-spark-1.3"),
        judge_model: Optional[str] = Form(default="muse-wonder-1.0"),
        mock: bool = Form(default=False),
        mode: str = Form(default="answer"),
        text: Optional[str] = Form(default=None),
        files: list[UploadFile] = File(default=[]),
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        form = await request.form()
        # Repeated form fields: evaluator_ids / conditions (and files[] aliases)
        eids: list[str] = []
        conds: list[str] = []
        upload_files: list[UploadFile] = list(files or [])
        for key, value in form.multi_items():
            if key in ("evaluator_ids", "evaluator_ids[]") and isinstance(value, str) and value.strip():
                eids.append(value.strip())
            elif key in ("conditions", "conditions[]") and isinstance(value, str) and value.strip():
                conds.append(value.strip())
            elif key in ("files", "files[]") and hasattr(value, "read"):
                # Already captured via File() when named "files"; also accept files[]
                if value not in upload_files:
                    upload_files.append(value)  # type: ignore[arg-type]
        # JSON-encoded list fallbacks
        for key, dest in (("evaluator_ids_json", eids), ("conditions_json", conds)):
            raw = form.get(key)
            if isinstance(raw, str) and raw.strip().startswith("["):
                try:
                    parsed = _json.loads(raw)
                    if isinstance(parsed, list):
                        dest.clear()
                        dest.extend(str(x) for x in parsed)
                except _json.JSONDecodeError:
                    pass
        claim_text = text
        if claim_text is None:
            for alt in ("claim_text", "claim"):
                raw = form.get(alt)
                if isinstance(raw, str) and raw.strip():
                    claim_text = raw
                    break
        return await svc.create_playground_run(
            project,
            files=upload_files,
            question=question or "",
            agent_model=agent_model,
            judge_model=judge_model,
            evaluator_ids=eids or None,
            conditions=conds or None,
            mock=mock,
            mode=mode or "answer",
            claim_text=claim_text,
        )

    @app.get("/api/v1/playground/runs/{run_id}")
    def playground_get_run(run_id: str, ctx: tuple[str, str] = Depends(auth)):
        _, project = ctx
        return svc.get_playground_run(project, run_id)

    # ---- providers ----
    @app.get("/api/v1/providers")
    def providers(ctx: tuple[str, str] = Depends(auth)):
        _ = ctx
        return list_providers()

    # ---- UMS scores ----
    @app.get("/api/v1/scores")
    def get_scores(
        run_id: Optional[str] = Query(default=None),
        experiment_id: Optional[str] = Query(default=None),
        suite: Optional[str] = Query(default=None),
        profile: str = Query(default="balanced"),
        ctx: tuple[str, str] = Depends(auth),
    ):
        _, project = ctx
        return svc.get_ums_scores(
            project,
            run_id=run_id,
            experiment_id=experiment_id,
            suite=suite,
            profile=profile,
        )

    return app


# Module-level app for `uvicorn evalverse.server.app:app`
app = create_app()
