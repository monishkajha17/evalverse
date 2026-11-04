"""Load and import the onboarding sample workspace pack."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from evalverse.server.schemas import MediaAttach, SpanIn, TemporalEventIn, TraceCreate

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "data" / "sample_workspace"
MANIFEST_NAME = "manifest.json"
SAMPLE_TAG = "sample"
RUN_ID_PREFIX = "import:sample"


def sample_dir() -> Path:
    override = os.environ.get("EVALVERSE_SAMPLE_WORKSPACE")
    if override:
        return Path(override)
    return SAMPLE_DIR


def manifest_path() -> Path:
    return sample_dir() / MANIFEST_NAME


def seed_on_register_enabled() -> bool:
    raw = os.environ.get("EVALVERSE_SEED_ON_REGISTER", "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def project_has_sample_data(service: Any, project: str) -> bool:
    rows = service.db.fetchall(
        "SELECT tags_json FROM traces WHERE project = ?",
        (project,),
    )
    for row in rows:
        tags = json.loads(row["tags_json"] or "[]")
        if SAMPLE_TAG in (tags or []):
            return True
    return False


def _trace_id(project: str, short_name: str) -> str:
    # Globally unique across projects; stable for idempotent re-seed.
    safe_project = re.sub(r"[^a-zA-Z0-9._-]+", "-", project)[:48]
    return f"sample:{safe_project}:{short_name}"


def _result_id(project: str, short_name: str, evaluator_id: str, orig_id: str | None) -> str:
    safe_project = re.sub(r"[^a-zA-Z0-9._-]+", "-", project)[:48]
    suffix = (orig_id or evaluator_id or "result").replace("|", "_")[-48:]
    return f"sample:{safe_project}:{short_name}:{evaluator_id}:{suffix}"


def _run_id(project: str) -> str:
    return f"{RUN_ID_PREFIX}:{project}"


def load_manifest() -> dict[str, Any]:
    path = manifest_path()
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail={
                "code": "SAMPLE_WORKSPACE_MISSING",
                "message": (
                    "Sample workspace pack not found. "
                    "Run `python -m evalverse.make_sample_workspace` to build "
                    f"{path}."
                ),
                "details": [{"field": "sample_workspace", "reason": "missing"}],
            },
        )
    return json.loads(path.read_text())


def _existing_sample_keys(service: Any, project: str) -> set[str]:
    rows = service.db.fetchall(
        "SELECT metadata_json, tags_json FROM traces WHERE project = ?",
        (project,),
    )
    keys: set[str] = set()
    for row in rows:
        tags = json.loads(row["tags_json"] or "[]") or []
        if SAMPLE_TAG not in tags:
            continue
        meta = json.loads(row["metadata_json"] or "{}") or {}
        key = meta.get("sample_key")
        if key:
            keys.add(str(key))
    return keys


def seed_demo(service: Any, project: str) -> dict[str, int]:
    """Import data/sample_workspace into *project*. Idempotent."""
    manifest = load_manifest()
    existing = _existing_sample_keys(service, project)
    added = 0
    skipped = 0
    base = sample_dir()
    run_id = _run_id(project)

    for item in manifest.get("traces") or []:
        short = str(item.get("sample_key") or item.get("short_name") or "")
        if not short:
            continue
        if short in existing:
            skipped += 1
            continue

        tid = _trace_id(project, short)
        try:
            service.get_trace(project, tid)
            skipped += 1
            continue
        except HTTPException:
            pass

        media_attach: list[MediaAttach] = []
        for asset in item.get("media") or []:
            rel = asset.get("path")
            if not rel:
                continue
            src = base / rel
            if not src.is_file():
                continue
            m = service.register_media_bytes(
                project,
                src.read_bytes(),
                modality=asset.get("modality") or "image",
                filename=src.name,
                transformation=asset.get("transformation"),
            )
            media_attach.append(
                MediaAttach(
                    media_id=m.id,
                    role=asset.get("role") or "input",
                    span_id=asset.get("span_id"),
                )
            )

        spans: list[SpanIn] = []
        for sp in item.get("spans") or []:
            spans.append(
                SpanIn(
                    id=sp.get("id"),
                    parent_ids=list(sp.get("parent_ids") or sp.get("parent_span_ids") or []),
                    type=sp.get("type") or "custom",
                    name=sp.get("name") or sp.get("id") or "span",
                    status=sp.get("status") or "completed",
                    model=sp.get("model"),
                    latency_ms=sp.get("latency_ms"),
                    usage=sp.get("usage") if isinstance(sp.get("usage"), dict) else None,
                    input=sp.get("input"),
                    output=sp.get("output"),
                    attributes=sp.get("attributes"),
                    error=sp.get("error"),
                )
            )

        meta = dict(item.get("metadata") or {})
        meta["sample_key"] = short
        meta["expectation"] = item.get("expectation") or meta.get("expectation")

        tags = list(item.get("tags") or [])
        if SAMPLE_TAG not in tags:
            tags.append(SAMPLE_TAG)

        service.create_trace(
            project,
            TraceCreate(
                id=tid,
                session_id=item.get("session_id") or f"sample:{short}",
                name=item.get("name") or short,
                agent=item.get("agent"),
                status="completed",
                input=item.get("input"),
                output=item.get("output"),
                metadata=meta,
                tags=tags,
                source="import",
                spans=spans,
                media=media_attach,
            ),
        )

        # Temporal events — remap media_id to attached media when single input.
        primary_mid = media_attach[0].media_id if media_attach else None
        events_in: list[TemporalEventIn] = []
        for ev in item.get("events") or []:
            payload = dict(ev)
            if primary_mid and not payload.get("media_id"):
                payload["media_id"] = primary_mid
            elif primary_mid and payload.get("media_id") in ("$media", "${media}", "media"):
                payload["media_id"] = primary_mid
            # Drop stale absolute media ids from the pack; keep only if matches attached.
            mid = payload.get("media_id")
            if mid and mid not in {m.media_id for m in media_attach}:
                if primary_mid:
                    payload["media_id"] = primary_mid
                else:
                    payload.pop("media_id", None)
            events_in.append(TemporalEventIn.model_validate(payload))
        if events_in:
            service.add_events(project, tid, events_in)

        for res in item.get("results") or []:
            eid = res.get("evaluator_id") or "unknown"
            rid = _result_id(project, short, eid, res.get("id"))
            service.upsert_eval_result(
                project=project,
                run_id=run_id,
                result_id=rid,
                trace_id=tid,
                evaluator_id=res.get("evaluator_id"),
                evaluator_version=res.get("evaluator_version"),
                dimension=res.get("dimension"),
                status=res.get("status") or "completed",
                score=res.get("score"),
                verdict=res.get("verdict"),
                label=res.get("label"),
                explanation=res.get("explanation"),
                evidence=res.get("evidence"),
                meta=res.get("execution_metadata") or res.get("meta"),
            )

        added += 1
        existing.add(short)

    return {"added": added, "skipped": skipped}


def unseed_demo(service: Any, project: str) -> dict[str, int]:
    """Remove everything tagged `sample` in *project*."""
    rows = service.db.fetchall(
        "SELECT id, tags_json FROM traces WHERE project = ?",
        (project,),
    )
    removed = 0
    media_ids: set[str] = set()
    for row in rows:
        tags = json.loads(row["tags_json"] or "[]") or []
        if SAMPLE_TAG not in tags:
            continue
        tid = row["id"]
        for m in service.db.fetchall(
            "SELECT media_id FROM trace_media WHERE trace_id = ?", (tid,)
        ):
            media_ids.add(m["media_id"])
        service.db.execute("DELETE FROM eval_results WHERE trace_id = ?", (tid,))
        service.db.execute("DELETE FROM traces WHERE id = ? AND project = ?", (tid, project))
        removed += 1

    # Drop media that is no longer referenced.
    for mid in media_ids:
        still = service.db.fetchone(
            "SELECT 1 FROM trace_media WHERE media_id = ?", (mid,)
        )
        if still is not None:
            continue
        mrow = service.db.fetchone(
            "SELECT path FROM media WHERE id = ? AND project = ?", (mid, project)
        )
        if mrow is None:
            continue
        path = Path(mrow["path"]) if mrow["path"] else None
        service.db.execute("DELETE FROM media WHERE id = ? AND project = ?", (mid, project))
        if path and path.is_file():
            try:
                path.unlink()
            except OSError:
                pass

    # Remove empty sample eval run.
    rid = _run_id(project)
    left = service.db.fetchone("SELECT 1 FROM eval_results WHERE run_id = ?", (rid,))
    if left is None:
        service.db.execute("DELETE FROM eval_runs WHERE id = ? AND project = ?", (rid, project))

    return {"removed": removed}
