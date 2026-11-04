"""Experiments, compare, human review, and calibration."""

from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from evalverse import core
from evalverse import evaluators as evmod
from evalverse.orchestrator import Orchestrator
from evalverse.providers.registry import resolve_model_ref


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dumps(obj: Any) -> str | None:
    if obj is None:
        return None
    return json.dumps(obj, default=str)


def _loads(raw: str | None, default: Any = None) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def dataset_items_to_cases(service, project: str, version_id: str) -> list[dict]:
    rows = service.db.fetchall(
        "SELECT * FROM dataset_items WHERE version_id=? ORDER BY created_at ASC",
        (version_id,),
    )
    cases = []
    for row in rows:
        item = service._item_out(row)
        inp = item.get("input") or {}
        exp = item.get("expectation") or {}
        question = None
        if isinstance(inp, dict):
            question = inp.get("question") or inp.get("text")
            if question is None and isinstance(inp.get("text"), str):
                question = inp["text"]
        image = None
        media_ids = (inp.get("media_ids") if isinstance(inp, dict) else None) or []
        for mid in media_ids:
            m = service.db.fetchone(
                "SELECT * FROM media WHERE id=? AND project=?", (mid, project)
            )
            if m and m["path"]:
                image = m["path"]
                break
        truth_box = None
        evidence = exp.get("evidence") if isinstance(exp, dict) else None
        if isinstance(evidence, dict) and evidence.get("type") == "image_region":
            truth_box = evidence.get("locator")
        elif isinstance(evidence, list):
            for e in evidence:
                if isinstance(e, dict) and e.get("type") == "image_region":
                    truth_box = e.get("locator")
                    break
        case = {
            "id": item["id"],
            "question": question or "What is the answer?",
            "answer": (exp or {}).get("answer"),
            "answer_type": (exp or {}).get("answer_type") or "number",
            "distractor": (exp or {}).get("distractor") or "0",
            "truth_box": truth_box,
            "family": (exp or {}).get("family") or "receipt",
            "image": image,
            "tags": item.get("tags") or [],
        }
        if (exp or {}).get("menu") is not None:
            case["menu"] = exp["menu"]
        cases.append(case)
    return cases


class ExperimentsMixin:
    def create_experiment(self, project: str, body: dict) -> dict:
        self.ensure_project(project)
        name = body.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="name required")
        eid = body.get("id") or uuid.uuid4().hex
        cfg = {
            "dataset_version_id": body.get("dataset_version_id"),
            "agents": body.get("agents") or [],
            "variants": body.get("variants") or ["clean"],
            "evaluator_ids": body.get("evaluator_ids") or [],
            "judge_model": body.get("judge_model") or "muse-spark-1.3",
            "mock": bool(body.get("mock", False)),
        }
        if not cfg["dataset_version_id"]:
            raise HTTPException(status_code=400, detail="dataset_version_id required")
        self.lock_dataset_version(cfg["dataset_version_id"])
        self.db.execute(
            """INSERT INTO experiments (id, project, name, config_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (eid, project, name, _dumps(cfg), _now()),
        )
        return self.get_experiment(project, eid)

    def list_experiments(self, project: str) -> list[dict]:
        rows = self.db.fetchall(
            "SELECT * FROM experiments WHERE project=? ORDER BY created_at DESC", (project,)
        )
        return [self._experiment_out(r) for r in rows]

    def get_experiment(self, project: str, experiment_id: str) -> dict:
        row = self.db.fetchone(
            "SELECT * FROM experiments WHERE id=? AND project=?", (experiment_id, project)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Experiment not found")
        out = self._experiment_out(row)
        runs = self.db.fetchall(
            "SELECT * FROM experiment_runs WHERE experiment_id=? ORDER BY created_at ASC",
            (experiment_id,),
        )
        out["runs"] = [self._experiment_run_out(r) for r in runs]
        return out

    def run_experiment(self, project: str, experiment_id: str, *, mock: bool | None = None) -> dict:
        exp = self.get_experiment(project, experiment_id)
        cfg = exp["config"]
        use_mock = cfg.get("mock") if mock is None else mock
        cases = dataset_items_to_cases(self, project, cfg["dataset_version_id"])
        if not cases:
            raise HTTPException(status_code=400, detail="dataset version has no items")

        # Ensure synthetic images exist for cases without files (draw blank for mock).
        from PIL import Image

        for c in cases:
            if not c.get("image") or not Path(str(c["image"])).is_file():
                tmp = Path(self.media_dir) / project / f"exp_{c['id']}.png"
                tmp.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (64, 64), color=(240, 240, 240)).save(tmp)
                c["image"] = str(tmp)

        if use_mock:
            backend = core.MockBackend(seed=0)
        else:
            backend = core.LiveBackend()

        created_runs = []
        agents = cfg.get("agents") or []
        variants = cfg.get("variants") or ["clean"]
        judge = cfg.get("judge_model") or "muse-spark-1.3"
        # Strip provider prefix for orchestrator model ids
        judge_model = resolve_model_ref(judge)[1] if ":" in str(judge) else judge

        for agent_spec in agents:
            if isinstance(agent_spec, str):
                agent_name = agent_spec
                model = resolve_model_ref(agent_spec)[1] if ":" in agent_spec else agent_spec
            else:
                agent_name = agent_spec.get("name") or agent_spec.get("model")
                model_ref = agent_spec.get("model") or agent_name
                model = resolve_model_ref(model_ref)[1] if ":" in str(model_ref) else model_ref
            for variant in variants:
                orch = Orchestrator(
                    cases,
                    [model],
                    [variant],
                    backend,
                    judge_model,
                    config={
                        "mock": use_mock,
                        "dataset_path": f"dataset_version:{cfg['dataset_version_id']}",
                        "judge_controls": False,
                        "evidence_margin": evmod.DEFAULT_EVIDENCE_MARGIN,
                    },
                )
                # Limit agent variants to the requested one (still adds blind in plan —
                # override variants list after plan for a tighter experiment run).
                payload = orch.execute(workers=2)
                # Filter runs to requested variant only for storage focus
                runs = [r for r in payload["runs"] if r.get("condition") == variant]
                results = [
                    r
                    for r in payload["results"]
                    if (r.get("target") or {}).get("variant") == variant
                    or (r.get("target") or {}).get("variant") == "all"
                ]

                eval_run_id = uuid.uuid4().hex
                self.db.execute(
                    """INSERT INTO eval_runs
                       (id, project, name, status, config_json, created_at, ended_at, progress_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        eval_run_id,
                        project,
                        f"exp:{experiment_id}:{agent_name}:{variant}",
                        "completed",
                        _dumps(
                            {
                                "experiment_id": experiment_id,
                                "agent": agent_name,
                                "model": model,
                                "variant": variant,
                                "manifest": (payload.get("meta") or {}).get("manifest"),
                            }
                        ),
                        _now(),
                        _now(),
                        _dumps({"total": len(results), "completed": len(results)}),
                    ),
                )
                for res in results:
                    rid = res.get("id") or uuid.uuid4().hex
                    # Bind to a synthetic trace id agent|case|variant
                    target = res.get("target") or {}
                    tid = f"{target.get('agent')}|{target.get('case_id')}|{target.get('variant')}"
                    # Ensure a lightweight trace exists for linking
                    if not self.db.fetchone("SELECT id FROM traces WHERE id=?", (tid,)):
                        from evalverse.server.schemas import TraceCreate

                        self.create_trace(
                            project,
                            TraceCreate(
                                id=tid,
                                name=tid,
                                agent=str(target.get("agent")),
                                status="completed",
                                source="sdk",
                                metadata={
                                    "case_id": target.get("case_id"),
                                    "variant": target.get("variant"),
                                    "expectation": next(
                                        (
                                            {
                                                "answer": c.get("answer"),
                                                "answer_type": c.get("answer_type"),
                                                "evidence": {
                                                    "type": "image_region",
                                                    "locator": c.get("truth_box"),
                                                }
                                                if c.get("truth_box")
                                                else None,
                                            }
                                            for c in cases
                                            if c["id"] == target.get("case_id")
                                        ),
                                        None,
                                    ),
                                    "experiment_id": experiment_id,
                                },
                                tags=["experiment"],
                            ),
                        )
                    before = self.db.fetchone("SELECT id FROM eval_results WHERE id=?", (rid,))
                    if before is None:
                        self.upsert_eval_result(
                            project=project,
                            run_id=eval_run_id,
                            result_id=rid,
                            trace_id=tid,
                            evaluator_id=res.get("evaluator_id"),
                            evaluator_version=res.get("evaluator_version"),
                            dimension=res.get("dimension"),
                            status=res.get("status"),
                            score=res.get("score"),
                            verdict=res.get("verdict"),
                            label=res.get("label"),
                            explanation=res.get("explanation"),
                            evidence=res.get("evidence"),
                            meta=res.get("execution_metadata"),
                        )

                erid = uuid.uuid4().hex
                self.db.execute(
                    """INSERT INTO experiment_runs
                       (id, experiment_id, agent, variant, eval_run_id, manifest_json, status, created_at, ended_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        erid,
                        experiment_id,
                        agent_name,
                        variant,
                        eval_run_id,
                        _dumps((payload.get("meta") or {}).get("manifest")),
                        "completed",
                        _now(),
                        _now(),
                    ),
                )
                created_runs.append(self._experiment_run_out(
                    self.db.fetchone("SELECT * FROM experiment_runs WHERE id=?", (erid,))
                ))

        return {"experiment_id": experiment_id, "runs": created_runs}

    def compare_experiment_runs(self, project: str, experiment_id: str, a: str, b: str) -> dict:
        exp = self.get_experiment(project, experiment_id)
        run_ids = {r["id"]: r for r in exp.get("runs") or []}
        # Allow comparing by experiment_run id or eval_run id
        def _resolve(key: str) -> dict:
            if key in run_ids:
                return run_ids[key]
            for r in run_ids.values():
                if r.get("eval_run_id") == key:
                    return r
            raise HTTPException(status_code=404, detail=f"run not found: {key}")

        ra, rb = _resolve(a), _resolve(b)
        res_a = self.db.fetchall(
            "SELECT * FROM eval_results WHERE run_id=?", (ra["eval_run_id"],)
        )
        res_b = self.db.fetchall(
            "SELECT * FROM eval_results WHERE run_id=?", (rb["eval_run_id"],)
        )

        def _index(rows):
            out = {}
            for r in rows:
                # key by case (from trace_id) + evaluator
                tid = r["trace_id"] or ""
                parts = tid.split("|")
                case_id = parts[1] if len(parts) >= 2 else tid
                out[(case_id, r["evaluator_id"], r["dimension"])] = r
            return out

        ia, ib = _index(res_a), _index(res_b)
        keys = sorted(set(ia) | set(ib))

        dim_scores_a: dict[str, list[float]] = {}
        dim_scores_b: dict[str, list[float]] = {}
        case_changes = []
        regressions = []
        improvements = []

        degraded_labels = {
            "grounded_correct": 0,
            "correct_ungrounded": 1,
            "misread": 2,
            "mislocated": 3,
            "invalid_output": 4,
            "pass": 0,
            "fail": 1,
            "correct": 0,
            "incorrect": 1,
        }

        for key in keys:
            case_id, eid, dim = key
            a_row, b_row = ia.get(key), ib.get(key)
            sa = a_row["score"] if a_row and a_row["score"] is not None else None
            sb = b_row["score"] if b_row and b_row["score"] is not None else None
            la = a_row["label"] if a_row else None
            lb = b_row["label"] if b_row else None
            if sa is not None:
                dim_scores_a.setdefault(dim or "unknown", []).append(float(sa))
            if sb is not None:
                dim_scores_b.setdefault(dim or "unknown", []).append(float(sb))
            if sa is not None and sb is not None:
                delta = float(sb) - float(sa)
                change = {
                    "case_id": case_id,
                    "evaluator_id": eid,
                    "dimension": dim,
                    "score_a": sa,
                    "score_b": sb,
                    "delta": delta,
                    "label_a": la,
                    "label_b": lb,
                }
                if la != lb or abs(delta) > 1e-9:
                    case_changes.append(change)
                label_degraded = False
                if la and lb:
                    label_degraded = degraded_labels.get(str(lb), 0) > degraded_labels.get(str(la), 0)
                if delta < -0.1 or label_degraded:
                    regressions.append(change)
                elif delta > 0.1 or (
                    la and lb and degraded_labels.get(str(lb), 0) < degraded_labels.get(str(la), 0)
                ):
                    improvements.append(change)

        def _mean(xs):
            return sum(xs) / len(xs) if xs else None

        dims = sorted(set(dim_scores_a) | set(dim_scores_b))
        dimension_deltas = []
        for d in dims:
            ma, mb = _mean(dim_scores_a.get(d, [])), _mean(dim_scores_b.get(d, []))
            dimension_deltas.append(
                {
                    "dimension": d,
                    "mean_a": ma,
                    "mean_b": mb,
                    "delta": (None if ma is None or mb is None else mb - ma),
                }
            )

        return {
            "experiment_id": experiment_id,
            "a": ra,
            "b": rb,
            "dimension_deltas": dimension_deltas,
            "case_changes": case_changes,
            "regressions": regressions,
            "improvements": improvements,
        }

    def _experiment_out(self, row) -> dict:
        return {
            "id": row["id"],
            "project": row["project"],
            "name": row["name"],
            "config": _loads(row["config_json"], {}),
            "created_at": row["created_at"],
        }

    def _experiment_run_out(self, row) -> dict:
        return {
            "id": row["id"],
            "experiment_id": row["experiment_id"],
            "agent": row["agent"],
            "variant": row["variant"],
            "eval_run_id": row["eval_run_id"],
            "manifest": _loads(row["manifest_json"]),
            "status": row["status"],
            "created_at": row["created_at"],
            "ended_at": row["ended_at"],
        }


# --------------------------------------------------------------------------- reviews / calibration

def cohens_kappa(confusion: dict[tuple[str, str], int]) -> float:
    """Cohen's kappa from confusion counts keyed by (evaluator_verdict, human_verdict)."""
    labels = sorted({k[0] for k in confusion} | {k[1] for k in confusion})
    if not labels:
        return 0.0
    n = sum(confusion.values())
    if n == 0:
        return 0.0
    # po
    agree = sum(confusion.get((l, l), 0) for l in labels)
    po = agree / n
    # pe
    pe = 0.0
    for l in labels:
        row = sum(confusion.get((l, c), 0) for c in labels) / n
        col = sum(confusion.get((r, l), 0) for r in labels) / n
        pe += row * col
    if abs(1 - pe) < 1e-12:
        return 1.0 if po == 1.0 else 0.0
    return (po - pe) / (1 - pe)


class ReviewsMixin:
    def create_review(self, project: str, body: dict) -> dict:
        self.ensure_project(project)
        result_id = body.get("result_id")
        if not result_id:
            raise HTTPException(status_code=400, detail="result_id required")
        verdict = body.get("verdict")
        if verdict not in ("pass", "fail"):
            raise HTTPException(status_code=400, detail="verdict must be pass|fail")
        rid = uuid.uuid4().hex
        self.db.execute(
            """INSERT INTO reviews
               (id, project, result_id, verdict, label, notes, reviewer, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                rid,
                project,
                result_id,
                verdict,
                body.get("label"),
                body.get("notes"),
                body.get("reviewer") or "anonymous",
                _now(),
            ),
        )
        return self._review_out(self.db.fetchone("SELECT * FROM reviews WHERE id=?", (rid,)))

    def review_queue(self, project: str) -> list[dict]:
        """Prioritised results needing human review."""
        rows = self.db.fetchall(
            """SELECT r.* FROM eval_results r
               JOIN eval_runs er ON er.id = r.run_id
               WHERE er.project = ?
               ORDER BY r.created_at DESC LIMIT 500""",
            (project,),
        )
        reviewed = {
            x["result_id"]
            for x in self.db.fetchall(
                "SELECT DISTINCT result_id FROM reviews WHERE project=?", (project,)
            )
        }
        # Group by trace for disagreement detection
        by_trace: dict[str, list] = {}
        for r in rows:
            by_trace.setdefault(r["trace_id"] or "", []).append(r)

        queue = []
        for r in rows:
            if r["id"] in reviewed:
                continue
            priority = 0
            reasons = []
            if r["status"] == "error":
                priority += 100
                reasons.append("error")
            meta = _loads(r["meta_json"], {}) or {}
            conf = meta.get("confidence")
            if conf is not None and float(conf) < 0.55:
                priority += 40
                reasons.append("low_confidence")
            if r["score"] is not None and 0.4 <= float(r["score"]) <= 0.6:
                priority += 20
                reasons.append("borderline_score")
            # judge vs deterministic disagreement on same trace
            siblings = by_trace.get(r["trace_id"] or "", [])
            cats = {(s["evaluator_id"], s["verdict"]) for s in siblings if s["verdict"]}
            verdicts = {s["verdict"] for s in siblings if s["status"] == "completed" and s["verdict"]}
            if len(verdicts) > 1:
                priority += 60
                reasons.append("judge_vs_deterministic_disagreement")
            if not reasons:
                continue
            queue.append(
                {
                    "result": {
                        "id": r["id"],
                        "trace_id": r["trace_id"],
                        "evaluator_id": r["evaluator_id"],
                        "dimension": r["dimension"],
                        "status": r["status"],
                        "score": r["score"],
                        "verdict": r["verdict"],
                        "label": r["label"],
                        "explanation": r["explanation"],
                    },
                    "priority": priority,
                    "reasons": reasons,
                }
            )
        queue.sort(key=lambda x: -x["priority"])
        return queue

    def calibration(self, project: str, evaluator_id: str) -> dict:
        rows = self.db.fetchall(
            """SELECT r.verdict AS ev_verdict, rv.verdict AS human_verdict
               FROM reviews rv
               JOIN eval_results r ON r.id = rv.result_id
               WHERE rv.project=? AND r.evaluator_id=?""",
            (project, evaluator_id),
        )
        confusion: dict[tuple[str, str], int] = {}
        for row in rows:
            ev = str(row["ev_verdict"] or "")
            hu = str(row["human_verdict"] or "")
            confusion[(ev, hu)] = confusion.get((ev, hu), 0) + 1
        n = sum(confusion.values())
        agree = sum(v for (a, b), v in confusion.items() if a == b)
        agreement_rate = (agree / n) if n else None
        # nested confusion matrix
        labels = sorted({k[0] for k in confusion} | {k[1] for k in confusion})
        matrix = {a: {b: confusion.get((a, b), 0) for b in labels} for a in labels}
        return {
            "evaluator_id": evaluator_id,
            "n": n,
            "agreement_rate": agreement_rate,
            "cohens_kappa": cohens_kappa(confusion) if n else None,
            "confusion": matrix,
            "labels": labels,
        }

    def _review_out(self, row) -> dict:
        return {
            "id": row["id"],
            "project": row["project"],
            "result_id": row["result_id"],
            "verdict": row["verdict"],
            "label": row["label"],
            "notes": row["notes"],
            "reviewer": row["reviewer"],
            "created_at": row["created_at"],
        }
