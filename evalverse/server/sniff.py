"""Content-type sniffing for playground uploads — never trust the filename."""

from __future__ import annotations

from typing import Any

# (modality, mime, extension)
AllowedKind = tuple[str, str, str]

_EXECUTABLE_MAGIC = (
    b"\x7fELF",  # ELF
    b"MZ",  # PE / DOS
    b"\xca\xfe\xba\xbe",  # Mach-O fat / Java class (also)
    b"\xcf\xfa\xed\xfe",  # Mach-O 32 LE
    b"\xce\xfa\xed\xfe",  # Mach-O 32 BE
    b"\xcf\xfa\xed\xfe",
    b"\xfe\xed\xfa\xce",
    b"\xfe\xed\xfa\xcf",
)


def _is_executable(data: bytes) -> bool:
    if len(data) < 4:
        return False
    head = data[:4]
    for mag in _EXECUTABLE_MAGIC:
        if data.startswith(mag):
            return True
    # Mach-O 64-bit
    if head in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"):
        return True
    if data[:2] == b"#!":
        return True
    return False


def sniff_upload(data: bytes) -> AllowedKind | None:
    """Return (modality, mime, ext) or None if not on the allowlist."""
    if not data or _is_executable(data):
        return None
    # PNG
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("image", "image/png", ".png")
    # JPEG
    if data.startswith(b"\xff\xd8\xff"):
        return ("image", "image/jpeg", ".jpg")
    # WEBP
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("image", "image/webp", ".webp")
    # WAV
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ("audio", "audio/wav", ".wav")
    # MP3: ID3 tag or frame sync
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return ("audio", "audio/mpeg", ".mp3")
    # MP4 / M4A (ISO BMFF ftyp)
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12]
        # Common audio brands
        if brand in (b"M4A ", b"M4B ", b"mp4a", b"isom") or b"M4A" in data[8:24]:
            # Prefer audio for M4A; mp4/isom often video — inspect further
            if brand in (b"M4A ", b"M4B ", b"mp4a"):
                return ("audio", "audio/mp4", ".m4a")
        # Video brands
        if brand in (b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"MSNV", b"dash") or data[8:12] == b"mp42":
            return ("video", "video/mp4", ".mp4")
        # Default ftyp → mp4 video (tests use simple mp4)
        return ("video", "video/mp4", ".mp4")
    # WebM / Matroska
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return ("video", "video/webm", ".webm")
    return None


def media_duration_s(data: bytes, modality: str) -> float | None:
    """Best-effort duration in seconds for audio/video."""
    try:
        if modality == "audio":
            import io

            import soundfile as sf

            info = sf.info(io.BytesIO(data))
            return float(info.duration)
        if modality == "video":
            import tempfile
            from pathlib import Path

            import imageio.v2 as imageio

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(data)
                path = Path(tmp.name)
            try:
                reader = imageio.get_reader(str(path))
                try:
                    meta = reader.get_meta_data()
                    fps = float(meta.get("fps") or 0) or 10.0
                    n = None
                    try:
                        n = int(reader.count_frames())
                    except Exception:
                        n = sum(1 for _ in reader)
                    return float(n) / fps if n else None
                finally:
                    reader.close()
            finally:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
    except Exception:
        return None
    return None
