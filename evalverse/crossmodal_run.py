"""Cross-modal consistency: spoken/text claim vs receipt image.

    python -m evalverse.crossmodal_run --agents muse-spark-1.3 \\
        --conditions clean,blur,noisy_voice --tag crossmodal --mock
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
from PIL import Image

from . import audio, core, evaluators as ev

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
CASES_PATH = ROOT / "data" / "cases_crossmodal.json"

DEFAULT_CONDITIONS = ("clean", "blur", "noisy_voice")


def _resolve_media(rel: str | None) -> Path | None:
    if not rel:
        return None
    p = Path(rel)
    return p if p.is_absolute() else ROOT / p


def _mock_cases() -> list[dict]:
    """Tiny offline cases with a generated sine WAV (no TTS required)."""
    from .datasets.crossmodal import _write_sine_wav

    img_dir = OUT / "mock_cm_images"
    audio_dir = OUT / "mock_cm_audio"
    img_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    for i, (expected, claim_v, receipt_v) in enumerate(
        (
            ("consistent", 148127, 148127),
            ("inconsistent", 117500, 148127),
        ),
        start=1,
    ):
        cid = f"cm_mock_{i:02d}"
        img_path = img_dir / f"{cid}.jpg"
        Image.new("RGB", (200, 280), color=(240, 240, 235)).save(img_path, "JPEG")
        wav_path = audio_dir / f"{cid}.wav"
        duration_ms = _write_sine_wav(wav_path, duration_s=0.8, freq=220.0 * i)
        claim_text = f"The total on my receipt is {claim_v} rupiah."
        cases.append(
            {
                "id": cid,
                "modality": "cross_modal",
                "family": "receipt_vs_claim",
                "image": str(img_path),
                "question": (
                    "Does what was said match what the receipt shows? "
                    "Answer consistent or inconsistent."
                ),
                "claim_text": claim_text,
                "claim_value": float(claim_v),
                "claim_channel": "voice",
                "audio": str(wav_path),
                "duration_ms": duration_ms,
                "receipt_value": str(receipt_v),
                "truth_box": [100, 800, 900, 950],
                "expected_verdict": expected,
                "source": "synthetic mock",
                "answer": expected,
                "answer_type": "text",
                "distractor": "inconsistent" if expected == "consistent" else "consistent",
            }
        )
    return cases


def load_cases(limit=None, mock=False) -> list[dict]:
    if CASES_PATH.exists():
        cases = json.loads(CASES_PATH.read_text())
    elif mock:
        cases = _mock_cases()
    else:
        raise SystemExit(
            "Cross-modal cases missing. Build with: python -m evalverse.datasets.crossmodal"
        )
    return cases[:limit] if limit else cases


def _cached_transcript(wav: bytes):
    path = audio.ASR_CACHE / f"{hashlib.sha1(wav).hexdigest()}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _load_wav(path: Path) -> tuple[np.ndarray, int]:
    samples, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if getattr(samples, "ndim", 1) > 1:
        samples = np.mean(samples, axis=1)
    return np.asarray(samples, dtype=np.float32), int(sr)


def hear_claim(
    case: dict,
    condition: str,
    *,
    mock: bool,
    reuse_asr: bool = False,
) -> tuple[str, float | None]:
    """Return (claim_text_or_transcript, wer). Text channel ignores audio."""
    channel = case.get("claim_channel") or "text"
    claim_text = str(case.get("claim_text") or "")
    if channel != "voice" or not case.get("audio"):
        return claim_text, None

    if mock:
        # Perfect hearing under mock unless noisy_voice slightly corrupts tokens.
        if condition == "noisy_voice":
            # Mild corruption: drop commas so WER is non-zero but meaning remains.
            heard = claim_text.replace(",", "")
            return heard, audio.wer(claim_text, heard)
        return claim_text, 0.0

    samples, sr = _load_wav(_resolve_media(case["audio"]))
    if condition == "noisy_voice":
        samples = audio.perturb_audio(samples, sr, "noise", seed=7)
    wav = audio.wav_bytes(samples, sr)
    cached = _cached_transcript(wav) if reuse_asr else None
    response = cached if cached is not None else audio.transcribe(wav)
    heard = str(response.get("transcript") or "")
    return heard, audio.wer(claim_text, heard)


def _image_png(case: dict, condition: str) -> bytes | None:
    if condition == "no_image":
        return None
    img = Image.open(_resolve_media(case["image"])).convert("RGB")
    if condition == "blur":
        img = core.perturb(img, "blur", seed=0)
    elif condition in ("clean", "noisy_voice"):
        img = core.perturb(img, "clean", seed=0)
    else:
        # Unknown image condition: treat as clean.
        img = core.perturb(img, "clean", seed=0)
    return core.to_png_bytes(img)


def error_type_for(expected: str, verdict: str | None, valid: bool) -> str:
    if not valid:
        return "none"
    v = (verdict or "").strip().lower()
    if v == "cannot_tell":
        return "abstained"
    if v == expected:
        return "none"
    if expected == "inconsistent" and v == "consistent":
        return "missed_contradiction"
    if expected == "consistent" and v == "inconsistent":
        return "false_alarm"
    return "none"


def score_run(case: dict, raw: str, *, transcript: str, wer: float | None, channel: str, condition: str) -> dict:
    parsed = core.parse_json(raw)
    valid = bool(parsed) and "verdict" in (parsed or {})
    verdict = str(parsed.get("verdict", "")).strip().lower() if valid else ""
    claimed_value = str(parsed.get("claimed_value", "")) if valid else ""
    image_value = str(parsed.get("image_value", "")) if valid else ""
    image_box = core.clean_box(parsed.get("image_box")) if valid else None
    expected = str(case.get("expected_verdict") or "")
    if not valid:
        label = "invalid_output"
        err = "none"
    else:
        err = error_type_for(expected, verdict, True)
        if verdict == "cannot_tell":
            label = "abstained"
        elif verdict == expected:
            label = "correct_verdict"
        elif expected == "inconsistent" and verdict == "consistent":
            label = "missed_contradiction"
        elif expected == "consistent" and verdict == "inconsistent":
            label = "false_alarm"
        else:
            label = "invalid_output" if verdict not in ("consistent", "inconsistent", "cannot_tell") else "missed_contradiction"
            if verdict not in ("consistent", "inconsistent", "cannot_tell"):
                err = "none"
    return {
        "answer": verdict,
        "verdict": verdict,
        "claimed_value": claimed_value,
        "image_value": image_value,
        "image_box": image_box,
        "box": image_box,  # evidence_grounding
        "evidence": str(parsed.get("evidence", ""))[:300] if valid else "",
        "transcript": transcript,
        "wer": wer,
        "channel": channel,
        "expected_verdict": expected,
        "error_type": err,
        "correct": bool(valid and verdict == expected and verdict != "cannot_tell"),
        "evidence_ok": bool(
            image_box and case.get("truth_box") and core.evidence_ok(case["truth_box"], image_box)
        ),
        "label": label,
        "condition": condition,
    }


def conditions_for_case(case: dict, requested: list[str]) -> list[str]:
    channel = case.get("claim_channel") or "text"
    out = []
    for c in requested:
        if c == "noisy_voice" and channel != "voice":
            continue
        out.append(c)
    if "no_image" not in out:
        out.append("no_image")
    return out


def build_crossmodal_trace(case: dict, run: dict, result_ids: list[str] | None = None) -> dict:
    """DAG: image + optional voice roots join at model_call -> evaluation."""
    agent = run.get("agent") or "agent"
    case_id = run.get("case_id") or case.get("id") or "case"
    variant = run.get("condition") or run.get("variant") or "clean"
    channel = run.get("channel") or case.get("claim_channel") or "text"
    transform = {
        "clean": "identity",
        "blur": "gaussian_blur r=5",
        "noisy_voice": "audio_noise_10db",
        "no_image": "remove_media",
    }.get(variant, variant)

    assets = []
    if case.get("image") and variant != "no_image":
        assets.append(
            {
                "id": f"img:{case_id}",
                "path": case["image"],
                "modality": "image",
                "transformation": transform if variant == "blur" else "identity",
            }
        )
    if channel == "voice" and case.get("audio"):
        assets.append(
            {
                "id": f"aud:{case_id}",
                "path": case["audio"],
                "modality": "audio",
                "transformation": "audio_noise_10db" if variant == "noisy_voice" else "identity",
            }
        )

    spans: list[dict] = []
    if variant == "no_image":
        spans.append(
            {
                "id": "s1",
                "name": "remove_media",
                "type": "media",
                "status": "completed",
                "parent_span_ids": [],
                "metadata": {"transformation": "remove_media"},
            }
        )
        model_parents = ["s1"]
    else:
        spans.append(
            {
                "id": "s1",
                "name": "attach receipt image",
                "type": "media",
                "status": "completed",
                "parent_span_ids": [],
                "metadata": {
                    "asset_id": assets[0]["id"] if assets else None,
                    "transformation": transform if variant == "blur" else "identity",
                },
            }
        )
        model_parents = ["s1"]

    if channel == "voice" and case.get("audio"):
        spans.append(
            {
                "id": "s2",
                "name": "attach voice clip",
                "type": "media",
                "status": "completed",
                "parent_span_ids": [],
                "metadata": {
                    "asset_id": next((a["id"] for a in assets if a["modality"] == "audio"), None),
                    "transformation": "audio_noise_10db" if variant == "noisy_voice" else "identity",
                },
            }
        )
        spans.append(
            {
                "id": "s3",
                "name": "transcribe voice",
                "type": "media",
                "status": "completed",
                "parent_span_ids": ["s2"],
                "attributes": {
                    "turn": 1,
                    "start_ms": 0,
                    "end_ms": int(case.get("duration_ms") or 0),
                    "text": run.get("transcript"),
                    "wer": run.get("wer"),
                },
            }
        )
        if variant != "no_image":
            model_parents = ["s1", "s3"]
        else:
            model_parents = ["s3"]

    status = "failed" if run.get("error") else "completed"
    spans.append(
        {
            "id": "s4",
            "name": "model call",
            "type": "model",
            "status": status,
            "parent_span_ids": list(model_parents),
            "model": run.get("model") or agent,
            "latency_s": run.get("latency"),
            "usage": run.get("usage"),
            "input": {"prompt": run.get("prompt")},
            "output": {
                "raw": run.get("raw"),
                "verdict": run.get("verdict"),
                "claimed_value": run.get("claimed_value"),
                "image_value": run.get("image_value"),
                "image_box": run.get("image_box"),
            },
            "error": run.get("error"),
        }
    )
    spans.append(
        {
            "id": "s5",
            "name": "evaluation",
            "type": "evaluation",
            "status": "completed",
            "parent_span_ids": ["s4"],
            "result_ids": list(result_ids or []),
        }
    )
    return {
        "id": f"{agent}|{case_id}|{variant}",
        "agent": agent,
        "case_id": case_id,
        "variant": variant,
        "variant_transform": transform,
        "assets": assets,
        "spans": spans,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents", default="muse-spark-1.3")
    ap.add_argument("--judge", default="muse-wonder-1.0")
    ap.add_argument("--conditions", default=",".join(DEFAULT_CONDITIONS))
    ap.add_argument("--tag", default="crossmodal")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--reuse-asr", action="store_true")
    args = ap.parse_args()

    cases = load_cases(args.limit, args.mock)
    agents = [a.strip() for a in args.agents.split(",") if a.strip()]
    requested = [c.strip() for c in args.conditions.split(",") if c.strip()]
    backend = core.MockBackend() if args.mock else core.LiveBackend()
    started = time.time()

    # Pre-hear per (case, condition) for voice.
    hearing: dict[tuple, tuple[str, float | None]] = {}
    for case in cases:
        for condition in conditions_for_case(case, requested):
            if condition == "no_image":
                # Still need the claim text / transcript of the clean claim.
                base_cond = "clean"
                if (case["id"], base_cond) not in hearing:
                    hearing[(case["id"], base_cond)] = hear_claim(
                        case, base_cond, mock=args.mock, reuse_asr=args.reuse_asr
                    )
                hearing[(case["id"], condition)] = hearing[(case["id"], base_cond)]
                continue
            hearing[(case["id"], condition)] = hear_claim(
                case, condition, mock=args.mock, reuse_asr=args.reuse_asr
            )

    runs = []
    for agent in agents:
        for case in cases:
            channel = case.get("claim_channel") or "text"
            for condition in conditions_for_case(case, requested):
                transcript, wer = hearing[(case["id"], condition)]
                prompt = core.cross_modal_prompt(case["question"], transcript, condition)
                image_png = _image_png(case, condition)
                try:
                    raw, latency, usage = backend.agent(
                        agent, case, image_png, condition, prompt=prompt
                    )
                    rec = score_run(
                        case,
                        raw,
                        transcript=transcript,
                        wer=wer,
                        channel=channel,
                        condition=condition,
                    )
                    rec.update(
                        latency=round(latency, 3),
                        error=None,
                        model=agent,
                        prompt=prompt,
                        raw=raw[:4000],
                        usage=usage,
                    )
                except Exception as exc:
                    rec = {
                        "answer": "",
                        "verdict": "",
                        "claimed_value": "",
                        "image_value": "",
                        "image_box": None,
                        "box": None,
                        "evidence": "",
                        "transcript": transcript,
                        "wer": wer,
                        "channel": channel,
                        "expected_verdict": case.get("expected_verdict"),
                        "error_type": "none",
                        "correct": False,
                        "evidence_ok": False,
                        "label": "invalid_output",
                        "latency": 0,
                        "error": str(exc)[:200],
                        "model": agent,
                        "prompt": prompt,
                        "raw": "",
                        "usage": None,
                        "condition": condition,
                    }
                rec.update(agent=agent, case_id=case["id"], condition=condition)
                runs.append(rec)

    judged = []
    for case in cases:
        claim = hearing.get((case["id"], "clean"), (case.get("claim_text") or "", None))[0]
        img = _image_png(case, "clean")
        right = case["expected_verdict"]
        wrong = "inconsistent" if right == "consistent" else "consistent"
        for kind, proposed in (("planted_right", right), ("planted_wrong", wrong)):
            raw = backend.judge(args.judge, case, proposed, img)
            parsed = core.parse_json(raw) or {}
            accepted = str(parsed.get("verdict", "")).lower() == "correct"
            truth_correct = proposed == case["expected_verdict"]
            judged.append(
                {
                    "kind": kind,
                    "agent": None,
                    "case_id": case["id"],
                    "proposed": proposed,
                    "claim": claim,
                    "judge_accepts": accepted,
                    "truth_correct": truth_correct,
                    "agrees": accepted == truth_correct,
                }
            )

    ev.relabel_runs(cases, runs)
    results, summary, disagreements, conflicts = ev.evaluate_all(
        cases, runs, judged, agents, judge_model=args.judge
    )
    traces = ev.build_traces(cases, runs, results)
    payload = {
        "meta": {
            "agents": agents,
            "judge": args.judge,
            "conditions": requested,
            "mock": args.mock,
            "modality": "cross_modal",
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seconds": round(time.time() - started, 1),
        },
        "cases": cases,
        "runs": runs,
        "judged": judged,
        "results": results,
        "dimension_summary": summary,
        "disagreements": disagreements,
        "conflicts": conflicts,
        "registry": ev.registry_list(),
        "traces": traces,
        "plan": [],
    }
    OUT.mkdir(exist_ok=True)
    out_path = OUT / (f"results_{args.tag}.json" if args.tag else "results_crossmodal.json")
    out_path.write_text(json.dumps(payload, indent=1))
    print(f"wrote {out_path} in {payload['meta']['seconds']}s  runs={len(runs)} traces={len(traces)}")
    print_summary(runs)
    # Print one trace DAG for acceptance.
    if traces:
        tr = next((t for t in traces if t.get("variant") == "clean"), traces[0])
        print(f"trace {tr['id']} spans:")
        for sp in tr.get("spans") or []:
            print(f"  {sp.get('id')}: {sp.get('name')} parents={sp.get('parent_span_ids')}")


def print_summary(runs: list[dict]) -> None:
    agents, conditions = [], []
    for run in runs:
        if run["agent"] not in agents:
            agents.append(run["agent"])
        if run["condition"] not in conditions:
            conditions.append(run["condition"])
    print(f"{'agent':<22} {'condition':<14} {'n':>4} {'correct':>8} {'abstained':>10}")
    for agent in agents:
        for condition in conditions:
            rows = [r for r in runs if r["agent"] == agent and r["condition"] == condition]
            if not rows:
                continue
            print(
                f"{agent:<22} {condition:<14} {len(rows):>4} "
                f"{sum(bool(r.get('correct')) for r in rows):>8} "
                f"{sum(r.get('error_type') == 'abstained' for r in rows):>10}"
            )


if __name__ == "__main__":
    main()
