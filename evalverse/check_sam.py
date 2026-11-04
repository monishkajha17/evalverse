"""Probe Meta Model API SAM 3.1 (Segment Anything) request shapes.

Docs: https://dev.meta.ai/docs/sam/segmenting
Endpoint: POST https://api.meta.ai/v1/responses  model=sam-3.1

    python -m evalverse.check_sam \\
        --image data/images_cord/cord_total_01.jpg \\
        --prompt "receipt total line"

Prints each attempt's request body (API key never printed), HTTP status, and the
first 1500 characters of the reply. Stops at the first HTTP 200. On success,
prints top-level response keys and writes mask/polygon data to out/sam_probe.json.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
URL = "https://api.meta.ai/v1/responses"
MODEL = "sam-3.1"
OUT = ROOT / "out" / "sam_probe.json"
REPLY_CHARS = 1500


def say(msg: str = "") -> None:
    print(msg, flush=True)


def _redact_secrets(text: str) -> str:
    """Strip anything that looks like a bearer/API key from printable text."""
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9_\-\.]+", r"\1[REDACTED]", text)
    text = re.sub(
        r"(?i)(api[_-]?key|authorization)([\"'\s:=]+)[A-Za-z0-9_\-\.]{8,}",
        r"\1\2[REDACTED]",
        text,
    )
    return text


def _data_url(path: Path) -> str:
    raw = path.read_bytes()
    mime = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    if path.suffix.lower() in (".jpg", ".jpeg"):
        mime = "image/jpeg"
    elif path.suffix.lower() == ".png":
        mime = "image/png"
    elif path.suffix.lower() == ".webp":
        mime = "image/webp"
    b64 = base64.standard_b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _printable_body(body: dict[str, Any]) -> str:
    """JSON for logging — truncate huge data URLs so the console stays readable."""

    def trim(obj: Any) -> Any:
        if isinstance(obj, dict):
            return {k: trim(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [trim(x) for x in obj]
        if isinstance(obj, str) and obj.startswith("data:") and len(obj) > 120:
            head, _, rest = obj.partition(",")
            return f"{head},<{len(rest)} base64 chars>"
        return obj

    return json.dumps(trim(body), indent=2)


def _user_message(content: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "message", "role": "user", "content": content}


def documented_attempts(prompt: str, image_url: str) -> list[tuple[str, dict[str, Any], dict[str, str]]]:
    """Named request shapes from https://dev.meta.ai/docs/sam/segmenting."""
    concept_parts = [
        {"type": "input_text", "text": prompt},
        {"type": "input_image", "image_url": image_url},
    ]
    image_first = [
        {"type": "input_image", "image_url": image_url},
        {"type": "input_text", "text": prompt},
    ]
    attempts: list[tuple[str, dict[str, Any], dict[str, str]]] = [
        (
            "documented non-stream (stream=false)",
            {
                "model": MODEL,
                "input": [_user_message(concept_parts)],
                "stream": False,
            },
            {"Accept": "application/json"},
        ),
        (
            "documented stream=true (SSE)",
            {
                "model": MODEL,
                "input": [_user_message(concept_parts)],
                "stream": True,
            },
            {"Accept": "text/event-stream"},
        ),
        (
            "documented + include_confidence",
            {
                "model": MODEL,
                "input": [_user_message(concept_parts)],
                "stream": False,
                "include_confidence": "true",
            },
            {"Accept": "application/json"},
        ),
        (
            "documented image-first content order",
            {
                "model": MODEL,
                "input": [_user_message(image_first)],
                "stream": False,
            },
            {"Accept": "application/json"},
        ),
        (
            "documented image_url as {url: ...} object",
            {
                "model": MODEL,
                "input": [
                    _user_message(
                        [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": {"url": image_url}},
                        ]
                    )
                ],
                "stream": False,
            },
            {"Accept": "application/json"},
        ),
    ]
    return attempts


def _post(key: str, body: dict[str, Any], extra_headers: dict[str, str]) -> tuple[int, str]:
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        **extra_headers,
    }
    raw = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(URL, data=raw, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            status = getattr(resp, "status", 200) or 200
            data = resp.read()
            return int(status), data.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        data = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
        return int(e.code), data
    except urllib.error.URLError as e:
        return 0, f"URLError: {e.reason}"


def _collect_sse_text(reply: str) -> str:
    """Concatenate output_text deltas from an SSE Responses stream."""
    chunks: list[str] = []
    for line in reply.splitlines():
        if not line.startswith("data: "):
            continue
        payload = line[6:].strip()
        if payload == "[DONE]":
            break
        try:
            event = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "response.output_text.delta":
            delta = event.get("delta")
            if isinstance(delta, str):
                chunks.append(delta)
        elif event.get("type") == "response.completed":
            resp = event.get("response")
            if isinstance(resp, dict):
                # Prefer completed response if present
                text = _extract_output_text(resp)
                if text:
                    return text
    return "".join(chunks)


def _extract_output_text(obj: Any) -> str:
    if not isinstance(obj, dict):
        return ""
    # Common Responses shapes
    for key in ("output_text", "text"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val
    out = obj.get("output")
    if isinstance(out, list):
        parts: list[str] = []
        for item in out:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        t = c.get("text") or c.get("output_text") or c.get("delta")
                        if isinstance(t, str):
                            parts.append(t)
            t2 = item.get("text")
            if isinstance(t2, str):
                parts.append(t2)
        if parts:
            return "".join(parts)
    choices = obj.get("choices")
    if isinstance(choices, list) and choices:
        msg = (choices[0] or {}).get("message") or {}
        if isinstance(msg, dict) and isinstance(msg.get("content"), str):
            return msg["content"]
    return ""


def _parse_sam_records(text: str) -> list[dict[str, Any]]:
    """Best-effort parse of SAM special-token lines into boxes/masks."""
    records: list[dict[str, Any]] = []
    if not text or not text.strip():
        return records
    # Frame lines look like: <0f>id<|box;...|><|mask;...|>,id<|box;...|>...
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        frame_m = re.match(r"^<(\d+)f>(.*)$", line)
        frame = int(frame_m.group(1)) if frame_m else 0
        body = frame_m.group(2) if frame_m else line
        for m in re.finditer(
            r"(\d+)<\|box;([^|]+)\|>(?:<\|mask;([^|]+)\|>)?",
            body,
        ):
            oid = int(m.group(1))
            box_fields = dict(
                kv.split("=", 1) for kv in m.group(2).split(";") if "=" in kv
            )
            mask_raw = m.group(3)
            mask: dict[str, Any] | None = None
            if mask_raw:
                # data=H,W,~payload  — keep payload truncated in probe dump
                parts = {}
                data_val = None
                for tok in mask_raw.split(";"):
                    if tok.startswith("data="):
                        data_val = tok[len("data=") :]
                    elif "=" in tok:
                        k, v = tok.split("=", 1)
                        parts[k] = v
                if data_val is not None:
                    # H,W,ENC+payload
                    bits = data_val.split(",", 2)
                    mask = {
                        **parts,
                        "height": int(bits[0]) if len(bits) > 0 and bits[0].isdigit() else None,
                        "width": int(bits[1]) if len(bits) > 1 and bits[1].isdigit() else None,
                        "encoding_and_payload_prefix": (bits[2][:80] + "…")
                        if len(bits) > 2 and len(bits[2]) > 80
                        else (bits[2] if len(bits) > 2 else None),
                        "payload_chars": len(bits[2]) if len(bits) > 2 else 0,
                    }
            records.append(
                {
                    "frame": frame,
                    "object_id": oid,
                    "box": box_fields,
                    "mask": mask,
                    "raw_box": m.group(2),
                }
            )
    return records


def _save_probe(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Probe Meta SAM 3.1 Responses API shapes.")
    ap.add_argument("--image", required=True, type=Path, help="Path to a local image file")
    ap.add_argument("--prompt", required=True, help='Concept phrase, e.g. "receipt total line"')
    ap.add_argument("--out", type=Path, default=OUT, help="Where to write success JSON")
    args = ap.parse_args(argv)

    key = os.environ.get("MODEL_API_KEY")
    if not key:
        say("FAIL  MODEL_API_KEY is not set.")
        say("      export MODEL_API_KEY='your-key'")
        return 1

    image = args.image if args.image.is_absolute() else ROOT / args.image
    if not image.is_file():
        say(f"FAIL  image not found: {image}")
        return 1

    prompt = str(args.prompt).strip()
    if not prompt:
        say("FAIL  --prompt must be a non-empty concept phrase")
        return 1

    say(f"== SAM 3.1 probe  model={MODEL}  url={URL}")
    say(f"   image={image}  prompt={prompt!r}")
    say("   (API key present; never printed)\n")

    image_url = _data_url(image)
    attempts = documented_attempts(prompt, image_url)

    for i, (label, body, extra_headers) in enumerate(attempts, start=1):
        say(f"-- attempt {i}/{len(attempts)}: {label}")
        say("request body:")
        say(_redact_secrets(_printable_body(body)))
        status, reply = _post(key, body, extra_headers)
        preview = _redact_secrets(reply[:REPLY_CHARS])
        say(f"HTTP status: {status}")
        say(f"reply (first {REPLY_CHARS} chars):")
        say(preview)
        say("")

        if status != 200:
            continue

        # Success
        parsed: Any
        output_text = ""
        if body.get("stream"):
            output_text = _collect_sse_text(reply)
            try:
                # Prefer last completed response object if present in SSE
                parsed = {"stream": True, "output_text": output_text, "raw_sse_prefix": reply[:500]}
                for line in reply.splitlines():
                    if line.startswith("data: ") and '"response.completed"' in line:
                        event = json.loads(line[6:])
                        if isinstance(event.get("response"), dict):
                            parsed = event["response"]
                            if not output_text:
                                output_text = _extract_output_text(parsed)
                        break
            except Exception:
                parsed = {"stream": True, "output_text": output_text}
        else:
            try:
                parsed = json.loads(reply)
            except json.JSONDecodeError:
                parsed = {"raw": reply}
            if isinstance(parsed, dict):
                output_text = _extract_output_text(parsed) or output_text

        keys = sorted(parsed.keys()) if isinstance(parsed, dict) else []
        say(f"SUCCESS  response keys: {keys}")

        records = _parse_sam_records(output_text)
        probe = {
            "model": MODEL,
            "prompt": prompt,
            "image": str(args.image),
            "attempt": label,
            "http_status": status,
            "response_keys": keys,
            "output_text": output_text,
            "records": records,
            "masks": [r for r in records if r.get("mask")],
            "boxes": [
                {
                    "object_id": r["object_id"],
                    "frame": r["frame"],
                    "box": r.get("box"),
                }
                for r in records
            ],
            "polygons": [],  # SAM 3.1 wire format returns raster masks, not polygons
            "response": parsed if isinstance(parsed, dict) else {"value": parsed},
        }
        _save_probe(args.out, probe)
        say(f"wrote {args.out}  records={len(records)}  masks={len(probe['masks'])}")
        return 0

    say("FAIL  no attempt returned HTTP 200")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
