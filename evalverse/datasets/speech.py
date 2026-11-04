"""LibriSpeech conversation clips for EvalVerse audio evals (CC BY 4.0).

    pip install -r requirements-data.txt
    python -m evalverse.datasets.speech            # build 12 conversations -> data/cases_audio.json
    python -m evalverse.datasets.speech --n 12 --seed 7

Each case is five 3–10 s utterances from five different speakers, joined with 0.6 s of
silence into a single 16 kHz mono 16-bit WAV. The question asks which turn contains a
chosen keyword (alphabetic, ≥7 letters, unique to that turn).

Cite: Panayotov et al., "LibriSpeech: an ASR corpus based on public domain audio books", 2015.
"""
from __future__ import annotations

import argparse
import io
import json
import random
import re
import wave
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
AUDIO_DIR = DATA / "audio"
CASES_PATH = DATA / "cases_audio.json"

SR = 16_000
SILENCE_S = 0.6
MIN_DUR, MAX_DUR = 3.0, 10.0
UTTERANCES_PER_CONV = 5
DEFAULT_N = 12

STOPWORDS = frozenset("""
a about above after again against all am an and any are as at be because been before
being below between both but by can could did do does doing down during each few for
from further had has have having he her here hers herself him himself his how i if in
into is it its itself just me more most my myself no nor not now of off on once only or
other our ours ourselves out over own same she should so some such than that the their
theirs them themselves then there these they this those through to too under until up
very was we were what when where which while who whom why will with would you your
yours yourself yourselves
""".split())

ATTRIBUTION = (
    "LibriSpeech (openslr/librispeech_asr) is licensed under CC BY 4.0. "
    "https://www.openslr.org/12 / https://creativecommons.org/licenses/by/4.0/"
)


def _to_mono16k(samples: np.ndarray, sr: int) -> np.ndarray:
    """Resample to mono float32 at 16 kHz."""
    x = np.asarray(samples, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR and len(x) > 0:
        n_out = max(1, int(round(len(x) * SR / sr)))
        t_in = np.linspace(0.0, 1.0, num=len(x), endpoint=False)
        t_out = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
        x = np.interp(t_out, t_in, x)
    return x.astype(np.float32)


def _pcm16(samples: np.ndarray) -> np.ndarray:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def write_wav(path: Path, samples: np.ndarray, sr: int = SR) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = _pcm16(samples)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def decode_flac_bytes(raw: bytes) -> tuple[np.ndarray, int]:
    import soundfile as sf

    samples, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    return _to_mono16k(samples, sr), SR


def _duration_s(samples: np.ndarray, sr: int = SR) -> float:
    return float(len(samples)) / float(sr)


def _candidate_keywords(text: str) -> list[str]:
    words = re.findall(r"[A-Za-z]+", text)
    out = []
    seen = set()
    for w in words:
        low = w.lower()
        if len(low) < 7 or low in STOPWORDS or not low.isalpha():
            continue
        if low not in seen:
            seen.add(low)
            out.append(low)
    return out


def _keyword_index(texts: list[str]) -> dict[str, list[int]]:
    counts: dict[str, list[int]] = defaultdict(list)
    for i, t in enumerate(texts):
        for kw in _candidate_keywords(t):
            counts[kw].append(i)
    return counts


def _collect_utterances(ds, limit_scan: int, verbose: bool) -> dict[int, list[dict]]:
    """Stream LibriSpeech and bucket usable 3–10 s clips by speaker_id."""
    by_speaker: dict[int, list[dict]] = defaultdict(list)
    scanned = 0
    for row in ds:
        scanned += 1
        if scanned > limit_scan:
            break
        audio = row.get("audio") or {}
        raw = audio.get("bytes")
        if not raw:
            continue
        try:
            samples, _sr = decode_flac_bytes(raw)
        except Exception:
            continue
        dur = _duration_s(samples)
        if not (MIN_DUR <= dur <= MAX_DUR):
            continue
        sid = int(row["speaker_id"])
        text = (row.get("text") or "").strip()
        if not text:
            continue
        by_speaker[sid].append({
            "speaker_id": sid,
            "text": text,
            "samples": samples,
            "duration_s": dur,
        })
        if verbose and scanned % 200 == 0:
            n_spk = len(by_speaker)
            n_utt = sum(len(v) for v in by_speaker.values())
            print(f"  scanned {scanned}: {n_spk} speakers, {n_utt} usable utterances")
        if len(by_speaker) >= 60 and sum(len(v) for v in by_speaker.values()) >= 200:
            # enough variety for 12 × 5 distinct speakers
            if all(len(v) >= 1 for v in list(by_speaker.values())[:40]):
                break
    return by_speaker


def build_cases(
    n: int = DEFAULT_N,
    seed: int = 7,
    out_dir: Path = AUDIO_DIR,
    scan_limit: int = 5000,
    verbose: bool = True,
) -> list[dict]:
    try:
        from datasets import Audio, load_dataset
    except ImportError:
        raise SystemExit("Run: pip install -r requirements-data.txt")

    print(ATTRIBUTION)
    rng = random.Random(seed)
    out_dir.mkdir(parents=True, exist_ok=True)

    ds = load_dataset("openslr/librispeech_asr", "clean", split="test", streaming=True)
    ds = ds.cast_column("audio", Audio(decode=False))

    if verbose:
        print("streaming LibriSpeech clean/test …")
    by_speaker = _collect_utterances(ds, scan_limit, verbose)
    speakers = [s for s, utts in by_speaker.items() if utts]
    if len(speakers) < UTTERANCES_PER_CONV:
        raise SystemExit(
            f"need ≥{UTTERANCES_PER_CONV} speakers with usable clips; found {len(speakers)}"
        )

    silence = np.zeros(int(SR * SILENCE_S), dtype=np.float32)
    turn_targets = list(range(1, UTTERANCES_PER_CONV + 1)) * ((n // UTTERANCES_PER_CONV) + 1)
    rng.shuffle(turn_targets)
    turn_targets = turn_targets[:n]

    cases: list[dict] = []
    used_speakers: set[int] = set()
    attempts = 0
    max_attempts = n * 80

    while len(cases) < n and attempts < max_attempts:
        attempts += 1
        want_turn0 = turn_targets[len(cases)] - 1
        pool = [s for s in speakers if s not in used_speakers]
        if len(pool) < UTTERANCES_PER_CONV:
            pool = list(speakers)
        chosen_speakers = rng.sample(pool, UTTERANCES_PER_CONV)
        picks = [rng.choice(by_speaker[sid]) for sid in chosen_speakers]
        texts = [p["text"] for p in picks]
        uniques = [(kw, idxs[0]) for kw, idxs in _keyword_index(texts).items() if len(idxs) == 1]
        if not uniques:
            continue
        prefer = [u for u in uniques if u[1] == want_turn0]
        if not prefer:
            # rotate turns so a random unique keyword lands on the target index
            keyword, src0 = rng.choice(uniques)
            if src0 != want_turn0:
                picks[src0], picks[want_turn0] = picks[want_turn0], picks[src0]
                texts = [p["text"] for p in picks]
                uniques = [
                    (kw, idxs[0]) for kw, idxs in _keyword_index(texts).items() if len(idxs) == 1
                ]
                prefer = [u for u in uniques if u[1] == want_turn0 and u[0] == keyword]
                if not prefer:
                    prefer = [u for u in uniques if u[1] == want_turn0]
                if not prefer:
                    continue
        keyword, kw_turn0 = rng.choice(prefer)
        answer_turn = kw_turn0 + 1

        cid = f"conv_{len(cases) + 1:02d}"
        turns_meta = []
        parts: list[np.ndarray] = []
        cursor_ms = 0
        for ti, p in enumerate(picks, start=1):
            clip_path = out_dir / f"{cid}_t{ti}.wav"
            write_wav(clip_path, p["samples"])
            dur_ms = int(round(_duration_s(p["samples"]) * 1000))
            start_ms = cursor_ms
            end_ms = start_ms + dur_ms
            turns_meta.append({
                "index": ti,
                "speaker_id": p["speaker_id"],
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": p["text"],
                "clip": str(clip_path.relative_to(ROOT)),
            })
            parts.append(p["samples"])
            if ti < UTTERANCES_PER_CONV:
                parts.append(silence)
                cursor_ms = end_ms + int(round(SILENCE_S * 1000))
            else:
                cursor_ms = end_ms

        joined = np.concatenate(parts)
        conv_path = out_dir / f"{cid}.wav"
        write_wav(conv_path, joined)
        duration_ms = int(round(_duration_s(joined) * 1000))
        ans_turn = turns_meta[answer_turn - 1]
        cases.append({
            "id": cid,
            "modality": "audio",
            "family": "librispeech_conversation",
            "audio": str(conv_path.relative_to(ROOT)),
            "duration_ms": duration_ms,
            "turns": turns_meta,
            "question": (
                f"In which turn does a speaker say the word '{keyword}'? "
                "Answer with the turn number only."
            ),
            "answer": str(answer_turn),
            "answer_type": "text",
            "keyword": keyword,
            "truth_span": [ans_turn["start_ms"], ans_turn["end_ms"]],
            "source": "LibriSpeech (CC BY 4.0)",
        })
        used_speakers.update(chosen_speakers)
        if verbose:
            print(
                f"  {cid}: answer turn {answer_turn}, keyword={keyword!r}, "
                f"speakers={[t['speaker_id'] for t in turns_meta]}"
            )

    if len(cases) < n:
        raise SystemExit(f"only built {len(cases)}/{n} conversations; try a larger --scan-limit")

    DATA.mkdir(parents=True, exist_ok=True)
    CASES_PATH.write_text(json.dumps(cases, indent=2))
    if verbose:
        balance = {str(i): 0 for i in range(1, UTTERANCES_PER_CONV + 1)}
        for c in cases:
            balance[c["answer"]] = balance.get(c["answer"], 0) + 1
        print(f"built {len(cases)} cases; answer-turn balance {balance}")
        print(f"wrote {CASES_PATH} and wavs in {out_dir}")
    return cases


def main():
    ap = argparse.ArgumentParser(description="Build LibriSpeech conversation audio cases")
    ap.add_argument("--n", type=int, default=DEFAULT_N, help="number of conversations (default 12)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--scan-limit", type=int, default=5000, help="max streaming rows to scan")
    ap.add_argument("--out-dir", type=Path, default=AUDIO_DIR)
    args = ap.parse_args()
    build_cases(n=args.n, seed=args.seed, out_dir=args.out_dir, scan_limit=args.scan_limit)


if __name__ == "__main__":
    main()
