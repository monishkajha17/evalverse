"""Run EvalVerse's transcript-grounded audio evaluation.

    python -m evalverse.audio_run --mock --tag audio
"""
from __future__ import annotations

import argparse
import hashlib
import json
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


def hear(case: dict, condition: str, mock: bool) -> tuple[str, dict, dict, list[dict]]:
    """ASR every individual turn, then give the language model a timestamped transcript."""
    parts, asr_turns, turn_wers, details = [], {}, {}, []
    for turn in case["turns"]:
        t0 = time.time()
        if mock:
            heard = turn["text"]
        else:
            response = audio.transcribe(_turn_audio(turn, condition, seed=turn["index"]))
            heard = str(response.get("transcript", ""))
        latency = time.time() - t0
        index = str(turn["index"])
        asr_turns[index] = heard
        turn_wers[index] = audio.wer(turn["text"], heard)
        parts.append(f"[turn {turn['index']} | {turn['start_ms'] / 1000:.1f}-{turn['end_ms'] / 1000:.1f} s] {heard}")
        details.append({"index": turn["index"], "latency": round(latency, 3), "wer": turn_wers[index]})
    return "\n".join(parts), asr_turns, turn_wers, details


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
    if variant != "blind" and case.get("audio"):
        path = ROOT / case["audio"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12] if path.exists() else hashlib.sha256(case["audio"].encode()).hexdigest()[:12]
        assets = [{"id": digest, "path": case["audio"], "modality": "audio", "transformation": variant}]
    s1 = {"id": "s1", "name": "attach_audio" if variant != "blind" else "remove_media", "type": "media",
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
    args = ap.parse_args()
    cases = load_cases(args.limit, args.mock)
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
    backend = core.MockBackend() if args.mock else core.LiveBackend()
    started = time.time()
    hearing = {}
    for case in cases:
        for condition in conditions:
            hearing[(case["id"], condition)] = hear(case, condition, args.mock)

    runs, heard_by_run = [], {}
    for agent in agents:
        for case in cases:
            for condition in conditions + ["blind"]:
                transcript, asr_turns, turn_wers, details = hearing.get((case["id"], condition), ("", {}, {}, []))
                prompt = core.AUDIO_AGENT_PROMPT.format(question=case["question"], transcript=transcript)
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
    results, summary, disagreements = ev.evaluate_all(cases, runs, judged, agents)
    result_ids = {}
    for result in results:
        target = result["target"]
        result_ids.setdefault((target["agent"], target["case_id"], target["variant"]), []).append(result["id"])
    traces = [_trace(by_id[r["case_id"]], r, heard_by_run[(r["agent"], r["case_id"], r["condition"])],
                     result_ids.get((r["agent"], r["case_id"], r["condition"]), [])) for r in runs]
    OUT.mkdir(exist_ok=True)
    payload = {
        "meta": {"agents": agents, "judge": args.judge, "conditions": conditions, "mock": args.mock,
                 "modality": "audio", "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "seconds": round(time.time() - started, 1)},
        "cases": cases, "runs": runs, "judged": judged, "results": results,
        "dimension_summary": summary, "disagreements": disagreements, "registry": ev.registry_list(), "traces": traces,
    }
    name = f"results_{args.tag}.json" if args.tag else "results_audio.json"
    (OUT / name).write_text(json.dumps(payload, indent=1))
    print(f"wrote {OUT / name} in {payload['meta']['seconds']}s")


if __name__ == "__main__":
    main()
