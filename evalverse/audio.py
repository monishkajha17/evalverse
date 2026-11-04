"""Audio utilities for EvalVerse's speech-to-text evaluation slice."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

from .check_audio import URL, multipart

ROOT = Path(__file__).resolve().parent.parent
ASR_CACHE = ROOT / "out" / "asr"
ASR_REQUEST = {"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV"}


def perturb_audio(samples, sr: int, condition: str, seed: int = 0):
    """Return deterministic float audio for the requested degradation."""
    x = np.asarray(samples, dtype=np.float32).reshape(-1).copy()
    if condition == "clean":
        return x
    if condition == "noise":
        signal_rms = float(np.sqrt(np.mean(x * x)))
        if signal_rms == 0:
            return x
        noise_rms = signal_rms / (10 ** (10 / 20))  # 10 dB SNR
        rng = np.random.default_rng(seed)
        return np.clip(x + rng.normal(0, noise_rms, x.shape).astype(np.float32), -1.0, 1.0)
    if condition == "bandlimit":
        freqs = np.fft.rfftfreq(len(x), d=1 / sr)
        spectrum = np.fft.rfft(x)
        spectrum[(freqs < 300) | (freqs > 3400)] = 0
        return np.fft.irfft(spectrum, n=len(x)).astype(np.float32)
    raise ValueError(f"unknown condition {condition}")


def wav_bytes(samples, sr: int) -> bytes:
    """Encode mono float samples as a standards-compliant 16-bit PCM WAV."""
    import io
    import wave

    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1, 1)
    pcm = (clipped * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sr)
        out.writeframes(pcm)
    return buf.getvalue()


def _asr_request(key: str, audio: bytes) -> tuple[int | None, str]:
    body, content_type = multipart({"request": json.dumps(ASR_REQUEST)}, "audio", "clip.wav", audio)
    request = urllib.request.Request(
        URL,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": content_type, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return None, str(exc)


def transcribe(wav: bytes, *, retries: int = 3) -> dict:
    """Transcribe a WAV using the verified multipart endpoint and disk cache."""
    digest = hashlib.sha1(wav).hexdigest()
    path = ASR_CACHE / f"{digest}.json"
    if path.exists():
        return json.loads(path.read_text())
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise RuntimeError("Set MODEL_API_KEY first.")
    last = None
    for attempt in range(retries):
        status, text = _asr_request(key, wav)
        if status == 200:
            try:
                out = json.loads(text)
            except json.JSONDecodeError as exc:
                last = RuntimeError(f"ASR returned invalid JSON: {exc}")
            else:
                ASR_CACHE.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(out, indent=1))
                return out
        else:
            last = RuntimeError(f"ASR HTTP {status}: {text[:500]}")
        if attempt + 1 < retries:
            time.sleep(1 + attempt)
    raise last or RuntimeError("ASR request failed")


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", str(text).lower())


def wer(ref: str, hyp: str) -> float:
    """Word error rate using word-level Levenshtein distance, with no dependencies."""
    target, actual = _words(ref), _words(hyp)
    if not target:
        return 0.0 if not actual else 1.0
    previous = list(range(len(actual) + 1))
    for i, expected in enumerate(target, 1):
        current = [i]
        for j, observed in enumerate(actual, 1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (expected != observed),
            ))
        previous = current
    return previous[-1] / len(target)
