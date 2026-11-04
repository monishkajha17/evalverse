"""Cross-modal receipt-vs-claim cases: spoken/text claim vs receipt image.

    python -m evalverse.datasets.crossmodal --n 30 --seed 7
    python -m evalverse.datasets.crossmodal --n 30 --seed 7 --voice-share 0.67
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from .. import core

ROOT = Path(__file__).resolve().parent.parent.parent
CORD_CASES = ROOT / "data" / "cases_cord.json"
OUT_CASES = ROOT / "data" / "cases_crossmodal.json"
AUDIO_DIR = ROOT / "data" / "audio_cm"

QUESTION = (
    "Does what was said match what the receipt shows? "
    "Answer consistent or inconsistent."
)

CONSISTENT_PHRASINGS = (
    "The total on my receipt is {spoken} rupiah.",
    "The subtotal was {spoken} rupiah.",
    "The tax came to {spoken} rupiah.",
)
INCONSISTENT_PHRASINGS = (
    "The total on my receipt is {spoken} rupiah.",
    "The subtotal was {spoken} rupiah.",
    "The tax came to {spoken} rupiah.",
)


def _say_available() -> bool:
    return shutil.which("say") is not None and shutil.which("afconvert") is not None


def _write_sine_wav(path: Path, duration_s: float = 1.2, sr: int = 16000, freq: float = 440.0) -> int:
    """Fallback WAV when TTS is unavailable (tests / CI). Returns duration_ms."""
    n = int(sr * duration_s)
    t = np.arange(n, dtype=np.float32) / sr
    samples = (0.2 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sr)
        out.writeframes(pcm.tobytes())
    return int(round(1000 * n / sr))


def synthesize_claim_wav(
    sentence: str,
    dest: Path,
    *,
    allow_sine_fallback: bool = False,
    force_sine: bool = False,
) -> tuple[int, str]:
    """Render `sentence` to 16 kHz mono WAV. Returns (duration_ms, channel).

    channel is \"voice\" on success. If `say` is missing and allow_sine_fallback,
    writes a sine WAV and still returns channel \"voice\" (for tests). Otherwise
    raises RuntimeError. `force_sine` skips TTS (tests).
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    if force_sine or not _say_available():
        if force_sine or allow_sine_fallback:
            return _write_sine_wav(dest), "voice"
        raise RuntimeError("macOS say/afconvert unavailable")

    with tempfile.TemporaryDirectory() as tmp:
        aiff = Path(tmp) / "clip.aiff"
        subprocess.run(
            ["say", "-o", str(aiff), sentence],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "afconvert",
                "-f",
                "WAVE",
                "-d",
                "LEI16@16000",
                "-c",
                "1",
                str(aiff),
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
    with wave.open(str(dest), "rb") as wf:
        frames = wf.getnframes()
        sr = wf.getframerate() or 16000
        duration_ms = int(round(1000 * frames / sr))
    return duration_ms, "voice"


def _eligible_cord(cases: list[dict]) -> list[dict]:
    out = []
    for c in cases:
        ans = core._amount(c.get("answer"))
        dist = core._amount(c.get("distractor"))
        if ans is None or dist is None:
            continue
        if abs(ans - dist) < 0.0051:
            continue
        if not c.get("image") or not c.get("truth_box"):
            continue
        out.append(c)
    return out


def _spoken_form(raw: str) -> str:
    """Keep a readable amount token for the claim sentence (no extra words)."""
    return str(raw).strip()


def build_cases(
    n: int = 30,
    seed: int = 7,
    voice_share: float = 0.67,
    *,
    force_sine_voice: bool = False,
    verbose: bool = True,
) -> list[dict]:
    cord = json.loads(CORD_CASES.read_text())
    pool = _eligible_cord(cord)
    if len(pool) < n:
        raise SystemExit(f"need {n} eligible CORD receipts with distinct distractors; found {len(pool)}")

    rng = random.Random(seed)
    rng.shuffle(pool)
    chosen = pool[:n]

    n_consistent = n // 2
    n_inconsistent = n - n_consistent
    verdicts = (["consistent"] * n_consistent) + (["inconsistent"] * n_inconsistent)
    rng.shuffle(verdicts)

    say_ok = _say_available()
    if not say_ok and not force_sine_voice:
        n_voice = 0
        if verbose:
            print("warning: macOS `say`/`afconvert` unavailable — all pairs use channel \"text\"")
    else:
        n_voice = int(round(n * voice_share))
    voice_flags = [True] * n_voice + [False] * (n - n_voice)
    rng.shuffle(voice_flags)

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    cases: list[dict] = []
    for i, (src, expected, use_voice) in enumerate(zip(chosen, verdicts, voice_flags), start=1):
        cid = f"cm_{i:02d}"
        receipt_value = src["answer"]
        if expected == "consistent":
            claim_raw = receipt_value
            phrasing = CONSISTENT_PHRASINGS[(i - 1) % 3]
        else:
            claim_raw = src["distractor"]
            phrasing = INCONSISTENT_PHRASINGS[(i - 1) % 3]
        spoken = _spoken_form(claim_raw)
        claim_text = phrasing.format(spoken=spoken)
        claim_value = core._amount(claim_raw)
        if claim_value is None:
            raise RuntimeError(f"unparseable claim amount for {cid}: {claim_raw!r}")

        channel = "text"
        audio_rel = None
        duration_ms = 0
        if use_voice:
            wav_path = AUDIO_DIR / f"{cid}.wav"
            try:
                duration_ms, channel = synthesize_claim_wav(
                    claim_text,
                    wav_path,
                    allow_sine_fallback=force_sine_voice or not say_ok,
                    force_sine=force_sine_voice,
                )
                audio_rel = str(wav_path.relative_to(ROOT))
            except Exception as exc:
                if verbose:
                    print(f"warning: TTS failed for {cid} ({exc}); falling back to text")
                channel = "text"
                audio_rel = None
                duration_ms = 0

        # Ensure question never embeds either numeric value.
        q = QUESTION
        for token in (str(receipt_value), str(claim_raw), spoken):
            if token and token in q:
                raise RuntimeError("question leaked a value")

        cases.append(
            {
                "id": cid,
                "modality": "cross_modal",
                "family": "receipt_vs_claim",
                "image": src["image"],
                "question": q,
                "claim_text": claim_text,
                "claim_value": claim_value,
                "claim_channel": channel,
                "audio": audio_rel,
                "duration_ms": duration_ms if channel == "voice" else 0,
                "receipt_value": receipt_value,
                "truth_box": list(src["truth_box"]),
                "expected_verdict": expected,
                "source": "CORD v2 (CC BY 4.0) + synthetic speech",
                # Convenience mirrors for tools that expect `answer` / distractor.
                "answer": expected,
                "answer_type": "text",
                "distractor": "inconsistent" if expected == "consistent" else "consistent",
            }
        )

    OUT_CASES.parent.mkdir(parents=True, exist_ok=True)
    OUT_CASES.write_text(json.dumps(cases, indent=2))
    if verbose:
        n_c = sum(1 for c in cases if c["expected_verdict"] == "consistent")
        n_i = sum(1 for c in cases if c["expected_verdict"] == "inconsistent")
        n_v = sum(1 for c in cases if c["claim_channel"] == "voice")
        print(f"wrote {OUT_CASES}  n={len(cases)}  consistent={n_c} inconsistent={n_i}  voice={n_v}")
    return cases


def main():
    ap = argparse.ArgumentParser(description="Build cross-modal receipt-vs-claim cases.")
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--voice-share", type=float, default=0.67)
    ap.add_argument(
        "--force-sine-voice",
        action="store_true",
        help="when TTS is unavailable, still emit voice-channel sine WAVs (tests)",
    )
    args = ap.parse_args()
    build_cases(
        n=args.n,
        seed=args.seed,
        voice_share=args.voice_share,
        force_sine_voice=args.force_sine_voice,
    )


if __name__ == "__main__":
    main()
