"""Run EvalVerse's transcript-grounded audio evaluation.

    python -m evalverse.audio_run --mock --tag audio
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf

from . import audio, core, evaluators as ev

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def _mock_cases() -> list[dict]:
    cases = []
    for n in range(1, 3):
        turns = []
        for turn in range(1, 6):
            start = (turn - 1) * 4000
            end = start + 3400
            text = f"This is synthetic conversation {n} turn {turn} with distinctiveword{turn}."
            turns.append({"index": turn, "speaker_id": str(turn), "start_ms": start, "end_ms": end,
                          "text": text, "clip": ""})
        answer = str(n)
        truth = turns[n - 1]
        keyword = f"distinctiveword{n}"
        cases.append({
            "id": f"mock_audio_{n:02d}", "modality": "audio", "family": "mock_conversation",
            "audio": "", "duration_ms": 19400, "turns": turns,
            "question": f"In which turn does a speaker say the word '{keyword}'? Answer with the turn number only.",
            "answer": answer, "answer_type": "text", "keyword": keyword,
            "truth_span": [truth["start_ms"], truth["end_ms"]],
            "source": "synthetic mock",
        })
    return cases


def load_cases(limit=None, mock=False) -> list[dict]:
    path = ROOT / "data" / "cases_audio.json"
    if path.exists():
        cases = json.loads(path.read_text())
    elif mock:
        cases = _mock_cases()
    else:
        raise SystemExit("Audio cases are missing. Build them with: python -m evalverse.datasets.speech")
    return cases[:limit] if limit else cases


def _turn_audio(turn: dict, condition: str, seed: int) -> bytes:
    samples, sr = sf.read(ROOT / turn["clip"], dtype="float32", always_2d=False)
    if getattr(samples, "ndim", 1) > 1:
        samples = np.mean(samples, axis=1)
    return audio.wav_bytes(audio.perturb_audio(samples, sr, condition, seed), sr)


def format_turn(turn: dict, heard: str) -> str:
    """Timestamp header in milliseconds, matching the span the agent must copy."""
    return f"[turn {int(turn['index'])} | {int(turn['start_ms'])}-{int(turn['end_ms'])} ms] {heard}"


def _cached_transcript(wav: bytes):
    path = audio.ASR_CACHE / f"{hashlib.sha1(wav).hexdigest()}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def hear(case: dict, condition: str, mock: bool, reuse_asr: bool = False) -> tuple[str, dict, dict, list[dict]]:
    """ASR every individual turn, then give the language model a timestamped transcript."""
    parts, asr_turns, turn_wers, details = [], {}, {}, []
    for turn in case["turns"]:
        t0 = time.time()
        if mock:
            heard = turn["text"]
        else:
            wav = _turn_audio(turn, condition, seed=turn["index"])
            cached = _cached_transcript(wav) if reuse_asr else None
            response = cached if cached is not None else audio.transcribe(wav)
            heard = str(response.get("transcript", ""))
        latency = time.time() - t0
        index = str(turn["index"])
        asr_turns[index] = heard
        turn_wers[index] = audio.wer(turn["text"], heard)
        parts.append(format_turn(turn, heard))
        details.append({"index": turn["index"], "latency": round(latency, 3), "wer": turn_wers[index]})
    return "\n".join(parts), asr_turns, turn_wers, details


def span_looks_like_seconds(span, duration_ms) -> bool:
    """True when a citation is implausibly small for a long clip. Units are not converted."""
    if not isinstance(span, (list, tuple)) or len(span) != 2:
        return False
    try:
        start, end = float(span[0]), float(span[1])
    except (TypeError, ValueError):
        return False
    return float(duration_ms or 0) > 5000 and start < 1000 and end < 1000


def count_span_unit_warnings(cases, runs) -> int:
    duration = {c["id"]: c.get("duration_ms") or 0 for c in cases}
    return sum(
        1 for run in runs
        if span_looks_like_seconds(run.get("span_ms"), duration.get(run.get("case_id"), 0))
    )


def hearing_from_results(payload: dict, cases: list[dict], conditions: list[str]) -> dict:
    """Rebuild millisecond transcripts from stored ASR text. Does not call the ASR endpoint."""
    by_id = {c["id"]: c for c in cases}
    details = {}
    for trace in payload.get("traces") or []:
        for span in trace.get("spans") or []:
            if span.get("name") == "transcribe":
                details[(trace.get("case_id"), trace.get("variant"))] = span.get("turns") or []
    hearing = {}
    for run in payload.get("runs") or []:
        condition = run.get("condition")
        key = (run.get("case_id"), condition)
        if condition not in conditions or key in hearing or key[0] not in by_id:
            continue
        case = by_id[key[0]]
        asr_turns = {str(k): v for k, v in (run.get("asr_turns") or {}).items()}
        turn_wers = {str(k): v for k, v in (run.get("turn_wers") or {}).items()}
        transcript = "\n".join(format_turn(turn, asr_turns.get(str(turn["index"]), "")) for turn in case["turns"])
        hearing[key] = (transcript, asr_turns, turn_wers, details.get(key, []))
    return hearing


def clean_span(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    try:
        return [round(float(value[0])), round(float(value[1]))]
    except (TypeError, ValueError):
        return None


def score(case: dict, raw: str, asr_turns: dict) -> dict:
    parsed = core.parse_json(raw)
    valid = parsed is not None and "answer" in parsed
    answer = str(parsed.get("answer", "")) if valid else ""
    span = clean_span(parsed.get("span_ms")) if valid else None
    run = {
        "answer": answer, "span_ms": span, "evidence": str(parsed.get("evidence", ""))[:300] if valid else "",
        "asr_turns": asr_turns, "correct": core.answer_correct(case, answer),
    }
    run["evidence_ok"] = ev.span_match(case["truth_span"], span)
    run["label"] = ev.audio_label(case, run) if valid else "invalid_output"
    return run


def _trace(case, run, heard_details, result_ids):
    variant = run["condition"]
    assets = []
    if variant not in ("blind", "blind_guess") and case.get("audio"):
        path = ROOT / case["audio"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12] if path.exists() else hashlib.sha256(case["audio"].encode()).hexdigest()[:12]
        assets = [{"id": digest, "path": case["audio"], "modality": "audio", "transformation": variant}]
    s1 = {"id": "s1", "name": "attach_audio" if variant not in ("blind", "blind_guess") else "remove_media", "type": "media",
          "status": "completed", "parent_span_ids": [], "metadata": {"asset_id": assets[0]["id"] if assets else None}}
    s2 = {"id": "s2", "name": "transcribe", "type": "model", "status": "completed", "parent_span_ids": ["s1"],
          "model": "muse-voice-transcribe-1.0", "turns": heard_details}
    s3 = {"id": "s3", "name": "model_call", "type": "model", "status": "failed" if run.get("error") else "completed",
          "parent_span_ids": ["s2"], "model": run["model"], "latency_s": run["latency"],
          "usage": run["usage"], "input": {"prompt": run["prompt"]}, "output": {"raw": run["raw"], "answer": run["answer"], "span_ms": run["span_ms"]}}
    s4 = {"id": "s4", "name": "evaluation", "type": "evaluation", "status": "completed",
          "parent_span_ids": ["s3"], "result_ids": result_ids}
    return {"id": f"{run['agent']}|{case['id']}|{variant}", "agent": run["agent"], "case_id": case["id"],
            "variant": variant, "assets": assets, "spans": [s1, s2, s3, s4]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents", default="muse-spark-1.3,muse-spark-1.1")
    ap.add_argument("--judge", default="muse-spark-1.3")
    ap.add_argument("--conditions", default="clean,noise,bandlimit")
    ap.add_argument("--tag", default="audio")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--reuse-asr", action="store_true", help="use out/asr cache entries and do not transcribe those clips again")
    ap.add_argument("--only-agents", action="store_true", help="rerun only the agent and judge steps, reusing stored transcripts")
    args = ap.parse_args()
    cases = load_cases(args.limit, args.mock)
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    backend = core.MockBackend() if args.mock else core.LiveBackend()
    started = time.time()
    name = f"results_{args.tag}.json" if args.tag else "results_audio.json"
    out_path = OUT / name
    hearing = {}
    if args.only_agents and out_path.exists():
        hearing = hearing_from_results(json.loads(out_path.read_text()), cases, conditions)
    elif args.only_agents and not args.mock:
        raise SystemExit(f"--only-agents needs an existing {out_path} to reuse.")
    for case in cases:
        for condition in conditions:
            if (case["id"], condition) not in hearing:
                hearing[(case["id"], condition)] = hear(case, condition, args.mock, reuse_asr=args.reuse_asr)

    runs, heard_by_run = [], {}
    for agent in agents:
        for case in cases:
            for condition in conditions + ["blind", "blind_guess"]:
                transcript, asr_turns, turn_wers, details = hearing.get((case["id"], condition), ("", {}, {}, []))
                prompt = core.audio_agent_prompt(case["question"], transcript, condition)
                try:
                    raw, latency, usage = backend.audio_agent(agent, case, transcript, condition)
                    rec = score(case, raw, asr_turns)
                    rec.update(latency=round(latency, 3), error=None, model=agent, prompt=prompt, raw=raw[:4000], usage=usage,
                               wer=round(sum(turn_wers.values()) / len(turn_wers), 4) if turn_wers else None)
                except Exception as exc:
                    rec = {"answer": "", "span_ms": None, "evidence": "", "asr_turns": asr_turns, "correct": False,
                           "evidence_ok": False, "label": "invalid_output", "latency": 0, "error": str(exc)[:200],
                           "model": agent, "prompt": prompt, "raw": "", "usage": None, "wer": None}
                rec.update(agent=agent, case_id=case["id"], condition=condition, transcript=transcript, turn_wers=turn_wers)
                runs.append(rec)
                heard_by_run[(agent, case["id"], condition)] = details

    by_id = {c["id"]: c for c in cases}
    judged = []
    for case in cases:
        transcript = hearing[(case["id"], "clean")][0]
        wrong = str(next(t["index"] for t in case["turns"] if str(t["index"]) != case["answer"]))
        for kind, proposed in (("planted_right", case["answer"]), ("planted_wrong", wrong)):
            raw = backend.audio_judge(args.judge, case, proposed, transcript)
            parsed = core.parse_json(raw) or {}
            accepted = str(parsed.get("verdict", "")).lower() == "correct"
            judged.append({"kind": kind, "agent": None, "case_id": case["id"], "proposed": proposed,
                           "judge_accepts": accepted, "truth_correct": core.answer_correct(case, proposed),
                           "agrees": accepted == core.answer_correct(case, proposed)})

    ev.relabel_runs(cases, runs)
    results, summary, disagreements, conflicts = ev.evaluate_all(
        cases, runs, judged, agents, judge_model=args.judge
    )
    result_ids = {}
    for result in results:
        target = result["target"]
        result_ids.setdefault((target["agent"], target["case_id"], target["variant"]), []).append(result["id"])
    traces = [_trace(by_id[r["case_id"]], r, heard_by_run[(r["agent"], r["case_id"], r["condition"])],
                     result_ids.get((r["agent"], r["case_id"], r["condition"]), [])) for r in runs]
    payload = {
        "meta": {"agents": agents, "judge": args.judge, "conditions": conditions, "mock": args.mock,
                 "modality": "audio", "span_unit_warnings": count_span_unit_warnings(cases, runs),
                 "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "seconds": round(time.time() - started, 1)},
        "cases": cases, "runs": runs, "judged": judged, "results": results,
        "dimension_summary": summary, "disagreements": disagreements, "conflicts": conflicts,
        "registry": ev.registry_list(), "traces": traces, "plan": [],
    }
    OUT.mkdir(exist_ok=True)
    if out_path.name == "results_audio.json" and out_path.exists():
        backup = out_path.with_name("results_audio.before_units_fix.json")
        if not backup.exists():
            shutil.copy2(out_path, backup)
    out_path.write_text(json.dumps(payload, indent=1))
    print(f"wrote {out_path} in {payload['meta']['seconds']}s")
    print_summary(runs)


def print_summary(runs: list[dict]) -> None:
    agents, conditions = [], []
    for run in runs:
        if run["agent"] not in agents:
            agents.append(run["agent"])
        if run["condition"] not in conditions:
            conditions.append(run["condition"])
    guess_correct = {
        agent: sum(1 for run in runs if run["agent"] == agent and run["condition"] == "blind_guess" and run.get("correct"))
        for agent in agents
    }
    print(f"{'agent':<22} {'condition':<14} {'n':>4} {'correct':>8} {'grounded_correct':>18} {'correct_ungrounded':>20} {'blind_guess_correct':>20}")
    for agent in agents:
        for condition in conditions:
            rows = [run for run in runs if run["agent"] == agent and run["condition"] == condition]
            if not rows:
                continue
            print(
                f"{agent:<22} {condition:<14} {len(rows):>4} "
                f"{sum(bool(run.get('correct')) for run in rows):>8} "
                f"{sum(run.get('label') == 'grounded_correct' for run in rows):>18} "
                f"{sum(run.get('label') == 'correct_ungrounded' for run in rows):>20} "
                f"{guess_correct[agent]:>20}"
            )


if __name__ == "__main__":
    main()
