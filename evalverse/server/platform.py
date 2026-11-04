"""Datasets, evaluator registry, evaluations, policies and alerts."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib import request as urlrequest

from fastapi import HTTPException

from evalverse import evaluators as evmod
from evalverse.server.engine import (
    default_judge_fn,
    resolve_expectation,
    rubric_needs_reference,
    run_builtin,
    run_rubric_evaluator,
    run_rule_evaluator,
)
from evalverse.server.rules import rules_need_reference

log = logging.getLogger("evalverse.server.platform")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dumps(obj: Any) -> str | None:
    if obj is None:
        return None
    return json.dumps(obj, sort_keys=True, default=str)


def _loads(raw: str | None, default: Any = None) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _stable_sample(trace_id: str, rate: float) -> bool:
    if rate >= 1.0:
        return True
    if rate <= 0.0:
        return False
    h = hashlib.sha256(trace_id.encode()).hexdigest()
    # Map first 8 hex digits to [0, 1)
    val = int(h[:8], 16) / 0xFFFFFFFF
    return val < rate


class PlatformMixin:
    """Mixin adding datasets / evaluators / evaluations / policies onto Service."""

    judge_fn = staticmethod(default_judge_fn)

    # ================================================================== datasets
    def create_dataset(self, project: str, name: str, description: str | None = None, metadata: Any = None) -> dict:
        self.ensure_project(project)
        did = uuid.uuid4().hex
        self.db.execute(
            """INSERT INTO datasets (id, project, name, description, metadata_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (did, project, name, description, _dumps(metadata), _now()),
        )
        return self.get_dataset(project, did)

    def list_datasets(self, project: str) -> list[dict]:
        self.ensure_project(project)
        rows = self.db.fetchall(
            "SELECT * FROM datasets WHERE project = ? ORDER BY created_at DESC", (project,)
        )
        return [self._dataset_out(r) for r in rows]

    def get_dataset(self, project: str, dataset_id: str) -> dict:
        row = self.db.fetchone(
            "SELECT * FROM datasets WHERE id = ? AND project = ?", (dataset_id, project)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        out = self._dataset_out(row)
        versions = self.db.fetchall(
            "SELECT * FROM dataset_versions WHERE dataset_id = ? ORDER BY created_at ASC",
            (dataset_id,),
        )
        out["versions"] = [self._version_out(v) for v in versions]
        return out

    def create_dataset_version(
        self, project: str, dataset_id: str, version: str | None = None, metadata: Any = None
    ) -> dict:
        self.get_dataset(project, dataset_id)
        ver = version or f"v{len(self.db.fetchall('SELECT id FROM dataset_versions WHERE dataset_id=?', (dataset_id,))) + 1}"
        existing = self.db.fetchone(
            "SELECT id FROM dataset_versions WHERE dataset_id = ? AND version = ?",
            (dataset_id, ver),
        )
        if existing:
            raise HTTPException(status_code=409, detail="Version already exists")
        vid = uuid.uuid4().hex
        self.db.execute(
            """INSERT INTO dataset_versions
               (id, dataset_id, version, content_hash, metadata_json, created_at, locked)
               VALUES (?, ?, ?, ?, ?, ?, 0)""",
            (vid, dataset_id, ver, hashlib.sha256(b"").hexdigest(), _dumps(metadata), _now()),
        )
        return self._version_out(
            self.db.fetchone("SELECT * FROM dataset_versions WHERE id = ?", (vid,))
        )

    def _latest_version(self, dataset_id: str):
        return self.db.fetchone(
            """SELECT * FROM dataset_versions WHERE dataset_id = ?
               ORDER BY created_at DESC LIMIT 1""",
            (dataset_id,),
        )

    def _require_writable_version(self, version_row) -> None:
        if version_row is None:
            raise HTTPException(status_code=400, detail="No dataset version; create one first")
        if version_row["locked"]:
            raise HTTPException(
                status_code=400,
                detail="Dataset version is immutable (referenced by an evaluation or experiment)",
            )

    def add_dataset_item(
        self,
        project: str,
        dataset_id: str,
        *,
        input: Any,
        expectation: Any = None,
        tags: list | None = None,
        metadata: Any = None,
        version_id: str | None = None,
        item_id: str | None = None,
    ) -> dict:
        self.get_dataset(project, dataset_id)
        if version_id:
            vrow = self.db.fetchone(
                "SELECT * FROM dataset_versions WHERE id = ? AND dataset_id = ?",
                (version_id, dataset_id),
            )
        else:
            vrow = self._latest_version(dataset_id)
            if vrow is None:
                vrow_dict = self.create_dataset_version(project, dataset_id)
                vrow = self.db.fetchone(
                    "SELECT * FROM dataset_versions WHERE id = ?", (vrow_dict["id"],)
                )
        self._require_writable_version(vrow)
        iid = item_id or uuid.uuid4().hex
        self.db.execute(
            """INSERT INTO dataset_items
               (id, version_id, input_json, expected_json, expectation_json, tags_json, metadata_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                iid,
                vrow["id"],
                _dumps(input),
                _dumps(expectation),
                _dumps(expectation),
                _dumps(tags or []),
                _dumps(metadata),
                _now(),
            ),
        )
        self._rehash_version(vrow["id"])
        return self.get_dataset_item(project, iid)

    def get_dataset_item(self, project: str, item_id: str) -> dict:
        row = self.db.fetchone("SELECT * FROM dataset_items WHERE id = ?", (item_id,))
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset item not found")
        v = self.db.fetchone("SELECT * FROM dataset_versions WHERE id = ?", (row["version_id"],))
        ds = self.db.fetchone("SELECT * FROM datasets WHERE id = ?", (v["dataset_id"],))
        if ds is None or ds["project"] != project:
            raise HTTPException(status_code=404, detail="Dataset item not found")
        return self._item_out(row)

    def list_dataset_items(
        self, project: str, dataset_id: str, version_id: str | None = None
    ) -> list[dict]:
        self.get_dataset(project, dataset_id)
        if version_id:
            vid = version_id
        else:
            latest = self._latest_version(dataset_id)
            if latest is None:
                return []
            vid = latest["id"]
        rows = self.db.fetchall(
            "SELECT * FROM dataset_items WHERE version_id = ? ORDER BY created_at ASC", (vid,)
        )
        return [self._item_out(r) for r in rows]

    def export_dataset_jsonl(self, project: str, dataset_id: str, version_id: str | None = None) -> str:
        items = self.list_dataset_items(project, dataset_id, version_id=version_id)
        return "\n".join(json.dumps(it, default=str) for it in items) + ("\n" if items else "")

    def import_dataset_jsonl(
        self, project: str, dataset_id: str, text: str, version_id: str | None = None
    ) -> dict:
        self.get_dataset(project, dataset_id)
        if version_id:
            vrow = self.db.fetchone(
                "SELECT * FROM dataset_versions WHERE id = ? AND dataset_id = ?",
                (version_id, dataset_id),
            )
        else:
            vrow = self._latest_version(dataset_id)
            if vrow is None:
                created = self.create_dataset_version(project, dataset_id)
                vrow = self.db.fetchone("SELECT * FROM dataset_versions WHERE id = ?", (created["id"],))
        self._require_writable_version(vrow)
        n = 0
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            self.add_dataset_item(
                project,
                dataset_id,
                input=obj.get("input"),
                expectation=obj.get("expectation") or obj.get("expected"),
                tags=obj.get("tags"),
                metadata=obj.get("metadata"),
                version_id=vrow["id"],
                item_id=obj.get("id"),
            )
            n += 1
        return {"imported": n, "version_id": vrow["id"]}

    def promote_trace(
        self,
        project: str,
        trace_id: str,
        dataset_id: str,
        expectation: Any = None,
        tags: list | None = None,
    ) -> dict:
        tr = self.get_trace(project, trace_id)
        media_ids = [m.id if hasattr(m, "id") else m.get("id") for m in (tr.media or [])]
        cited = []
        for sp in tr.spans or []:
            out = sp.output if hasattr(sp, "output") else sp.get("output")
            if isinstance(out, dict) and out.get("box"):
                cited.append({"type": "image_region", "role": "claimed", "locator": out["box"]})
        inp = {
            "text": tr.input,
            "media_ids": media_ids,
            "trace_id": trace_id,
            "cited_evidence": cited,
        }
        exp = expectation
        if exp is None and isinstance(tr.metadata, dict):
            exp = tr.metadata.get("expectation")
        return self.add_dataset_item(
            project,
            dataset_id,
            input=inp,
            expectation=exp,
            tags=tags or list(tr.tags or []),
            metadata={"promoted_from": trace_id},
        )

    def _rehash_version(self, version_id: str) -> None:
        items = self.db.fetchall(
            "SELECT id, input_json, expectation_json, expected_json, tags_json FROM dataset_items WHERE version_id = ? ORDER BY id",
            (version_id,),
        )
        h = hashlib.sha256()
        for it in items:
            payload = {
                "id": it["id"],
                "input": _loads(it["input_json"]),
                "expectation": _loads(it["expectation_json"]) or _loads(it["expected_json"]),
                "tags": _loads(it["tags_json"], []),
            }
            h.update(json.dumps(payload, sort_keys=True, default=str).encode())
        self.db.execute(
            "UPDATE dataset_versions SET content_hash = ? WHERE id = ?",
            (h.hexdigest(), version_id),
        )

    def lock_dataset_version(self, version_id: str) -> None:
        self.db.execute("UPDATE dataset_versions SET locked = 1 WHERE id = ?", (version_id,))

    def _dataset_out(self, row) -> dict:
        return {
            "id": row["id"],
            "project": row["project"],
            "name": row["name"],
            "description": row["description"],
            "metadata": _loads(row["metadata_json"], {}),
            "created_at": row["created_at"],
        }

    def _version_out(self, row) -> dict:
        return {
            "id": row["id"],
            "dataset_id": row["dataset_id"],
            "version": row["version"],
            "content_hash": row["content_hash"],
            "metadata": _loads(row["metadata_json"], {}),
            "created_at": row["created_at"],
            "locked": bool(row["locked"]) if "locked" in row.keys() else False,
        }

    def _item_out(self, row) -> dict:
        exp = _loads(row["expectation_json"]) if "expectation_json" in row.keys() else None
        if exp is None:
            exp = _loads(row["expected_json"])
        return {
            "id": row["id"],
            "version_id": row["version_id"],
            "input": _loads(row["input_json"]),
            "expectation": exp,
            "tags": _loads(row["tags_json"], []) or [],
            "metadata": _loads(row["metadata_json"], {}),
            "created_at": row["created_at"],
        }

    # =============================================================== evaluators
    def list_evaluators(self, project: str) -> list[dict]:
        self.ensure_project(project)
        out = []
        for meta in evmod.registry_list():
            out.append(
                {
                    **meta,
                    "source": "builtin",
                    "type": "builtin",
                    "project": None,
                }
            )
        rows = self.db.fetchall(
            """SELECT * FROM evaluator_defs WHERE project = ?
               ORDER BY evaluator_id, created_at DESC""",
            (project,),
        )
        seen = set()
        for r in rows:
            key = r["evaluator_id"]
            if key in seen:
                continue
            seen.add(key)
            out.append(self._evaluator_out(r))
        return out

    def create_evaluator(self, project: str, body: dict) -> dict:
        self.ensure_project(project)
        etype = body.get("type")
        if etype not in ("rubric", "rule"):
            raise HTTPException(status_code=400, detail="type must be rubric or rule")
        name = body.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        eid = body.get("id") or name.replace(" ", "_").lower()
        version = body.get("version") or "1.0.0"
        existing = self.db.fetchone(
            "SELECT 1 FROM evaluator_defs WHERE project=? AND evaluator_id=? AND version=?",
            (project, eid, version),
        )
        if existing:
            raise HTTPException(status_code=409, detail="Evaluator version already exists")

        config = dict(body)
        needs_ref = False
        if etype == "rubric":
            needs_ref = rubric_needs_reference(config)
            if not config.get("prompt"):
                raise HTTPException(status_code=400, detail="rubric requires prompt")
        else:
            checks = config.get("checks") or config.get("rules") or []
            needs_ref = rules_need_reference(checks)

        self.db.execute(
            """INSERT INTO evaluator_defs
               (project, evaluator_id, version, name, type, category, dimension, description,
                modalities_json, needs_reference, config_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                project,
                eid,
                version,
                name,
                etype,
                body.get("category") or etype,
                body.get("dimension") or "Custom",
                body.get("description"),
                _dumps(body.get("modalities") or ["image", "text"]),
                1 if needs_ref else 0,
                _dumps(config),
                _now(),
            ),
        )
        row = self.db.fetchone(
            "SELECT * FROM evaluator_defs WHERE project=? AND evaluator_id=? AND version=?",
            (project, eid, version),
        )
        return self._evaluator_out(row)

    def put_evaluator_version(self, project: str, evaluator_id: str, body: dict) -> dict:
        latest = self.db.fetchone(
            """SELECT * FROM evaluator_defs WHERE project=? AND evaluator_id=?
               ORDER BY created_at DESC LIMIT 1""",
            (project, evaluator_id),
        )
        if latest is None and evaluator_id not in evmod.REGISTRY:
            raise HTTPException(status_code=404, detail="Evaluator not found")
        if latest is None:
            raise HTTPException(status_code=400, detail="Cannot version a builtin evaluator")
        # bump patch version
        parts = latest["version"].split(".")
        try:
            parts[-1] = str(int(parts[-1]) + 1)
            new_ver = ".".join(parts)
        except ValueError:
            new_ver = latest["version"] + ".1"
        payload = {**_loads(latest["config_json"], {}), **body, "name": body.get("name") or latest["name"]}
        payload["type"] = latest["type"]
        payload["id"] = evaluator_id
        payload["version"] = body.get("version") or new_ver
        return self.create_evaluator(project, payload)

    def get_evaluator(self, project: str, evaluator_id: str, version: str | None = None) -> dict:
        if evaluator_id in evmod.REGISTRY and version is None:
            meta = next(m for m in evmod.registry_list() if m["id"] == evaluator_id)
            return {**meta, "source": "builtin", "type": "builtin"}
        if version:
            row = self.db.fetchone(
                "SELECT * FROM evaluator_defs WHERE project=? AND evaluator_id=? AND version=?",
                (project, evaluator_id, version),
            )
        else:
            row = self.db.fetchone(
                """SELECT * FROM evaluator_defs WHERE project=? AND evaluator_id=?
                   ORDER BY created_at DESC LIMIT 1""",
                (project, evaluator_id),
            )
        if row is None:
            if evaluator_id in evmod.REGISTRY:
                meta = next(m for m in evmod.registry_list() if m["id"] == evaluator_id)
                return {**meta, "source": "builtin", "type": "builtin"}
            raise HTTPException(status_code=404, detail="Evaluator not found")
        return self._evaluator_out(row)

    def test_evaluator(self, project: str, evaluator_id: str, trace_id: str) -> dict:
        """Run evaluator without storing a result."""
        tr = self.get_trace(project, trace_id)
        trace_dict = tr.model_dump() if hasattr(tr, "model_dump") else dict(tr)
        ev = self.get_evaluator(project, evaluator_id)
        expectation = resolve_expectation(trace_dict)
        result = self._run_evaluator_spec(project, ev, trace_dict, expectation, store=False)
        return result

    def _evaluator_out(self, row) -> dict:
        cfg = _loads(row["config_json"], {})
        return {
            "id": row["evaluator_id"],
            "version": row["version"],
            "name": row["name"],
            "type": row["type"],
            "category": row["category"],
            "dimension": row["dimension"],
            "description": row["description"],
            "modalities": _loads(row["modalities_json"], []),
            "needs_reference": bool(row["needs_reference"]),
            "scope": "run",
            "source": "user",
            "project": row["project"],
            "config": cfg,
            "created_at": row["created_at"],
        }

    # ============================================================== evaluations
    def create_evaluation(
        self,
        project: str,
        *,
        trace_ids: list[str] | None = None,
        filter: dict | None = None,
        evaluator_ids: list[str],
        dataset_item_id: str | None = None,
        dataset_version_id: str | None = None,
    ) -> dict:
        self.ensure_project(project)
        if not evaluator_ids:
            raise HTTPException(status_code=400, detail="evaluator_ids required")
        ids = list(trace_ids or [])
        if filter:
            rows = self.list_traces(
                project,
                agent=filter.get("agent"),
                status=filter.get("status") or "completed",
                source=filter.get("source"),
                limit=1000,
                offset=0,
            )
            if filter.get("tags"):
                want = set(filter["tags"])
                rows = [r for r in rows if want.intersection(set(r.tags or []))]
            ids.extend(r.id for r in rows)
        # dedupe
        seen = set()
        uniq = []
        for t in ids:
            if t not in seen:
                seen.add(t)
                uniq.append(t)
        if not uniq:
            raise HTTPException(status_code=400, detail="no traces matched")

        if dataset_version_id:
            self.lock_dataset_version(dataset_version_id)
        if dataset_item_id:
            item = self.get_dataset_item(project, dataset_item_id)
            self.lock_dataset_version(item["version_id"])

        run_id = uuid.uuid4().hex
        self.db.execute(
            """INSERT INTO eval_runs (id, project, name, status, config_json, created_at, progress_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                project,
                f"eval:{run_id[:8]}",
                "pending",
                _dumps(
                    {
                        "trace_ids": uniq,
                        "evaluator_ids": evaluator_ids,
                        "dataset_item_id": dataset_item_id,
                        "dataset_version_id": dataset_version_id,
                    }
                ),
                _now(),
                _dumps({"total": 0, "completed": 0, "failed": 0, "skipped": 0}),
            ),
        )

        jobs = 0
        for tid in uniq:
            for eid in evaluator_ids:
                ev = self.get_evaluator(project, eid)
                ver = ev.get("version") or "1.0.0"
                jid = uuid.uuid4().hex
                try:
                    self.db.execute(
                        """INSERT INTO eval_jobs
                           (id, run_id, project, trace_id, evaluator_id, evaluator_version,
                            dataset_item_id, status, attempts, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)""",
                        (jid, run_id, project, tid, eid, ver, dataset_item_id, _now()),
                    )
                    jobs += 1
                except Exception:
                    # unique constraint = already queued (idempotent)
                    pass

        self.db.execute(
            "UPDATE eval_runs SET status='running', progress_json=? WHERE id=?",
            (_dumps({"total": jobs, "completed": 0, "failed": 0, "skipped": 0, "pending": jobs}), run_id),
        )
        if hasattr(self, "worker") and self.worker:
            self.worker.start()
        return {"id": run_id, "status": "running", "jobs": jobs}

    def get_evaluation(self, project: str, run_id: str) -> dict:
        row = self.db.fetchone(
            "SELECT * FROM eval_runs WHERE id = ? AND project = ?", (run_id, project)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Evaluation not found")
        results = self.db.fetchall(
            "SELECT * FROM eval_results WHERE run_id = ? ORDER BY created_at ASC", (run_id,)
        )
        jobs = self.db.fetchall("SELECT status, COUNT(*) AS c FROM eval_jobs WHERE run_id=? GROUP BY status", (run_id,))
        by = {j["status"]: j["c"] for j in jobs}
        progress = {
            "total": sum(by.values()),
            "pending": by.get("pending", 0),
            "running": by.get("running", 0),
            "completed": by.get("completed", 0) + by.get("skipped", 0),
            "failed": by.get("error", 0) + by.get("failed", 0),
            "skipped": by.get("skipped", 0),
        }
        return {
            "id": row["id"],
            "project": row["project"],
            "name": row["name"],
            "status": row["status"],
            "config": _loads(row["config_json"], {}),
            "created_at": row["created_at"],
            "ended_at": row["ended_at"],
            "progress": progress,
            "results": [self._result_out(r).model_dump() if hasattr(self._result_out(r), "model_dump") else self._result_dict(r) for r in results],
        }

    def _result_dict(self, row) -> dict:
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "trace_id": row["trace_id"],
            "evaluator_id": row["evaluator_id"],
            "evaluator_version": row["evaluator_version"],
            "dimension": row["dimension"],
            "status": row["status"],
            "score": row["score"],
            "verdict": row["verdict"],
            "label": row["label"],
            "explanation": row["explanation"],
            "evidence": _loads(row["evidence_json"]),
            "meta": _loads(row["meta_json"]),
            "execution_metadata": _loads(row["meta_json"]),
            "created_at": row["created_at"],
        }

    def claim_next_job(self) -> dict | None:
        with self.db.transaction() as conn:
            row = conn.execute(
                """SELECT * FROM eval_jobs WHERE status='pending'
                   ORDER BY created_at ASC LIMIT 1"""
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE eval_jobs SET status='running', started_at=?, attempts=attempts+1 WHERE id=?",
                (_now(), row["id"]),
            )
            return dict(row)

    def fail_job(self, job_id: str, error: str) -> None:
        self.db.execute(
            "UPDATE eval_jobs SET status='error', error=?, ended_at=? WHERE id=?",
            (error[:500], _now(), job_id),
        )
        job = self.db.fetchone("SELECT * FROM eval_jobs WHERE id=?", (job_id,))
        if job:
            self._refresh_run_status(job["run_id"])

    def execute_job(self, job: dict, timeout_s: float = 60.0, max_retries: int = 2) -> None:
        project = job["project"]
        run_id = job["run_id"]
        # Idempotent: skip if result already stored for this run/trace/evaluator/version
        existing = self.db.fetchone(
            """SELECT id FROM eval_results
               WHERE run_id=? AND trace_id=? AND evaluator_id=? AND evaluator_version=?""",
            (run_id, job["trace_id"], job["evaluator_id"], job["evaluator_version"]),
        )
        if existing:
            self.db.execute(
                "UPDATE eval_jobs SET status='completed', ended_at=? WHERE id=?",
                (_now(), job["id"]),
            )
            self._refresh_run_status(run_id)
            return

        attempts_left = max_retries + 1
        last_err = None
        result = None
        while attempts_left > 0:
            attempts_left -= 1
            try:
                tr = self.get_trace(project, job["trace_id"])
                trace_dict = tr.model_dump() if hasattr(tr, "model_dump") else dict(tr)
                item = None
                if job.get("dataset_item_id"):
                    item = self.get_dataset_item(project, job["dataset_item_id"])
                expectation = resolve_expectation(trace_dict, item)
                ev = self.get_evaluator(project, job["evaluator_id"], version=job["evaluator_version"])
                result = self._run_evaluator_spec(
                    project, ev, trace_dict, expectation, store=False, timeout_s=timeout_s
                )
                break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                if attempts_left <= 0:
                    result = {
                        "status": "error",
                        "score": None,
                        "verdict": "not_applicable",
                        "label": "error",
                        "explanation": str(exc)[:500],
                        "evidence": [],
                        "execution_metadata": {},
                    }
                else:
                    continue

        assert result is not None
        ev_meta = self.get_evaluator(project, job["evaluator_id"], version=job["evaluator_version"])
        rid = f"{run_id}|{job['trace_id']}|{job['evaluator_id']}|{job['evaluator_version']}"
        # Idempotent insert
        before = self.db.fetchone("SELECT id FROM eval_results WHERE id=?", (rid,))
        if before is None:
            self.upsert_eval_result(
                project=project,
                run_id=run_id,
                result_id=rid,
                trace_id=job["trace_id"],
                evaluator_id=job["evaluator_id"],
                evaluator_version=job["evaluator_version"],
                dimension=ev_meta.get("dimension") or result.get("dimension"),
                status=result.get("status"),
                score=result.get("score"),
                verdict=result.get("verdict"),
                label=result.get("label"),
                explanation=result.get("explanation"),
                evidence=result.get("evidence"),
                meta=result.get("execution_metadata") or result.get("meta"),
            )
            self._maybe_alert(project, run_id, job["trace_id"], rid, result, ev_meta)

        status = "completed" if result.get("status") in ("completed", "skipped") else "error"
        if result.get("status") == "skipped":
            status = "skipped"
        self.db.execute(
            "UPDATE eval_jobs SET status=?, error=?, ended_at=? WHERE id=?",
            (status, last_err and str(last_err)[:500], _now(), job["id"]),
        )
        self._refresh_run_status(run_id)

    def _run_evaluator_spec(
        self,
        project: str,
        ev: dict,
        trace_dict: dict,
        expectation: dict | None,
        *,
        store: bool = False,
        timeout_s: float = 60.0,
    ) -> dict:
        etype = ev.get("type") or ev.get("source")
        if etype == "builtin" or (ev.get("id") in evmod.REGISTRY and ev.get("source") == "builtin"):
            result = run_builtin(ev["id"], trace_dict, expectation)
        elif etype == "rule":
            cfg = ev.get("config") or {}
            result = run_rule_evaluator(cfg, trace_dict, expectation)
        elif etype == "rubric":
            cfg = ev.get("config") or {}
            result = run_rubric_evaluator(
                cfg, trace_dict, expectation, self.judge_fn, timeout_s=timeout_s
            )
        else:
            result = {
                "status": "error",
                "score": None,
                "verdict": "not_applicable",
                "label": "error",
                "explanation": f"unsupported evaluator type: {etype}",
                "evidence": [],
                "execution_metadata": {},
            }
        result.setdefault("evaluator_id", ev.get("id"))
        result.setdefault("evaluator_version", ev.get("version"))
        result.setdefault("dimension", ev.get("dimension"))
        return result

    def _refresh_run_status(self, run_id: str) -> None:
        jobs = self.db.fetchall(
            "SELECT status, COUNT(*) AS c FROM eval_jobs WHERE run_id=? GROUP BY status", (run_id,)
        )
        by = {j["status"]: j["c"] for j in jobs}
        total = sum(by.values())
        pending = by.get("pending", 0) + by.get("running", 0)
        failed = by.get("error", 0) + by.get("failed", 0)
        completed = by.get("completed", 0) + by.get("skipped", 0)
        if pending > 0:
            status = "running"
            ended = None
        elif failed and completed:
            status = "partial"
            ended = _now()
        elif failed and not completed:
            status = "failed"
            ended = _now()
        else:
            status = "completed"
            ended = _now()
        progress = {
            "total": total,
            "pending": by.get("pending", 0),
            "running": by.get("running", 0),
            "completed": completed,
            "failed": failed,
            "skipped": by.get("skipped", 0),
        }
        if ended:
            self.db.execute(
                "UPDATE eval_runs SET status=?, ended_at=?, progress_json=? WHERE id=?",
                (status, ended, _dumps(progress), run_id),
            )
        else:
            self.db.execute(
                "UPDATE eval_runs SET status=?, progress_json=? WHERE id=?",
                (status, _dumps(progress), run_id),
            )

    def queue_stats(self, project: str | None = None) -> dict[str, int]:
        if project:
            rows = self.db.fetchall(
                "SELECT status, COUNT(*) AS c FROM eval_jobs WHERE project=? GROUP BY status",
                (project,),
            )
        else:
            rows = self.db.fetchall("SELECT status, COUNT(*) AS c FROM eval_jobs GROUP BY status")
        by = {r["status"]: r["c"] for r in rows}
        running = by.get("running", 0)
        if hasattr(self, "worker") and self.worker:
            running = max(running, self.worker.running_count)
        return {
            "depth": by.get("pending", 0),
            "running": running,
            "completed": by.get("completed", 0) + by.get("skipped", 0),
            "failed": by.get("error", 0) + by.get("failed", 0),
        }

    # ================================================================= policies
    def create_policy(self, project: str, body: dict) -> dict:
        self.ensure_project(project)
        name = body.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        pid = body.get("id") or uuid.uuid4().hex
        cfg = {
            "filter": body.get("filter") or {},
            "sample_rate": float(body.get("sample_rate", 1.0)),
            "evaluator_ids": body.get("evaluator_ids") or [],
            "alert": body.get("alert"),
        }
        enabled = 1 if body.get("enabled", True) else 0
        self.db.execute(
            """INSERT INTO online_policies (id, project, name, config_json, enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (pid, project, name, _dumps(cfg), enabled, _now(), _now()),
        )
        return self.get_policy(project, pid)

    def list_policies(self, project: str) -> list[dict]:
        rows = self.db.fetchall(
            "SELECT * FROM online_policies WHERE project=? ORDER BY created_at DESC", (project,)
        )
        return [self._policy_out(r) for r in rows]

    def get_policy(self, project: str, policy_id: str) -> dict:
        row = self.db.fetchone(
            "SELECT * FROM online_policies WHERE id=? AND project=?", (policy_id, project)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Policy not found")
        return self._policy_out(row)

    def update_policy(self, project: str, policy_id: str, body: dict) -> dict:
        cur = self.get_policy(project, policy_id)
        cfg = {
            "filter": body.get("filter", cur["filter"]),
            "sample_rate": float(body.get("sample_rate", cur["sample_rate"])),
            "evaluator_ids": body.get("evaluator_ids", cur["evaluator_ids"]),
            "alert": body.get("alert", cur.get("alert")),
        }
        enabled = cur["enabled"] if body.get("enabled") is None else bool(body.get("enabled"))
        name = body.get("name") or cur["name"]
        self.db.execute(
            """UPDATE online_policies SET name=?, config_json=?, enabled=?, updated_at=?
               WHERE id=? AND project=?""",
            (name, _dumps(cfg), 1 if enabled else 0, _now(), policy_id, project),
        )
        return self.get_policy(project, policy_id)

    def _policy_out(self, row) -> dict:
        cfg = _loads(row["config_json"], {})
        return {
            "id": row["id"],
            "project": row["project"],
            "name": row["name"],
            "filter": cfg.get("filter") or {},
            "sample_rate": float(cfg.get("sample_rate", 1.0)),
            "evaluator_ids": cfg.get("evaluator_ids") or [],
            "alert": cfg.get("alert"),
            "enabled": bool(row["enabled"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"] if "updated_at" in row.keys() else None,
        }

    def on_trace_completed(self, project: str, trace_id: str) -> list[str]:
        """Match enabled policies and enqueue evaluations. Returns run ids."""
        tr = self.get_trace(project, trace_id)
        run_ids = []
        for pol in self.list_policies(project):
            if not pol["enabled"]:
                continue
            flt = pol.get("filter") or {}
            if flt.get("agent") and tr.agent != flt["agent"]:
                continue
            if flt.get("source") and tr.source != flt["source"]:
                continue
            if flt.get("tags"):
                want = set(flt["tags"])
                have = set(tr.tags or [])
                if not want.intersection(have):
                    continue
            if not _stable_sample(trace_id, float(pol.get("sample_rate", 1.0))):
                continue
            eids = pol.get("evaluator_ids") or []
            if not eids:
                continue
            try:
                ev = self.create_evaluation(
                    project, trace_ids=[trace_id], evaluator_ids=eids
                )
                run_ids.append(ev["id"])
                # stash policy id on run config for alerts
                cfg = _loads(
                    self.db.fetchone("SELECT config_json FROM eval_runs WHERE id=?", (ev["id"],))[
                        "config_json"
                    ],
                    {},
                )
                cfg["policy_id"] = pol["id"]
                self.db.execute(
                    "UPDATE eval_runs SET config_json=? WHERE id=?", (_dumps(cfg), ev["id"])
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("policy %s enqueue failed: %s", pol["id"], exc)
        return run_ids

    def _maybe_alert(
        self,
        project: str,
        run_id: str,
        trace_id: str,
        result_id: str,
        result: dict,
        ev_meta: dict,
    ) -> None:
        if result.get("status") != "completed" or result.get("score") is None:
            return
        row = self.db.fetchone("SELECT config_json FROM eval_runs WHERE id=?", (run_id,))
        cfg = _loads(row["config_json"], {}) if row else {}
        policy_id = cfg.get("policy_id")
        if not policy_id:
            return
        try:
            pol = self.get_policy(project, policy_id)
        except HTTPException:
            return
        alert = pol.get("alert")
        if not alert:
            return
        dim = alert.get("dimension")
        eid = alert.get("evaluator_id")
        below = alert.get("below")
        if below is None:
            return
        if dim and ev_meta.get("dimension") != dim:
            return
        if eid and ev_meta.get("id") != eid and result.get("evaluator_id") != eid:
            return
        if float(result["score"]) >= float(below):
            return
        # fire once
        existing = self.db.fetchone(
            "SELECT id FROM alerts WHERE policy_id=? AND result_id=?", (policy_id, result_id)
        )
        if existing:
            return
        aid = uuid.uuid4().hex
        webhook = alert.get("webhook_url")
        wh_status = None
        if webhook:
            try:
                payload = json.dumps(
                    {
                        "alert_id": aid,
                        "policy_id": policy_id,
                        "trace_id": trace_id,
                        "result_id": result_id,
                        "score": result["score"],
                        "threshold": below,
                        "dimension": ev_meta.get("dimension"),
                        "evaluator_id": ev_meta.get("id"),
                    }
                ).encode()
                req = urlrequest.Request(
                    webhook,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urlrequest.urlopen(req, timeout=5) as resp:
                    wh_status = f"ok:{resp.status}"
            except Exception as exc:  # noqa: BLE001
                wh_status = f"error:{exc}"
                log.warning("webhook failed: %s", exc)
        self.db.execute(
            """INSERT INTO alerts
               (id, project, policy_id, trace_id, run_id, result_id, dimension, evaluator_id,
                score, threshold, webhook_url, webhook_status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                aid,
                project,
                policy_id,
                trace_id,
                run_id,
                result_id,
                ev_meta.get("dimension"),
                ev_meta.get("id"),
                result["score"],
                float(below),
                webhook,
                wh_status,
                _now(),
            ),
        )

    def list_alerts(self, project: str) -> list[dict]:
        rows = self.db.fetchall(
            "SELECT * FROM alerts WHERE project=? ORDER BY created_at DESC", (project,)
        )
        return [
            {
                "id": r["id"],
                "policy_id": r["policy_id"],
                "trace_id": r["trace_id"],
                "run_id": r["run_id"],
                "result_id": r["result_id"],
                "dimension": r["dimension"],
                "evaluator_id": r["evaluator_id"],
                "score": r["score"],
                "threshold": r["threshold"],
                "webhook_url": r["webhook_url"],
                "webhook_status": r["webhook_status"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]
