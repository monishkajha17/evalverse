"""Application services for traces, spans, media and sessions."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, UploadFile

from evalverse.server.db import Database
from evalverse.server.platform import PlatformMixin
from evalverse.server.schemas import (
    EvalResultOut,
    MediaAttach,
    MediaOut,
    ScoreSummary,
    SessionDetail,
    SessionSummary,
    SpanIn,
    SpanOut,
    SpanStatus,
    SpanType,
    TraceCreate,
    TraceDetail,
    TraceListItem,
    TracePatch,
    TraceSource,
    TraceStatus,
)

MAX_MEDIA_BYTES = 10 * 1024 * 1024
VALID_TRACE_STATUS = {s.value for s in TraceStatus}
VALID_SPAN_TYPE = {s.value for s in SpanType}
VALID_SPAN_STATUS = {s.value for s in SpanStatus}
VALID_SOURCE = {"sdk", "otlp", "import"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dumps(obj: Any) -> str | None:
    if obj is None:
        return None
    return json.dumps(obj)


def _loads(raw: str | None, default: Any = None) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _source_value(source: TraceSource | str) -> str:
    if isinstance(source, TraceSource):
        return "import" if source is TraceSource.import_ else source.value
    return str(source)


def _validate_span_graph(spans: list[SpanIn], existing_ids: set[str] | None = None) -> None:
    """Ensure parent ids exist in the same trace and the graph is acyclic."""
    ids = set(existing_ids or ())
    for sp in spans:
        if sp.id:
            if sp.id in ids:
                # Allow re-post of same span id during upsert paths; parents checked below.
                pass
            ids.add(sp.id)

    # Assign provisional ids for validation if missing — parents must reference known ids.
    named = {sp.id for sp in spans if sp.id}
    all_ids = set(existing_ids or ()) | named

    for sp in spans:
        for pid in sp.parent_ids or []:
            if pid not in all_ids:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "VALIDATION_ERROR",
                        "message": f"Parent span '{pid}' does not exist in this trace.",
                        "details": [{"field": "parent_ids", "reason": "unknown parent"}],
                    },
                )

    # Build adjacency for cycle detection over the combined graph.
    children: dict[str, list[str]] = {sid: [] for sid in all_ids}
    indegree: dict[str, int] = {sid: 0 for sid in all_ids}
    for sp in spans:
        if not sp.id:
            continue
        for pid in sp.parent_ids or []:
            children.setdefault(pid, []).append(sp.id)
            indegree[sp.id] = indegree.get(sp.id, 0) + 1
            indegree.setdefault(pid, indegree.get(pid, 0))

    # Also include existing parent edges if provided via existing_edges? For create we only
    # validate the submitted batch against itself + existing ids. When adding spans, callers
    # pass existing edges through `existing_parent_map`.
    # Cycle check via Kahn.
    queue = [sid for sid, d in indegree.items() if d == 0]
    seen = 0
    while queue:
        n = queue.pop()
        seen += 1
        for c in children.get(n, []):
            indegree[c] -= 1
            if indegree[c] == 0:
                queue.append(c)
    if all_ids and seen != len(all_ids):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Span parent graph must be acyclic.",
                "details": [{"field": "parent_ids", "reason": "cycle detected"}],
            },
        )


def _validate_span_graph_with_existing(
    new_spans: list[SpanIn],
    existing: list[dict[str, Any]],
) -> None:
    existing_ids = {e["id"] for e in existing}
    # Merge for cycle detection.
    merged: list[SpanIn] = []
    for e in existing:
        merged.append(
            SpanIn(
                id=e["id"],
                parent_ids=_loads(e.get("parent_ids_json"), []) or [],
                type=e.get("type") or "custom",
                name=e.get("name") or e["id"],
                status=e.get("status") or "completed",
            )
        )
    # Replace or append new spans.
    by_id = {s.id: s for s in merged if s.id}
    for sp in new_spans:
        if sp.id and sp.id in by_id:
            by_id[sp.id] = sp
        elif sp.id:
            by_id[sp.id] = sp
        else:
            # temporary id only for graph check
            tmp = sp.model_copy(update={"id": f"__tmp_{uuid.uuid4().hex}"})
            by_id[tmp.id] = tmp
    _validate_span_graph(list(by_id.values()), existing_ids=set(by_id.keys()))


class Service(PlatformMixin):
    def __init__(self, db: Database, media_dir: Path):
        self.db = db
        self.media_dir = Path(media_dir)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.worker = None  # set by create_app

    # ------------------------------------------------------------------ projects
    def ensure_project(self, name: str) -> str:
        row = self.db.fetchone("SELECT name FROM projects WHERE name = ?", (name,))
        if row is None:
            self.db.execute(
                "INSERT INTO projects (name, description, created_at) VALUES (?, ?, ?)",
                (name, None, _now()),
            )
        return name

    # ------------------------------------------------------------------ media
    def register_media_bytes(
        self,
        project: str,
        data: bytes,
        modality: str,
        filename: str | None = None,
        mime: str | None = None,
        parent_id: str | None = None,
        transformation: Any = None,
        media_id: str | None = None,
    ) -> MediaOut:
        if len(data) > MAX_MEDIA_BYTES:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": f"Media exceeds {MAX_MEDIA_BYTES} byte limit.",
                    "details": [{"field": "file", "reason": "too large"}],
                },
            )
        self.ensure_project(project)
        sha = hashlib.sha256(data).hexdigest()
        existing = self.db.fetchone(
            "SELECT * FROM media WHERE project = ? AND sha256 = ?", (project, sha)
        )
        if existing is not None:
            return self._media_row(existing, created=False)

        mid = media_id or sha[:16]
        # Collision on id (different sha) — regenerate.
        while self.db.fetchone("SELECT id FROM media WHERE id = ?", (mid,)):
            mid = uuid.uuid4().hex[:16]

        ext = ""
        if filename and "." in filename:
            ext = Path(filename).suffix
        elif mime:
            guess = mimetypes.guess_extension(mime) or ""
            ext = guess
        rel = f"{project}/{mid}{ext}"
        dest = self.media_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

        if not mime:
            mime = mimetypes.guess_type(str(dest))[0] or "application/octet-stream"

        created = _now()
        self.db.execute(
            """INSERT INTO media
               (id, project, sha256, path, mime, size, modality, parent_id, transformation_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                mid,
                project,
                sha,
                str(dest),
                mime,
                len(data),
                modality,
                parent_id,
                _dumps(transformation),
                created,
            ),
        )
        row = self.db.fetchone("SELECT * FROM media WHERE id = ?", (mid,))
        assert row is not None
        return self._media_row(row)

    async def upload_media(
        self,
        project: str,
        file: UploadFile,
        modality: str,
        parent_id: str | None = None,
        transformation: str | None = None,
    ) -> MediaOut:
        data = await file.read()
        xf: Any = None
        if transformation:
            try:
                xf = json.loads(transformation)
            except json.JSONDecodeError:
                xf = transformation
        return self.register_media_bytes(
            project=project,
            data=data,
            modality=modality,
            filename=file.filename,
            mime=file.content_type,
            parent_id=parent_id,
            transformation=xf,
        )

    def get_media_file(self, project: str, media_id: str) -> tuple[Path, str]:
        row = self.db.fetchone(
            "SELECT * FROM media WHERE id = ? AND project = ?", (media_id, project)
        )
        if row is None:
            # Also allow cross-lookup by id alone within project scope failures -> 404
            row = self.db.fetchone("SELECT * FROM media WHERE id = ?", (media_id,))
            if row is None or row["project"] != project:
                raise HTTPException(status_code=404, detail="Media not found")
        path = Path(row["path"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Media file missing on disk")
        return path, row["mime"] or "application/octet-stream"

    def _media_row(
        self,
        row,
        role: str | None = None,
        span_id: str | None = None,
        created: bool = True,
    ) -> MediaOut:
        return MediaOut(
            id=row["id"],
            project=row["project"],
            sha256=row["sha256"],
            path=row["path"],
            mime=row["mime"],
            size=row["size"],
            modality=row["modality"],
            parent_id=row["parent_id"],
            transformation=_loads(row["transformation_json"]),
            created_at=row["created_at"],
            url=f"/api/v1/media/{row['id']}/file",
            role=role,
            span_id=span_id,
            created=created,
        )

    # ------------------------------------------------------------------ traces
    def create_trace(self, project: str, body: TraceCreate) -> TraceDetail:
        self.ensure_project(project)
        source = _source_value(body.source)
        if source not in VALID_SOURCE:
            raise HTTPException(status_code=400, detail=f"Invalid source: {source}")
        status = body.status.value if isinstance(body.status, TraceStatus) else str(body.status)
        if status not in VALID_TRACE_STATUS:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

        tid = body.id or uuid.uuid4().hex
        existing = self.db.fetchone(
            "SELECT id FROM traces WHERE id = ? AND project = ?", (tid, project)
        )
        if existing is not None:
            # Idempotent: return existing without duplicating.
            return self.get_trace(project, tid)

        # Also block id collision across projects.
        any_row = self.db.fetchone("SELECT id, project FROM traces WHERE id = ?", (tid,))
        if any_row is not None:
            raise HTTPException(status_code=409, detail="Trace id already exists in another project")

        spans = list(body.spans or [])
        for sp in spans:
            self._check_span_enums(sp)
        if spans:
            # Ensure every span has an id for graph validation.
            for sp in spans:
                if not sp.id:
                    sp.id = uuid.uuid4().hex[:12]
            _validate_span_graph(spans)

        started = body.started_at or _now()
        with self.db.transaction() as conn:
            conn.execute(
                """INSERT INTO traces
                   (id, project, session_id, name, agent, status, input_json, output_json,
                    metadata_json, tags_json, source, started_at, ended_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    tid,
                    project,
                    body.session_id,
                    body.name,
                    body.agent,
                    status,
                    _dumps(body.input),
                    _dumps(body.output),
                    _dumps(body.metadata),
                    _dumps(body.tags or []),
                    source,
                    started,
                    body.ended_at,
                ),
            )
            self._insert_spans(conn, tid, spans)
            self._attach_media(conn, tid, body.media or [])

        detail = self.get_trace(project, tid)
        if status == "completed":
            try:
                self.on_trace_completed(project, tid)
            except Exception:
                pass
        return detail

    def patch_trace(self, project: str, trace_id: str, body: TracePatch) -> TraceDetail:
        row = self._require_trace(project, trace_id)
        prev_status = row["status"]
        fields: list[str] = []
        values: list[Any] = []
        mapping = {
            "session_id": body.session_id,
            "name": body.name,
            "agent": body.agent,
            "ended_at": body.ended_at,
        }
        new_status = None
        for col, val in mapping.items():
            if val is not None:
                fields.append(f"{col} = ?")
                values.append(val)
        if body.status is not None:
            status = body.status.value if isinstance(body.status, TraceStatus) else str(body.status)
            if status not in VALID_TRACE_STATUS:
                raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
            fields.append("status = ?")
            values.append(status)
            new_status = status
        if body.input is not None:
            fields.append("input_json = ?")
            values.append(_dumps(body.input))
        if body.output is not None:
            fields.append("output_json = ?")
            values.append(_dumps(body.output))
        if body.metadata is not None:
            fields.append("metadata_json = ?")
            values.append(_dumps(body.metadata))
        if body.tags is not None:
            fields.append("tags_json = ?")
            values.append(_dumps(body.tags))

        with self.db.transaction() as conn:
            if fields:
                values.extend([trace_id, project])
                conn.execute(
                    f"UPDATE traces SET {', '.join(fields)} WHERE id = ? AND project = ?",
                    values,
                )
            if body.media is not None:
                self._attach_media(conn, trace_id, body.media)
        _ = row
        detail = self.get_trace(project, trace_id)
        if new_status == "completed" and prev_status != "completed":
            try:
                self.on_trace_completed(project, trace_id)
            except Exception:
                pass
        return detail

    def add_spans(self, project: str, trace_id: str, spans: list[SpanIn]) -> TraceDetail:
        self._require_trace(project, trace_id)
        for sp in spans:
            self._check_span_enums(sp)
            if not sp.id:
                sp.id = uuid.uuid4().hex[:12]
        existing = [
            dict(r)
            for r in self.db.fetchall("SELECT * FROM spans WHERE trace_id = ?", (trace_id,))
        ]
        _validate_span_graph_with_existing(spans, existing)
        with self.db.transaction() as conn:
            self._insert_spans(conn, trace_id, spans, replace=True)
        return self.get_trace(project, trace_id)

    def list_traces(
        self,
        project: str,
        *,
        session_id: str | None = None,
        agent: str | None = None,
        status: str | None = None,
        source: str | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TraceListItem]:
        self.ensure_project(project)
        clauses = ["t.project = ?"]
        params: list[Any] = [project]
        if session_id is not None:
            clauses.append("t.session_id = ?")
            params.append(session_id)
        if agent is not None:
            clauses.append("t.agent = ?")
            params.append(agent)
        if status is not None:
            clauses.append("t.status = ?")
            params.append(status)
        if source is not None:
            clauses.append("t.source = ?")
            params.append(source)
        if q:
            clauses.append(
                "(IFNULL(t.name,'') LIKE ? OR IFNULL(t.agent,'') LIKE ? OR IFNULL(t.id,'') LIKE ?)"
            )
            like = f"%{q}%"
            params.extend([like, like, like])
        where = " AND ".join(clauses)
        params.extend([limit, offset])
        rows = self.db.fetchall(
            f"""SELECT t.* FROM traces t
                WHERE {where}
                ORDER BY IFNULL(t.started_at, '') DESC
                LIMIT ? OFFSET ?""",
            params,
        )
        return [self._trace_list_item(r) for r in rows]

    def get_trace(self, project: str, trace_id: str) -> TraceDetail:
        row = self._require_trace(project, trace_id)
        spans_rows = self.db.fetchall(
            "SELECT * FROM spans WHERE trace_id = ? ORDER BY started_at ASC, id ASC",
            (trace_id,),
        )
        media_links = self.db.fetchall(
            """SELECT m.*, tm.role, tm.span_id
               FROM trace_media tm
               JOIN media m ON m.id = tm.media_id
               WHERE tm.trace_id = ?""",
            (trace_id,),
        )
        results_rows = self.db.fetchall(
            "SELECT * FROM eval_results WHERE trace_id = ? ORDER BY created_at ASC",
            (trace_id,),
        )
        summary = self._score_summary(trace_id)
        tokens = self._token_totals(spans_rows)
        tool_count = sum(1 for s in spans_rows if s["type"] == "tool")
        latency = self._trace_latency_ms(row, spans_rows)

        return TraceDetail(
            id=row["id"],
            project=row["project"],
            session_id=row["session_id"],
            name=row["name"],
            agent=row["agent"],
            status=row["status"],
            input=_loads(row["input_json"]),
            output=_loads(row["output_json"]),
            metadata=_loads(row["metadata_json"], {}),
            tags=_loads(row["tags_json"], []) or [],
            source=row["source"],
            started_at=row["started_at"],
            ended_at=row["ended_at"],
            spans=[self._span_out(s) for s in spans_rows],
            media=[self._media_row(m, role=m["role"], span_id=m["span_id"]) for m in media_links],
            results=[self._result_out(r) for r in results_rows],
            span_count=len(spans_rows),
            tool_call_count=tool_count,
            latency_ms=latency,
            input_tokens=tokens[0],
            output_tokens=tokens[1],
            score_summary=summary,
        )

    # ------------------------------------------------------------------ sessions
    def list_sessions(self, project: str) -> list[SessionSummary]:
        self.ensure_project(project)
        rows = self.db.fetchall(
            """SELECT session_id,
                      COUNT(*) AS trace_count,
                      MIN(started_at) AS started,
                      MAX(IFNULL(ended_at, started_at)) AS ended
               FROM traces
               WHERE project = ? AND session_id IS NOT NULL AND session_id != ''
               GROUP BY session_id
               ORDER BY started DESC""",
            (project,),
        )
        out: list[SessionSummary] = []
        for r in rows:
            sid = r["session_id"]
            agents = [
                a["agent"]
                for a in self.db.fetchall(
                    """SELECT DISTINCT agent FROM traces
                       WHERE project = ? AND session_id = ? AND agent IS NOT NULL""",
                    (project, sid),
                )
            ]
            tool_count = self.db.fetchone(
                """SELECT COUNT(*) AS c FROM spans s
                   JOIN traces t ON t.id = s.trace_id
                   WHERE t.project = ? AND t.session_id = ? AND s.type = 'tool'""",
                (project, sid),
            )["c"]
            error_count = self.db.fetchone(
                """SELECT COUNT(*) AS c FROM traces
                   WHERE project = ? AND session_id = ? AND status = 'failed'""",
                (project, sid),
            )["c"]
            # Also count failed spans as errors.
            span_errors = self.db.fetchone(
                """SELECT COUNT(*) AS c FROM spans s
                   JOIN traces t ON t.id = s.trace_id
                   WHERE t.project = ? AND t.session_id = ? AND s.status = 'failed'""",
                (project, sid),
            )["c"]
            out.append(
                SessionSummary(
                    session_id=sid,
                    trace_count=r["trace_count"],
                    started=r["started"],
                    ended=r["ended"],
                    agents=agents,
                    tool_call_count=tool_count,
                    error_count=error_count + span_errors,
                )
            )
        return out

    def get_session(self, project: str, session_id: str) -> SessionDetail:
        summaries = {s.session_id: s for s in self.list_sessions(project)}
        if session_id not in summaries:
            raise HTTPException(status_code=404, detail="Session not found")
        base = summaries[session_id]
        traces = self.list_traces(project, session_id=session_id, limit=1000, offset=0)
        return SessionDetail(**base.model_dump(), traces=traces)

    # ------------------------------------------------------------------ eval results (importer)
    def ensure_eval_run(self, project: str, run_id: str, name: str | None = None) -> None:
        self.ensure_project(project)
        row = self.db.fetchone("SELECT id FROM eval_runs WHERE id = ?", (run_id,))
        if row is None:
            self.db.execute(
                """INSERT INTO eval_runs (id, project, name, status, config_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (run_id, project, name or run_id, "completed", None, _now()),
            )

    def upsert_eval_result(
        self,
        *,
        project: str,
        run_id: str,
        result_id: str,
        trace_id: str | None,
        evaluator_id: str | None,
        evaluator_version: str | None,
        dimension: str | None,
        status: str | None,
        score: float | None,
        verdict: str | None,
        label: str | None,
        explanation: str | None,
        evidence: Any = None,
        meta: Any = None,
    ) -> None:
        self.ensure_eval_run(project, run_id)
        existing = self.db.fetchone("SELECT id FROM eval_results WHERE id = ?", (result_id,))
        if existing is not None:
            return
        self.db.execute(
            """INSERT INTO eval_results
               (id, run_id, trace_id, evaluator_id, evaluator_version, dimension, status,
                score, verdict, label, explanation, evidence_json, meta_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                result_id,
                run_id,
                trace_id,
                evaluator_id,
                evaluator_version,
                dimension,
                status,
                score,
                verdict,
                label,
                explanation,
                _dumps(evidence),
                _dumps(meta),
                _now(),
            ),
        )

    # ------------------------------------------------------------------ helpers
    def _require_trace(self, project: str, trace_id: str):
        row = self.db.fetchone(
            "SELECT * FROM traces WHERE id = ? AND project = ?", (trace_id, project)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        return row

    def _check_span_enums(self, sp: SpanIn) -> None:
        stype = sp.type.value if isinstance(sp.type, SpanType) else str(sp.type)
        if stype not in VALID_SPAN_TYPE:
            raise HTTPException(status_code=400, detail=f"Invalid span type: {stype}")
        sstatus = sp.status.value if isinstance(sp.status, SpanStatus) else str(sp.status)
        if sstatus not in VALID_SPAN_STATUS:
            raise HTTPException(status_code=400, detail=f"Invalid span status: {sstatus}")

    def _insert_spans(self, conn, trace_id: str, spans: list[SpanIn], replace: bool = False) -> None:
        for sp in spans:
            sid = sp.id or uuid.uuid4().hex[:12]
            stype = sp.type.value if isinstance(sp.type, SpanType) else str(sp.type)
            sstatus = sp.status.value if isinstance(sp.status, SpanStatus) else str(sp.status)
            if replace:
                existing = conn.execute(
                    "SELECT id FROM spans WHERE trace_id = ? AND id = ?", (trace_id, sid)
                ).fetchone()
                if existing:
                    conn.execute(
                        """UPDATE spans SET parent_ids_json=?, type=?, name=?, status=?, model=?,
                           started_at=?, ended_at=?, latency_ms=?, usage_json=?, input_json=?,
                           output_json=?, attributes_json=?, error=?
                           WHERE trace_id=? AND id=?""",
                        (
                            _dumps(sp.parent_ids or []),
                            stype,
                            sp.name,
                            sstatus,
                            sp.model,
                            sp.started_at,
                            sp.ended_at,
                            sp.latency_ms,
                            _dumps(sp.usage),
                            _dumps(sp.input),
                            _dumps(sp.output),
                            _dumps(sp.attributes),
                            sp.error,
                            trace_id,
                            sid,
                        ),
                    )
                    continue
            conn.execute(
                """INSERT INTO spans
                   (id, trace_id, parent_ids_json, type, name, status, model, started_at, ended_at,
                    latency_ms, usage_json, input_json, output_json, attributes_json, error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    sid,
                    trace_id,
                    _dumps(sp.parent_ids or []),
                    stype,
                    sp.name,
                    sstatus,
                    sp.model,
                    sp.started_at,
                    sp.ended_at,
                    sp.latency_ms,
                    _dumps(sp.usage),
                    _dumps(sp.input),
                    _dumps(sp.output),
                    _dumps(sp.attributes),
                    sp.error,
                ),
            )

    def _attach_media(self, conn, trace_id: str, media: list[MediaAttach]) -> None:
        for m in media:
            mid = m.media_id if hasattr(m, "media_id") else m.get("media_id")  # type: ignore[attr-defined]
            role = (m.role if hasattr(m, "role") else m.get("role")) or "input"  # type: ignore[attr-defined]
            span_id = m.span_id if hasattr(m, "span_id") else m.get("span_id")  # type: ignore[attr-defined]
            row = conn.execute("SELECT id FROM media WHERE id = ?", (mid,)).fetchone()
            if row is None:
                raise HTTPException(status_code=400, detail=f"Unknown media id: {mid}")
            existing = conn.execute(
                "SELECT 1 FROM trace_media WHERE trace_id=? AND media_id=? AND role=?",
                (trace_id, mid, role),
            ).fetchone()
            if existing:
                continue
            conn.execute(
                "INSERT INTO trace_media (trace_id, span_id, media_id, role) VALUES (?, ?, ?, ?)",
                (trace_id, span_id, mid, role),
            )

    def _span_out(self, row) -> SpanOut:
        return SpanOut(
            id=row["id"],
            trace_id=row["trace_id"],
            parent_ids=_loads(row["parent_ids_json"], []) or [],
            type=row["type"],
            name=row["name"],
            status=row["status"],
            model=row["model"],
            started_at=row["started_at"],
            ended_at=row["ended_at"],
            latency_ms=row["latency_ms"],
            usage=_loads(row["usage_json"]),
            input=_loads(row["input_json"]),
            output=_loads(row["output_json"]),
            attributes=_loads(row["attributes_json"]),
            error=row["error"],
        )

    def _result_out(self, row) -> EvalResultOut:
        return EvalResultOut(
            id=row["id"],
            run_id=row["run_id"],
            trace_id=row["trace_id"],
            evaluator_id=row["evaluator_id"],
            evaluator_version=row["evaluator_version"],
            dimension=row["dimension"],
            status=row["status"],
            score=row["score"],
            verdict=row["verdict"],
            label=row["label"],
            explanation=row["explanation"],
            evidence=_loads(row["evidence_json"]),
            meta=_loads(row["meta_json"]),
            created_at=row["created_at"],
        )

    def _score_summary(self, trace_id: str) -> ScoreSummary:
        rows = self.db.fetchall(
            "SELECT dimension, score FROM eval_results WHERE trace_id = ? AND score IS NOT NULL",
            (trace_id,),
        )
        if not rows:
            return ScoreSummary()
        scores = [r["score"] for r in rows]
        by_dim: dict[str, list[float]] = {}
        for r in rows:
            dim = r["dimension"] or "unknown"
            by_dim.setdefault(dim, []).append(r["score"])
        return ScoreSummary(
            count=len(scores),
            mean=sum(scores) / len(scores),
            by_dimension={
                k: {"count": len(v), "mean": sum(v) / len(v)} for k, v in by_dim.items()
            },
        )

    def _token_totals(self, spans_rows) -> tuple[Optional[int], Optional[int]]:
        tin = 0
        tout = 0
        saw = False
        for s in spans_rows:
            usage = _loads(s["usage_json"]) or {}
            if not isinstance(usage, dict):
                continue
            if usage.get("input_tokens") is not None:
                tin += int(usage["input_tokens"])
                saw = True
            if usage.get("output_tokens") is not None:
                tout += int(usage["output_tokens"])
                saw = True
        if not saw:
            return None, None
        return tin, tout

    def _trace_latency_ms(self, row, spans_rows) -> Optional[float]:
        latencies = [s["latency_ms"] for s in spans_rows if s["latency_ms"] is not None]
        if latencies:
            return float(max(latencies))
        if row["started_at"] and row["ended_at"]:
            try:
                a = datetime.fromisoformat(row["started_at"])
                b = datetime.fromisoformat(row["ended_at"])
                return (b - a).total_seconds() * 1000.0
            except ValueError:
                return None
        return None

    def _trace_list_item(self, row) -> TraceListItem:
        spans_rows = self.db.fetchall("SELECT * FROM spans WHERE trace_id = ?", (row["id"],))
        tokens = self._token_totals(spans_rows)
        tool_count = sum(1 for s in spans_rows if s["type"] == "tool")
        return TraceListItem(
            id=row["id"],
            project=row["project"],
            session_id=row["session_id"],
            name=row["name"],
            agent=row["agent"],
            status=row["status"],
            source=row["source"],
            started_at=row["started_at"],
            ended_at=row["ended_at"],
            tags=_loads(row["tags_json"], []) or [],
            span_count=len(spans_rows),
            tool_call_count=tool_count,
            latency_ms=self._trace_latency_ms(row, spans_rows),
            input_tokens=tokens[0],
            output_tokens=tokens[1],
            score_summary=self._score_summary(row["id"]),
        )
