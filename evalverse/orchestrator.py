"""In-process orchestrator: plan variants, run agent/judge jobs, then evaluate."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from . import core
from . import evaluators as ev

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
PERTURBED = OUT / "perturbed"

VARIANT_SPECS = {
    "clean": {"transform": "identity", "params": {}, "seed": 0},
    "blur": {"transform": "gaussian_blur", "params": {"r": 5}, "seed": 0},
    "noise": {"transform": "gaussian_noise", "params": {"sigma": 70}, "seed": 0},
    "lowres": {"transform": "downscale", "params": {"factor": 0.16}, "seed": 0},
    "blind": {"transform": "remove_media", "params": {}, "seed": 0},
    "bandlimit": {"transform": "fft_bandpass", "params": {"low_hz": 300, "high_hz": 3400}, "seed": 0},
}


@dataclass
class Job:
    id: str
    kind: str  # agent | judge | judge_control
    agent: str | None
    case_id: str
    variant: str
    status: str = "pending"  # pending|running|completed|failed
    retries: int = 0
    error: str | None = None
    payload: dict = field(default_factory=dict)


def perturbed_path(case: dict, condition: str) -> Path:
    return PERTURBED / f"{case['id']}_{condition}.png"


def prepare_images(cases, conditions):
    PERTURBED.mkdir(parents=True, exist_ok=True)
    for c in cases:
        img = Image.open(ROOT / c["image"])
        for cond in conditions:
            if cond == "blind":
                continue
            core.perturb(img, cond).save(perturbed_path(c, cond))


def image_bytes(case, condition):
    return perturbed_path(case, condition).read_bytes()


def score_agent_output(case, raw):
    parsed = core.parse_json(raw)
    valid = parsed is not None and "answer" in parsed
    if valid:
        ans = parsed.get("answer", "")
        if isinstance(ans, (dict, list)):
            answer = json.dumps(ans, ensure_ascii=False)
        else:
            answer = str(ans)
    else:
        answer = ""
    box = core.clean_box(parsed.get("box")) if valid else None
    correct = core.answer_correct(case, answer)
    truth_box = case.get("truth_box")
    ev_ok = core.evidence_ok(truth_box, box) if truth_box else False
    if case.get("family") in ("menu_list", "unanswerable"):
        label = _list_stage_label(case, answer, box, valid, correct)
    else:
        label = core.attribute(correct, ev_ok, valid, answer=answer, box=box)
    return {
        "answer": answer,
        "box": box,
        "evidence": str(parsed.get("evidence", ""))[:300] if valid else "",
        "correct": correct,
        "evidence_ok": ev_ok,
        "iou": round(core.iou(truth_box, box), 3) if box and truth_box else 0.0,
        "label": label,
    }


def _list_stage_label(case, answer, box, valid, correct):
    if not valid:
        return "invalid_output"
    if case.get("family") == "unanswerable":
        tok = core._txt(answer)
        if tok in ("notshown", "unknown", "none"):
            return "abstained_correctly"
        if core._amount(answer) is not None:
            return "fabricated"
        return "fabricated"
    # menu_list
    pred_items = core.parse_menu_answer(answer)
    if pred_items is None:
        return "invalid_output"
    _m, missing, fabricated = core.match_menu_items(pred_items, case.get("menu") or [])
    if fabricated:
        return "fabricated"
    if missing:
        return "incomplete"
    return "complete_correct"


def _git_commit() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, stderr=subprocess.DEVNULL, text=True
        )
        return out.strip() or "unknown"
    except Exception:
        return "unknown"


def _sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_manifest(
    *,
    dataset_path: str,
    agents: list[str],
    judge_model: str,
    variants: list[str],
    mock: bool,
    total_calls: int,
    token_totals: dict,
    judge_controls: bool = False,
) -> dict:
    ds = ROOT / dataset_path
    variant_rows = []
    for name in variants + (["blind"] if "blind" not in variants else []):
        spec = VARIANT_SPECS.get(name, {"transform": name, "params": {}, "seed": 0})
        variant_rows.append(
            {"name": name, "transform": spec["transform"], "params": spec["params"], "seed": spec["seed"]}
        )
    return {
        "dataset": {"path": dataset_path, "sha256": _sha256_file(ds)},
        "evaluator_versions": {eid: meta["version"] for eid, meta in ev.REGISTRY.items()},
        "agents": list(agents),
        "judge": judge_model,
        "variants": variant_rows,
        "python_version": sys.version.split()[0],
        "git_commit": _git_commit(),
        "agent_prompt_sha256": _sha256_text(core.AGENT_PROMPT),
        "judge_prompt_sha256": _sha256_text(core.JUDGE_PROMPT),
        "judge_prompt_no_media_sha256": _sha256_text(core.JUDGE_PROMPT_NO_MEDIA),
        "utc_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mock": bool(mock),
        "judge_controls": bool(judge_controls),
        "total_calls": int(total_calls),
        "token_totals": token_totals,
    }


def _sum_usage(runs: list[dict]) -> dict:
    totals = {"input_tokens": 0, "output_tokens": 0, "reasoning_tokens": 0}
    for r in runs:
        u = r.get("usage") or {}
        if not isinstance(u, dict):
            continue
        for k in totals:
            v = u.get(k)
            if isinstance(v, (int, float)):
                totals[k] += int(v)
    return totals


class Orchestrator:
    """Plans item × agent × variant jobs, executes them, then evaluates offline."""

    def __init__(self, cases, agents, variants, backend, judge_model, config: dict | None = None):
        self.cases = cases
        self.agents = list(agents)
        self.variants = list(variants)
        self.backend = backend
        self.judge_model = judge_model
        self.config = dict(config or {})
        self.by_id = {c["id"]: c for c in cases}
        self.jobs: list[Job] = []
        self.runs: list[dict] = []
        self.judged: list[dict] = []
        self.max_retries = int(self.config.get("max_retries", 2))

    def plan(self) -> list[Job]:
        jobs: list[Job] = []
        variants_plus = list(self.variants)
        if "blind" not in variants_plus:
            variants_plus = variants_plus + ["blind"]

        for agent in self.agents:
            for case in self.cases:
                for variant in variants_plus:
                    jobs.append(
                        Job(
                            id=f"agent|{agent}|{case['id']}|{variant}",
                            kind="agent",
                            agent=agent,
                            case_id=case["id"],
                            variant=variant,
                        )
                    )

        # Judge jobs are planned after agent runs produce answers; placeholders for planted.
        for case in self.cases:
            jobs.append(
                Job(
                    id=f"judge|planted_right|{case['id']}",
                    kind="judge",
                    agent=None,
                    case_id=case["id"],
                    variant="clean",
                    payload={"judge_kind": "planted_right", "proposed": case["answer"]},
                )
            )
            jobs.append(
                Job(
                    id=f"judge|planted_wrong|{case['id']}",
                    kind="judge",
                    agent=None,
                    case_id=case["id"],
                    variant="clean",
                    payload={"judge_kind": "planted_wrong", "proposed": case["distractor"]},
                )
            )
            if self.config.get("judge_controls"):
                jobs.append(
                    Job(
                        id=f"judge_control|planted_right_noimg|{case['id']}",
                        kind="judge_control",
                        agent=None,
                        case_id=case["id"],
                        variant="blind",
                        payload={"judge_kind": "planted_right_noimg", "proposed": case["answer"]},
                    )
                )
                jobs.append(
                    Job(
                        id=f"judge_control|planted_wrong_noimg|{case['id']}",
                        kind="judge_control",
                        agent=None,
                        case_id=case["id"],
                        variant="blind",
                        payload={"judge_kind": "planted_wrong_noimg", "proposed": case["distractor"]},
                    )
                )

        self.jobs = jobs
        return jobs

    def select_evaluators(self, case: dict):
        return ev.select_evaluators_for_case(case)

    def _judge_record(self, kind: str, case: dict, proposed: str, agent: str | None, with_image: bool):
        try:
            png = image_bytes(case, "clean") if with_image else None
            raw = self.backend.judge(self.judge_model, case, proposed, png)
            parsed = core.parse_json(raw) or {}
            verdict = str(parsed.get("verdict", "")).lower()
            accepted = verdict == "correct"
        except Exception as e:
            accepted = None
        truth = core.answer_correct(case, proposed)
        return {
            "kind": kind,
            "agent": agent,
            "case_id": case["id"],
            "proposed": proposed,
            "judge_accepts": accepted,
            "truth_correct": truth,
            "agrees": (accepted == truth) if accepted is not None else None,
        }

    def _run_agent_job(self, job: Job) -> dict:
        case = self.by_id[job.case_id]
        agent = job.agent
        condition = job.variant
        prompt = core.AGENT_PROMPT.format(question=case["question"])
        last_err = None
        for attempt in range(self.max_retries + 1):
            job.retries = attempt
            job.status = "running"
            try:
                png = None if condition == "blind" else image_bytes(case, condition)
                raw, latency, usage = self.backend.agent(agent, case, png, condition)
                rec = score_agent_output(case, raw)
                rec.update(
                    latency=round(latency, 2),
                    error=None,
                    model=agent,
                    prompt=prompt,
                    raw=(raw or "")[:4000],
                    usage=usage,
                    agent=agent,
                    case_id=case["id"],
                    condition=condition,
                )
                job.status = "completed"
                job.error = None
                return rec
            except Exception as e:
                last_err = e
                job.error = str(e)[:200]
                time.sleep(0.01 * (attempt + 1))
        job.status = "failed"
        return {
            "answer": "",
            "box": None,
            "evidence": "",
            "correct": False,
            "evidence_ok": False,
            "iou": 0.0,
            "label": "invalid_output",
            "latency": 0,
            "error": str(last_err)[:200] if last_err else "failed",
            "model": agent,
            "prompt": prompt,
            "raw": "",
            "usage": None,
            "agent": agent,
            "case_id": case["id"],
            "condition": condition,
        }

    def _run_judge_job(self, job: Job) -> dict:
        case = self.by_id[job.case_id]
        kind = job.payload["judge_kind"]
        proposed = job.payload["proposed"]
        agent = job.payload.get("agent")
        with_image = job.kind != "judge_control"
        last_err = None
        for attempt in range(self.max_retries + 1):
            job.retries = attempt
            job.status = "running"
            try:
                rec = self._judge_record(kind, case, proposed, agent, with_image=with_image)
                job.status = "completed"
                job.error = None
                return rec
            except Exception as e:
                last_err = e
                job.error = str(e)[:200]
                time.sleep(0.01 * (attempt + 1))
        job.status = "failed"
        truth = core.answer_correct(case, proposed)
        return {
            "kind": kind,
            "agent": agent,
            "case_id": case["id"],
            "proposed": proposed,
            "judge_accepts": None,
            "truth_correct": truth,
            "agrees": None,
            "error": str(last_err)[:200] if last_err else "failed",
        }

    def run(self, workers: int = 8) -> tuple[list[dict], list[dict], list[dict]]:
        if not self.jobs:
            self.plan()

        prepare_images(self.cases, sorted(set(self.variants) | {"clean"}))

        agent_jobs = [j for j in self.jobs if j.kind == "agent"]
        print(f"agent calls: {len(agent_jobs)}")
        runs: list[dict] = []
        with ThreadPoolExecutor(workers) as ex:
            futs = {ex.submit(self._run_agent_job, j): j for j in agent_jobs}
            for fut in as_completed(futs):
                runs.append(fut.result())
        self.runs = runs

        # Plan judge jobs for each clean agent answer (dynamic, after agent runs).
        judge_jobs = [j for j in self.jobs if j.kind in ("judge", "judge_control")]
        for r in runs:
            if r["condition"] == "clean" and r.get("answer"):
                j = Job(
                    id=f"judge|agent_answer|{r['agent']}|{r['case_id']}",
                    kind="judge",
                    agent=r["agent"],
                    case_id=r["case_id"],
                    variant="clean",
                    payload={
                        "judge_kind": "agent_answer",
                        "proposed": r["answer"],
                        "agent": r["agent"],
                    },
                )
                judge_jobs.append(j)
                self.jobs.append(j)

        print(f"judge calls: {len(judge_jobs)}")
        judged: list[dict] = []
        with ThreadPoolExecutor(workers) as ex:
            futs = {ex.submit(self._run_judge_job, j): j for j in judge_jobs}
            for fut in as_completed(futs):
                judged.append(fut.result())
        self.judged = judged
        return runs, judged, [self._job_public(j) for j in self.jobs]

    @staticmethod
    def _job_public(job: Job) -> dict:
        return {
            "id": job.id,
            "kind": job.kind,
            "agent": job.agent,
            "case_id": job.case_id,
            "variant": job.variant,
            "status": job.status,
            "retries": job.retries,
            "error": job.error,
        }

    def evaluate(self, evidence_margin: float | None = None):
        margin = (
            ev.DEFAULT_EVIDENCE_MARGIN if evidence_margin is None else float(evidence_margin)
        )
        ev.relabel_runs(self.cases, self.runs, margin=margin)
        return ev.evaluate_all(
            self.cases,
            self.runs,
            self.judged,
            self.agents,
            evidence_margin=margin,
            judge_model=self.judge_model,
        )

    def execute(self, workers: int = 8) -> dict[str, Any]:
        t0 = time.time()
        self.plan()
        runs, judged, plan = self.run(workers=workers)
        margin = float(self.config.get("evidence_margin", ev.DEFAULT_EVIDENCE_MARGIN))
        results, dimension_summary, disagreements, conflicts = self.evaluate(evidence_margin=margin)
        traces = ev.build_traces(self.cases, runs, results)
        ev.write_traces(traces)
        token_totals = _sum_usage(runs)
        total_calls = len([j for j in self.jobs if j.kind == "agent"]) + len(
            [j for j in self.jobs if j.kind in ("judge", "judge_control")]
        )
        manifest = build_manifest(
            dataset_path=self.config.get("dataset_path", "data/cases.json"),
            agents=self.agents,
            judge_model=self.judge_model,
            variants=self.variants,
            mock=bool(self.config.get("mock")),
            total_calls=total_calls,
            token_totals=token_totals,
            judge_controls=bool(self.config.get("judge_controls")),
        )
        return {
            "meta": {
                "agents": self.agents,
                "judge": self.judge_model,
                "conditions": self.variants,
                "mock": bool(self.config.get("mock")),
                "evidence_margin": margin,
                "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "seconds": round(time.time() - t0, 1),
                "manifest": manifest,
            },
            "cases": self.cases,
            "runs": runs,
            "judged": judged,
            "results": results,
            "dimension_summary": dimension_summary,
            "disagreements": disagreements,
            "conflicts": conflicts,
            "registry": ev.registry_list(),
            "traces": traces,
            "plan": plan,
        }
