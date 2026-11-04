"""Run EvalVerse video evaluation over register-screen clips.

    python -m evalverse.video_run --mock --tag video
    python -m evalverse.video_run --agents muse-spark-1.3,muse-spark-1.1 \\
        --conditions clean,sparse,blur --tag video
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from . import core
from . import evaluators as ev
from . import video as vmod
from . import video_evaluators  # noqa: F401 — register video evaluators into REGISTRY

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
CASES = ROOT / "data" / "cases_video.json"


def load_cases(limit: int | None = None) -> list[dict]:
    if not CASES.exists():
        raise SystemExit(
            "Video cases missing. Build them with: python -m evalverse.datasets.video --n 12 --seed 7"
        )
    cases = json.loads(CASES.read_text())
    return cases[:limit] if limit else cases


def clean_span(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    try:
        return [round(float(value[0])), round(float(value[1]))]
    except (TypeError, ValueError):
        return None


def clean_box(value):
    return core.clean_box(value)


def score(case: dict, raw: str, *, sampling_interval_ms: int) -> dict:
    parsed = core.parse_json(raw)
    valid = parsed is not None and "answer" in parsed
    if not valid:
        return {
            "answer": "",
            "span_ms": None,
            "box": None,
            "evidence": "",
            "correct": False,
            "evidence_ok": False,
            "label": "invalid_output",
        }
    answer = parsed.get("answer", "")
    if isinstance(answer, (dict, list)):
        answer = json.dumps(answer, ensure_ascii=False)
    else:
        answer = str(answer) if answer is not None else ""
    span = clean_span(parsed.get("span_ms"))
    box = clean_box(parsed.get("box"))
    correct = vmod.video_answer_correct(case, answer)
    span_ok = vmod.video_span_match(
        case.get("truth_span_ms"), span, sampling_interval_ms=sampling_interval_ms
    )
    box_ok = False
    if case.get("truth_box") and box:
        box_ok = core.evidence_ok(case["truth_box"], box)
    evidence_ok = span_ok  # temporal grounding is primary for video
    run = {
        "answer": answer,
        "span_ms": span,
        "box": box,
        "evidence": str(parsed.get("evidence") or "")[:300],
        "correct": correct,
        "evidence_ok": evidence_ok,
        "box_ok": box_ok,
    }
    run["label"] = vmod.video_label(case, run, sampling_interval_ms=sampling_interval_ms)
    return run


def _load_conditioned_frames(case: dict, condition: str, seed: int):
    if condition in ("blind", "blind_guess"):
        return []
    path = ROOT / case["video"]
    every = vmod.every_s_for_condition(condition)
    frames = vmod.sample_frames(path, every)
    frames = vmod.perturb_video(frames, condition, seed=seed)
    return frames


def build_video_trace(case: dict, run: dict, frame_tmss: list[int], result_ids: list[str]) -> dict:
    variant = run["condition"]
    assets = []
    if variant not in ("blind", "blind_guess") and case.get("video"):
        path = ROOT / case["video"]
        digest = (
            hashlib.sha256(path.read_bytes()).hexdigest()[:12]
            if path.is_file()
            else hashlib.sha256(str(case["video"]).encode()).hexdigest()[:12]
        )
        assets = [
            {
                "id": digest,
                "path": case["video"],
                "modality": "video",
                "transformation": variant,
            }
        ]

    s1 = {
        "id": "s1",
        "name": "attach_video" if variant not in ("blind", "blind_guess") else "remove_media",
        "type": "media",
        "status": "completed",
        "parent_span_ids": [],
        "metadata": {"asset_id": assets[0]["id"] if assets else None, "transformation": variant},
    }
    s2_ids = []
    s2_spans = []
    for k, t_ms in enumerate(frame_tmss, start=1):
        sid = f"s2_{k}"
        s2_ids.append(sid)
        s2_spans.append(
            {
                "id": sid,
                "name": f"sample frame {k}",
                "type": "media",
                "status": "completed",
                "parent_span_ids": ["s1"],
                "attributes": {"t_ms": t_ms, "frame_index": k},
            }
        )
    # Blind: still create a single placeholder sample span? Spec says s2_1..s2_k —
    # for k=0, model parents = [] from s1 only. Use empty parallel set; model joins s1.
    model_parents = list(s2_ids) if s2_ids else ["s1"]
    s3 = {
        "id": "s3",
        "name": "model_call",
        "type": "model",
        "status": "failed" if run.get("error") else "completed",
        "parent_span_ids": model_parents,
        "model": run.get("model"),
        "latency_s": run.get("latency"),
        "usage": run.get("usage"),
        "input": {"prompt": run.get("prompt")},
        "output": {
            "raw": run.get("raw"),
            "answer": run.get("answer"),
            "span_ms": run.get("span_ms"),
            "box": run.get("box"),
        },
        "error": run.get("error"),
    }
    s4 = {
        "id": "s4",
        "name": "evaluation",
        "type": "evaluation",
        "status": "completed",
        "parent_span_ids": ["s3"],
        "result_ids": list(result_ids or []),
    }
    return {
        "id": f"{run['agent']}|{case['id']}|{variant}",
        "agent": run["agent"],
        "case_id": case["id"],
        "variant": variant,
        "variant_transform": variant,
        "assets": assets,
        "spans": [s1, *s2_spans, s3, s4],
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--agents", default="muse-spark-1.3,muse-spark-1.1")
    ap.add_argument("--conditions", default="clean,sparse,blur")
    ap.add_argument("--tag", default="video")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--mock", action="store_true")
    args = ap.parse_args(argv)

    cases = load_cases(args.limit)
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    backend = core.MockBackend(seed=7) if args.mock else core.LiveBackend()

    started = time.time()
    runs = []
    frame_tmss_by_key: dict[tuple, list[int]] = {}

    for agent in agents:
        for case in cases:
            for condition in conditions + ["blind", "blind_guess"]:
                interval = vmod.sampling_interval_ms(condition)
                prompt = vmod.video_agent_prompt(case["question"], condition)
                frames = _load_conditioned_frames(
                    case, condition, seed=hash((case["id"], condition)) % 10_000
                )
                framed = vmod.frames_to_png(frames) if frames else []
                frame_tmss_by_key[(agent, case["id"], condition)] = [t for t, _ in frames]
                # Hint mock backend about condition.
                case_view = dict(case)
                case_view["_condition"] = condition
                try:
                    raw, latency, usage = backend.video_agent(agent, case_view, framed, prompt)
                    rec = score(case, raw, sampling_interval_ms=interval)
                    rec.update(
                        latency=round(latency, 3),
                        error=None,
                        model=agent,
                        prompt=prompt,
                        raw=(raw or "")[:4000],
                        usage=usage,
                    )
                except Exception as exc:  # noqa: BLE001
                    rec = {
                        "answer": "",
                        "span_ms": None,
                        "box": None,
                        "evidence": "",
                        "correct": False,
                        "evidence_ok": False,
                        "label": "invalid_output",
                        "latency": 0,
                        "error": str(exc)[:200],
                        "model": agent,
                        "prompt": prompt,
                        "raw": "",
                        "usage": None,
                    }
                rec.update(agent=agent, case_id=case["id"], condition=condition)
                runs.append(rec)

    by_id = {c["id"]: c for c in cases}
    ev.relabel_runs(cases, runs)  # no-op-ish for video (uses image stage labels); we keep our labels
    # Restore video labels after relabel_runs (which is image-oriented).
    for run in runs:
        case = by_id.get(run["case_id"])
        if case and case.get("modality") == "video":
            interval = vmod.sampling_interval_ms(run.get("condition") or "clean")
            run["correct"] = vmod.video_answer_correct(case, run.get("answer"))
            run["evidence_ok"] = vmod.video_span_match(
                case.get("truth_span_ms"),
                run.get("span_ms"),
                sampling_interval_ms=interval,
            )
            if run.get("label") != "invalid_output" and not run.get("error"):
                run["label"] = vmod.video_label(case, run, sampling_interval_ms=interval)

    results, summary, disagreements, conflicts = ev.evaluate_all(
        cases, runs, [], agents
    )
    result_ids: dict[tuple, list[str]] = {}
    for result in results:
        t = result["target"]
        result_ids.setdefault((t["agent"], t["case_id"], t["variant"]), []).append(result["id"])

    traces = []
    for run in runs:
        case = by_id[run["case_id"]]
        key = (run["agent"], run["case_id"], run["condition"])
        traces.append(
            build_video_trace(
                case,
                run,
                frame_tmss_by_key.get(key, []),
                result_ids.get((run["agent"], run["case_id"], run["condition"]), []),
            )
        )

    payload = {
        "meta": {
            "agents": agents,
            "conditions": conditions,
            "mock": args.mock,
            "modality": "video",
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seconds": round(time.time() - started, 1),
        },
        "cases": cases,
        "runs": runs,
        "judged": [],
        "results": results,
        "dimension_summary": summary,
        "disagreements": disagreements,
        "conflicts": conflicts,
        "registry": ev.registry_list(),
        "traces": traces,
        "plan": [],
    }
    OUT.mkdir(exist_ok=True)
    name = f"results_{args.tag}.json" if args.tag else "results_video.json"
    out_path = OUT / name
    out_path.write_text(json.dumps(payload, indent=1))
    print(f"wrote {out_path} in {payload['meta']['seconds']}s  runs={len(runs)} traces={len(traces)}")
    _print_summary(runs)


def _print_summary(runs: list[dict]) -> None:
    agents, conditions = [], []
    for run in runs:
        if run["agent"] not in agents:
            agents.append(run["agent"])
        if run["condition"] not in conditions:
            conditions.append(run["condition"])
    print(f"{'agent':<22} {'condition':<12} {'n':>4} {'correct':>8} {'grounded_correct':>16}")
    for agent in agents:
        for condition in conditions:
            rows = [r for r in runs if r["agent"] == agent and r["condition"] == condition]
            if not rows:
                continue
            print(
                f"{agent:<22} {condition:<12} {len(rows):>4} "
                f"{sum(bool(r.get('correct')) for r in rows):>8} "
                f"{sum(r.get('label') == 'grounded_correct' for r in rows):>16}"
            )


if __name__ == "__main__":
    main()
