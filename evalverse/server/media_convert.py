"""Transcode browser audio containers to 16 kHz mono PCM WAV via bundled ffmpeg."""

from __future__ import annotations

import io
import subprocess
import tempfile
from pathlib import Path


class MediaConvertError(Exception):
    """Raised when audio cannot be decoded or transcoded."""


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
    except ImportError as exc:  # pragma: no cover
        raise MediaConvertError("imageio-ffmpeg is not installed") from exc
    return imageio_ffmpeg.get_ffmpeg_exe()


def _suffix_for(data: bytes) -> str:
    if data.startswith(b"OggS"):
        return ".ogg"
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return ".m4a"
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return ".mp3"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ".wav"
    return ".bin"


def transcode_to_wav16k_mono(data: bytes) -> tuple[bytes, float]:
    """Decode *data* with ffmpeg → 16 kHz mono 16-bit PCM WAV.

    Returns ``(wav_bytes, duration_seconds)``.
    """
    if not data:
        raise MediaConvertError("empty audio")

    # Fast path: already WAV — still normalize via soundfile when possible.
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        try:
            return _soundfile_to_wav16k(data)
        except Exception:
            pass

    try:
        return _soundfile_to_wav16k(data)
    except Exception:
        pass

    return _ffmpeg_to_wav16k(data)


def _soundfile_to_wav16k(data: bytes) -> tuple[bytes, float]:
    import numpy as np
    import soundfile as sf

    from evalverse import audio as audio_mod

    samples, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    x = np.asarray(samples, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    target_sr = 16000
    if int(sr) != target_sr and len(x) > 0:
        n_out = max(1, int(round(len(x) * target_sr / float(sr))))
        t_in = np.linspace(0.0, 1.0, num=len(x), endpoint=False)
        t_out = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
        x = np.interp(t_out, t_in, x)
    x = x.astype(np.float32)
    dur = float(len(x)) / float(target_sr) if len(x) else 0.0
    return audio_mod.wav_bytes(x, target_sr), dur


def _ffmpeg_to_wav16k(data: bytes) -> tuple[bytes, float]:
    import wave

    ff = ffmpeg_exe()
    suffix = _suffix_for(data)
    with tempfile.TemporaryDirectory(prefix="ev-audio-") as td:
        src = Path(td) / f"in{suffix}"
        dst = Path(td) / "out.wav"
        src.write_bytes(data)
        proc = subprocess.run(
            [
                ff,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(src),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                str(dst),
            ],
            capture_output=True,
            timeout=60,
        )
        if proc.returncode != 0 or not dst.is_file() or dst.stat().st_size < 44:
            err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            raise MediaConvertError(err or "ffmpeg could not decode audio")
        wav = dst.read_bytes()
        # Duration from WAV header
        with wave.open(io.BytesIO(wav), "rb") as w:
            frames = w.getnframes()
            rate = w.getframerate() or 16000
            dur = float(frames) / float(rate) if rate else 0.0
        return wav, dur


def probe_duration_s(data: bytes, modality: str) -> float | None:
    """Best-effort duration via ffmpeg for containers soundfile cannot read."""
    if modality not in ("audio", "video"):
        return None
    try:
        ff = ffmpeg_exe()
    except MediaConvertError:
        return None
    suffix = _suffix_for(data) if modality == "audio" else (".webm" if data.startswith(b"\x1a\x45\xdf\xa3") else ".mp4")
    with tempfile.TemporaryDirectory(prefix="ev-probe-") as td:
        src = Path(td) / f"in{suffix}"
        src.write_bytes(data)
        proc = subprocess.run(
            [ff, "-hide_banner", "-i", str(src)],
            capture_output=True,
            timeout=30,
        )
        # ffmpeg prints Duration to stderr even on "error" exit for probe-only
        text = (proc.stderr or b"").decode("utf-8", errors="replace")
        # Duration: 00:00:00.50
        import re

        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
        if not m:
            return None
        h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
        return h * 3600 + mi * 60 + s
