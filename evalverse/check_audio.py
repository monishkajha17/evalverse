"""Live check for the speech-to-text endpoint (Muse Voice Transcribe). Run:

    python -m evalverse.check_audio               # macOS: makes its own test clip
    python -m evalverse.check_audio --wav my.wav  # or use your own 16 kHz mono 16-bit WAV

The file endpoint is POST https://api.meta.ai/v1/asr/transcribe (multipart upload, Bearer token,
mono 16-bit PCM WAV at 16 or 24 kHz). The body has two parts: `request` (application/json) and
`audio` (audio/wav). This tries a few request objects and, when an error names a missing or invalid
field, fixes that field and retries. Paste the whole output.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
import wave
from pathlib import Path

URL = "https://api.meta.ai/v1/asr/transcribe"
MODEL = "muse-voice-transcribe-1.0"
SENTENCE = "Hi, I would like to book a haircut this Thursday afternoon. Do you have anything at three thirty?"


def make_clip(path: Path) -> bool:
    if sys.platform != "darwin":
        return False
    aiff = path.with_suffix(".aiff")
    try:
        subprocess.run(["say", "-o", str(aiff), SENTENCE], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(path)], check=True)
        return True
    except Exception as e:
        print("could not synthesize a clip:", e)
        return False


def multipart(fields: dict, file_field: str, filename: str, data: bytes):
    """Multipart body. A part named `request` is sent as application/json; the file part is audio/wav."""
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        if k == "request":
            raw = v if isinstance(v, str) else json.dumps(v)
            parts.append(
                (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{k}"\r\n'
                    f"Content-Type: application/json\r\n"
                    f"\r\n{raw}\r\n"
                ).encode()
            )
        else:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
                  f'Content-Type: audio/wav\r\n\r\n').encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def post(key, request_obj, wav_bytes):
    body, ctype = multipart({"request": json.dumps(request_obj)}, "audio", "clip.wav", wav_bytes)
    req = urllib.request.Request(
        URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": ctype,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except urllib.error.URLError as e:
        return None, f"request failed: {e}"


_IDENT = r"[A-Za-z][A-Za-z0-9_]*"
_SKIP = {
    "body", "request", "audio", "header", "query", "path", "detail", "error", "message", "msg",
    "loc", "type", "ctx", "input", "url", "field", "fields", "property", "parameter", "value",
    "string", "boolean", "object", "array", "null", "true", "false", "code", "status",
}
_MODES = ("PUSH_TO_TALK", "ENDPOINTING", "DIARIZATION")
_CANON = {
    "model": "model",
    "audioencoding": "audioEncoding",
    "encoding": "audioEncoding",
    "mode": "mode",
    "diarization": "diarization",
    "keywords": "keywords",
    "languagebias": "languageBias",
    "partialmode": "partialMode",
    "emitaudioprogress": "emitAudioProgress",
    "samplerate": "sampleRate",
    "language": "language",
}
_DEFAULTS = {
    "model": MODEL,
    "audioEncoding": "WAV",
    "mode": "PUSH_TO_TALK",
    "diarization": True,
    "keywords": ["haircut"],
    "languageBias": ["English"],
    "partialMode": "CUMULATIVE",
    "emitAudioProgress": True,
    "sampleRate": 16000,
    "language": "English",
}
_FIELD = rf"[:\s]\s*[`\"']?({_IDENT})"
_MISSING_RES = [
    re.compile(rf"\bmissing(?:\s+required)?(?:\s+(?:field|property|parameter|argument))?{_FIELD}", re.I),
    re.compile(rf"[`\"']({_IDENT})[`\"']\s+is (?:missing|required)\b", re.I),
    re.compile(rf"\b({_IDENT})\s+is (?:missing|required)\b", re.I),
    re.compile(rf"\brequired(?:\s+(?:field|property|parameter))?{_FIELD}", re.I),
    re.compile(rf"\b({_IDENT})\s*:\s*(?:required(?:\s+field)?(?:\s+missing)?|field required|missing)\b", re.I),
    re.compile(rf"\bmust (?:include|contain|provide|specify|set)\s+[`\"']?({_IDENT})", re.I),
    re.compile(rf"\b({_IDENT})\s+must be (?:set|provided|specified|present)\b", re.I),
    re.compile(rf"\b(?:field|property|parameter)\s+[`\"']({_IDENT})[`\"']\s+is (?:missing|required)\b", re.I),
]
_INVALID_RES = [
    re.compile(rf"\binvalid(?:\s+value(?:\s+for)?)?(?:\s+(?:field|property|parameter))?{_FIELD}", re.I),
    re.compile(rf"[`\"']({_IDENT})[`\"']\s+is (?:invalid|not (?:a )?valid|not allowed|not supported)\b", re.I),
    re.compile(rf"\b({_IDENT})\s+(?:is\s+)?(?:invalid|not (?:a )?valid|not allowed|not supported)\b", re.I),
    re.compile(rf"\b({_IDENT})\s+must be\b", re.I),
]
_UNKNOWN_RES = [
    re.compile(rf"\b(?:unknown|unexpected|unrecognized)(?:\s+(?:field|property|parameter))?{_FIELD}", re.I),
    re.compile(rf"\badditional propert(?:y|ies)[^A-Za-z0-9_`\"']*[`\"']?({_IDENT})", re.I),
    re.compile(rf"\bextra (?:field|property|parameter)s?{_FIELD}", re.I),
    re.compile(rf"[`\"']({_IDENT})[`\"']\s+is (?:an )?(?:unknown|unexpected|unrecognized)\b", re.I),
]


def _canon(name: str) -> str | None:
    if not name or name.lower() in _SKIP:
        return None
    key = re.sub(r"[^A-Za-z0-9]", "", name)
    mapped = _CANON.get(key.lower())
    if mapped:
        return mapped
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return name
    return None


_ENUMS = {"WAV", "PCM_16KHZ", "PCM_24KHZ", "PUSH_TO_TALK", "ENDPOINTING", "DIARIZATION", "CUMULATIVE", "DELTA"}
_TOKEN_SKIP = _SKIP | {
    "HTTP", "JSON", "POST", "GET", "API", "ERROR", "INVALID", "MISSING", "REQUIRED",
    "FIELD", "NULL", "TRUE", "FALSE", "NONE", "URL", "ID",
}


def _tokens(chunk: str) -> list:
    """Enum-like values named by an error, not ordinary words in the message."""
    found = []

    def add(raw: str) -> None:
        text = raw.strip().strip("`\"'")
        if not text or text.upper() in _TOKEN_SKIP or text.lower() in _SKIP:
            return
        if text.lower() in ("true", "false"):
            value = text.lower() == "true"
        elif re.fullmatch(r"\d+", text):
            value = int(text)
        elif text.upper() in _ENUMS or re.fullmatch(r"[A-Z][A-Z0-9_]{2,}", text):
            value = text.upper()
        else:
            return
        if value not in found:
            found.append(value)

    for raw in re.findall(r"\b([A-Z][A-Z0-9_]{1,})\b", chunk):
        add(raw)
    for match in re.finditer(r"(?:one of|must be|expected|allowed(?:\s+values?)?|valid(?:\s+values?)?)\s*[:\[]\s*([^\n\]]+)", chunk, re.I):
        for raw in re.findall(r"[A-Za-z0-9_]+", match.group(1)):
            add(raw)
    return found


def _add_problem(found: dict, name: str, kind: str, allowed: list | None = None) -> None:
    field = _canon(name)
    if not field:
        return
    rank = {"missing": 1, "invalid": 2, "unknown": 3}[kind]
    prev = found.get(field)
    if prev and prev[0] >= rank:
        if allowed:
            prev[2].extend(a for a in allowed if a not in prev[2])
        return
    found[field] = [rank, kind, list(allowed or [])]


def _problems_from_json(obj, found: dict) -> None:
    if isinstance(obj, list):
        for item in obj:
            _problems_from_json(item, found)
        return
    if not isinstance(obj, dict):
        return
    loc = obj.get("loc")
    if isinstance(loc, (list, tuple)) and loc:
        names = [str(x) for x in loc if isinstance(x, (str, int))]
        field = next((n for n in reversed(names) if n.lower() not in _SKIP), None)
        blob = f"{obj.get('type', '')} {obj.get('msg', '')} {obj.get('message', '')}".lower()
        if field:
            if any(w in blob for w in ("extra", "unexpected", "unknown", "not permitted")):
                kind = "unknown"
            elif any(w in blob for w in ("missing", "required")):
                kind = "missing"
            else:
                kind = "invalid"
            _add_problem(found, field, kind, _tokens(f"{obj.get('msg', '')} {obj.get('message', '')}"))
    param = obj.get("param") or obj.get("field") or obj.get("property")
    if isinstance(param, str):
        blob = f"{obj.get('code', '')} {obj.get('type', '')} {obj.get('message', '')} {obj.get('msg', '')}".lower()
        if any(w in blob for w in ("unknown", "unexpected", "unrecognized", "additional")):
            kind = "unknown"
        elif any(w in blob for w in ("missing", "required")):
            kind = "missing"
        else:
            kind = "invalid"
        _add_problem(found, param, kind, _tokens(blob))
    for key, kind in (("missing", "missing"), ("missing_fields", "missing"), ("required", "missing"),
                      ("invalid", "invalid"), ("invalid_fields", "invalid"),
                      ("unknown_fields", "unknown"), ("unexpected", "unknown")):
        values = obj.get(key)
        if isinstance(values, list):
            for item in values:
                if isinstance(item, str):
                    _add_problem(found, item, kind)
        elif isinstance(values, str):
            _add_problem(found, values, kind)
    for value in obj.values():
        if isinstance(value, (dict, list)):
            _problems_from_json(value, found)


def find_problems(body: str) -> list[tuple[str, str, list]]:
    found: dict = {}
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        parsed = None
    if parsed is not None:
        _problems_from_json(parsed, found)
    text = body
    for cre in _MISSING_RES:
        for match in cre.finditer(text):
            window = text[max(0, match.start() - 80): match.end() + 180]
            _add_problem(found, match.group(1), "missing", _tokens(window))
    for cre in _UNKNOWN_RES:
        for match in cre.finditer(text):
            window = text[max(0, match.start() - 80): match.end() + 180]
            _add_problem(found, match.group(1), "unknown", _tokens(window))
    for cre in _INVALID_RES:
        for match in cre.finditer(text):
            window = text[max(0, match.start() - 80): match.end() + 180]
            _add_problem(found, match.group(1), "invalid", _tokens(window))
    # Comma-separated lists: "missing fields: model, audioEncoding"
    for match in re.finditer(r"(missing|required|invalid|unknown|unexpected)\s+(?:fields|properties|parameters)\s*:\s*([A-Za-z0-9_, `\"']+)", text, re.I):
        kind = "missing" if match.group(1).lower() in ("missing", "required") else (
            "unknown" if match.group(1).lower() in ("unknown", "unexpected") else "invalid"
        )
        for name in re.findall(_IDENT, match.group(2)):
            _add_problem(found, name, kind, _tokens(text[match.end(): match.end() + 180]))
    return [(field, kind, allowed) for field, (_rank, kind, allowed) in found.items()]


def _choose(field: str, payload: dict, allowed: list, *, invalid: bool):
    usable = []
    for item in allowed:
        if isinstance(item, str) and item.lower() in _SKIP:
            continue
        if item not in usable:
            usable.append(item)
    current = payload.get(field)

    def pick(options):
        for item in options:
            if invalid and item == current:
                continue
            return item
        return None

    if field == "audioEncoding":
        encodings = [str(item).upper() for item in usable if str(item).upper() in _ENUMS and str(item).upper() in {"WAV", "PCM_16KHZ", "PCM_24KHZ"} or str(item).upper().startswith("PCM_")]
        for item in encodings:
            if item == "WAV" and not (invalid and current == "WAV"):
                return "WAV"
        chosen = pick(encodings)
        if chosen is not None:
            return chosen
        return None if invalid and current == "WAV" else "WAV"
    if field == "mode":
        modes = [str(item).upper() for item in usable if str(item).upper() in _MODES]
        want_diarization = payload.get("diarization") is True or current == "DIARIZATION"
        if want_diarization and (not modes or "DIARIZATION" in modes):
            return "DIARIZATION"
        if current and str(current).upper() in (modes or _MODES):
            return str(current).upper()
        if not modes or "PUSH_TO_TALK" in modes:
            return None if current == "PUSH_TO_TALK" else "PUSH_TO_TALK"
        return modes[0]
    if usable:
        chosen = pick(usable)
        if chosen is not None:
            return chosen
    if field in _DEFAULTS and not (invalid and current == _DEFAULTS[field]):
        return _DEFAULTS[field]
    return None


def repair(payload: dict, body: str) -> dict | None:
    """Return a new request object when `body` names a missing or invalid field."""
    problems = find_problems(body)
    if not problems:
        return None
    updated = dict(payload)
    changed = False
    for field, kind, allowed in problems:
        if kind == "unknown" or (
            field == "diarization"
            and kind == "invalid"
            and any(str(item).upper() in _MODES for item in allowed)
        ):
            if field in updated:
                updated.pop(field, None)
                changed = True
            if field == "diarization" and updated.get("mode") != "DIARIZATION":
                updated["mode"] = "DIARIZATION"
                changed = True
            continue
        if kind == "missing" and field in updated and updated[field] not in (None, "", [], {}):
            continue
        value = _choose(field, updated, allowed, invalid=(kind == "invalid"))
        if value is None:
            continue
        if updated.get(field) != value:
            updated[field] = value
            changed = True
    if not changed or updated == payload:
        return None
    return updated


def _sig(obj: dict) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", default=None)
    args = ap.parse_args()
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise SystemExit("Set MODEL_API_KEY first.")
    if args.wav:
        wav = Path(args.wav)
    else:
        wav = Path(tempfile.gettempdir()) / "evalverse_check.wav"
        if not make_clip(wav):
            raise SystemExit("No clip available. Pass --wav path/to/16k_mono_16bit.wav")
    with wave.open(str(wav)) as w:
        print(f"clip: {wav}  {w.getframerate()} Hz, {w.getnchannels()} ch, {w.getsampwidth() * 8}-bit, {w.getnframes() / w.getframerate():.1f}s")
    data = wav.read_bytes()

    start = {"model": MODEL}
    queue = [start, {}, {**start, "diarization": True}]
    seen = set()
    ok = False
    attempt = 0
    while queue and attempt < 8:
        payload = queue.pop(0)
        signature = _sig(payload)
        if signature in seen:
            continue
        seen.add(signature)
        attempt += 1
        print(f"\n--- attempt {attempt}")
        print(json.dumps(payload))
        status, text = post(key, payload, data)
        if status is None:
            print(text[:1500])
        else:
            print(f"HTTP {status}")
            print(text[:1500])
        if status == 200:
            ok = True
            print("\nfull JSON body:")
            print(text)
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as e:
                print("body is not JSON:", e)
            else:
                if isinstance(parsed, dict):
                    print("top-level keys:", list(parsed.keys()))
                else:
                    print("top-level type:", type(parsed).__name__)
            break
        fixed = repair(payload, text)
        if fixed and _sig(fixed) not in seen and all(_sig(item) != _sig(fixed) for item in queue):
            queue.append(fixed)
    print("\nRESULT:", "endpoint works, paste this output to me." if ok else "no attempt succeeded, paste this output to me.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
