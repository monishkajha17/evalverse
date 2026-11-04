"""Run a EvalVerse evaluation.

    python -m evalverse.run --agents muse-spark-1.1,muse-spark-1.3 --judge muse-spark-1.3
    python -m evalverse.run --mock                      # offline smoke test, no API key
    python -m evalverse.run --limit 3 --conditions clean  # cheap first real call

Writes out/results.json. Then: python -m evalverse.report
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from . import core
from . import evaluators as ev

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def load_cases(limit=None, path="data/cases.json"):
    cases = json.loads((ROOT / path).read_text())
    return cases[:limit] if limit else cases


PERTURBED = OUT / "perturbed"


def perturbed_path(case, condition):
    return PERTURBED / f"{case['id']}_{condition}.png"


def prepare_images(cases, conditions):
    """Render every perturbed variant once, up front, and keep it on disk so the
    report can show exactly the pixels each agent was given."""
    PERTURBED.mkdir(parents=True, exist_ok=True)
    for c in cases:
        img = Image.open(ROOT / c["image"])
        for cond in conditions:
            core.perturb(img, cond).save(perturbed_path(c, cond))


def image_bytes(case, condition):
    return perturbed_path(case, condition).read_bytes()


def score_agent_output(case, raw):
    parsed = core.parse_json(raw)
    valid = parsed is not None and "answer" in parsed
    answer = str(parsed.get("answer", "")) if valid else ""
    box = core.clean_box(parsed.get("box")) if valid else None
    correct = core.answer_correct(case, answer)
    ev_ok = core.evidence_ok(case["truth_box"], box)
    return {
        "answer": answer,
        "box": box,
        "evidence": str(parsed.get("evidence", ""))[:300] if valid else "",
        "correct": correct,
        "evidence_ok": ev_ok,
        "iou": round(core.iou(case["truth_box"], box), 3) if box else 0.0,
        "label": core.attribute(correct, ev_ok, valid, answer=answer, box=box),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents", default="muse-spark-1.1,muse-spark-1.3")
    ap.add_argument("--judge", default="muse-spark-1.3")
    ap.add_argument("--conditions", default="clean,blur,noise,lowres")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--cases", default="data/cases.json", help="dataset file, e.g. data/cases_cord.json")
    ap.add_argument("--tag", default="", help="name for this suite; writes out/results_<tag>.json")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--mock", action="store_true")
    args = ap.parse_args()

    backend = core.MockBackend() if args.mock else core.LiveBackend()
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    cases = load_cases(args.limit, args.cases)
    by_id = {c["id"]: c for c in cases}
    t0 = time.time()
    prepare_images(cases, sorted(set(conditions) | {"clean"}))

    # ---- 1. agent runs (with image, per condition) + blind runs (no image)
    def agent_task(agent, case, condition):
        prompt = core.AGENT_PROMPT.format(question=case["question"])
        try:
            png = None if condition == "blind" else image_bytes(case, condition)
            raw, latency, usage = backend.agent(agent, case, png, condition)
            rec = score_agent_output(case, raw)
            rec.update(
                latency=round(latency, 2),
                error=None,
                model=agent,
                prompt=prompt,
                raw=(raw or "")[:4000],
                usage=usage,
            )
        except Exception as e:  # keep going; the report shows errors
            rec = {
                "answer": "",
                "box": None,
                "evidence": "",
                "correct": False,
                "evidence_ok": False,
                "iou": 0.0,
                "label": "invalid_output",
                "latency": 0,
                "error": str(e)[:200],
                "model": agent,
                "prompt": prompt,
                "raw": "",
                "usage": None,
            }
        rec.update(agent=agent, case_id=case["id"], condition=condition)
        return rec

    jobs = [(a, c, cond) for a in agents for c in cases for cond in conditions + ["blind"]]
    print(f"agent calls: {len(jobs)}")
    with ThreadPoolExecutor(args.workers) as ex:
        runs = list(ex.map(lambda j: agent_task(*j), jobs))

    # ---- 2. judge on each agent's clean answers (judge sees the image, not the truth)
    def judge_task(kind, case, proposed, agent=None):
        try:
            raw = backend.judge(args.judge, case, proposed, image_bytes(case, "clean"))
            parsed = core.parse_json(raw) or {}
            verdict = str(parsed.get("verdict", "")).lower()
            accepted = verdict == "correct"
        except Exception as e:
            accepted, verdict = None, f"error: {e}"[:80]
        truth = core.answer_correct(case, proposed)
        return {"kind": kind, "agent": agent, "case_id": case["id"], "proposed": proposed,
                "judge_accepts": accepted, "truth_correct": truth,
                "agrees": (accepted == truth) if accepted is not None else None}

    j_jobs = []
    for r in runs:
        if r["condition"] == "clean" and r["answer"]:
            j_jobs.append(("agent_answer", by_id[r["case_id"]], r["answer"], r["agent"]))
    # ---- 3. judge audit: planted RIGHT and planted WRONG answers with known truth
    for c in cases:
        j_jobs.append(("planted_right", c, c["answer"], None))
        j_jobs.append(("planted_wrong", c, c["distractor"], None))
    print(f"judge calls: {len(j_jobs)}")
    with ThreadPoolExecutor(args.workers) as ex:
        judged = list(ex.map(lambda j: judge_task(*j), j_jobs))

    margin = ev.DEFAULT_EVIDENCE_MARGIN
    ev.relabel_runs(cases, runs, margin=margin)
    results, dimension_summary, disagreements = ev.evaluate_all(
        cases, runs, judged, agents, evidence_margin=margin
    )
    traces = ev.build_traces(cases, runs, results)
    ev.write_traces(traces)

    OUT.mkdir(exist_ok=True)
    result = {
        "meta": {"agents": agents, "judge": args.judge, "conditions": conditions, "mock": args.mock,
                 "evidence_margin": margin,
                 "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "seconds": round(time.time() - t0, 1)},
        "cases": cases,
        "runs": runs,
        "judged": judged,
        "results": results,
        "dimension_summary": dimension_summary,
        "disagreements": disagreements,
        "registry": ev.registry_list(),
        "traces": traces,
    }
    name = f"results_{args.tag}.json" if args.tag else "results.json"
    (OUT / name).write_text(json.dumps(result, indent=1))
    print(f"wrote {OUT / name} in {result['meta']['seconds']}s")


if __name__ == "__main__":
    main()
