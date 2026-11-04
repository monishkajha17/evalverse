"""OTLP/HTTP JSON trace ingest mapped onto EvalVerse traces/spans/media."""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from evalverse.server.schemas import MediaAttach, SpanIn, TraceCreate, TracePatch

_HEX = re.compile(r"^[0-9a-fA-F]+$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _attr_value(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, dict):
        # MessageToDict may emit camelCase or snake_case depending on flags.
        if "stringValue" in v or "string_value" in v:
            return v.get("stringValue", v.get("string_value"))
        if "intValue" in v or "int_value" in v:
            raw = v.get("intValue", v.get("int_value"))
            try:
                return int(raw)
            except (TypeError, ValueError):
                return raw
        if "doubleValue" in v or "double_value" in v:
            return float(v.get("doubleValue", v.get("double_value")))
        if "boolValue" in v or "bool_value" in v:
            return bool(v.get("boolValue", v.get("bool_value")))
        if "bytesValue" in v or "bytes_value" in v:
            return v.get("bytesValue", v.get("bytes_value"))
        if "arrayValue" in v or "array_value" in v:
            arr = v.get("arrayValue") or v.get("array_value") or {}
            vals = arr.get("values") or []
            return [_attr_value(x) for x in vals]
        if "kvlistValue" in v or "kvlist_value" in v:
            kv = v.get("kvlistValue") or v.get("kvlist_value") or {}
            items = kv.get("values") or []
            return {i.get("key"): _attr_value(i.get("value")) for i in items}
    return v


def attrs_to_dict(attrs: list | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for a in attrs or []:
        if not isinstance(a, dict):
            continue
        key = a.get("key")
        if key is None:
            continue
        out[str(key)] = _attr_value(a.get("value"))
    return out


def _norm_id(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        return raw.hex()
    s = str(raw).strip()
    if not s:
        return None
    # base64-encoded ids sometimes appear in JSON bridges
    if not _HEX.match(s) and len(s) % 4 == 0:
        try:
            return base64.b64decode(s).hex()
        except Exception:
            pass
    return s.lower() if _HEX.match(s) else s


def _nano_to_iso(nano: Any) -> str | None:
    if nano is None or nano == "":
        return None
    try:
        ns = int(nano)
        sec = ns / 1_000_000_000
        return datetime.fromtimestamp(sec, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _latency_ms(start: Any, end: Any) -> float | None:
    try:
        return (int(end) - int(start)) / 1_000_000.0
    except (TypeError, ValueError):
        return None


def _session_from_attrs(attrs: dict[str, Any], resource: dict[str, Any]) -> str | None:
    for src in (attrs, resource):
        for key in (
            "evalverse.session_id",
            "session.id",
            "gen_ai.conversation.id",
            "session_id",
        ):
            if src.get(key):
                return str(src[key])
    return None


def _span_type(attrs: dict[str, Any], name: str) -> str:
    op = str(attrs.get("gen_ai.operation.name") or attrs.get("gen_ai.operation.type") or "").lower()
    if op in ("chat", "completion", "generate", "generate_content", "response"):
        return "model"
    if op in ("execute_tool", "tool", "tool_call"):
        return "tool"
    if attrs.get("gen_ai.tool.name") or attrs.get("tool.name"):
        return "tool"
    if attrs.get("gen_ai.request.model") or attrs.get("gen_ai.response.model"):
        return "model"
    lower = (name or "").lower()
    if "tool" in lower:
        return "tool"
    if "chat" in lower or "completion" in lower or "model" in lower:
        return "model"
    return "custom"


def _model_from_attrs(attrs: dict[str, Any]) -> str | None:
    return (
        attrs.get("gen_ai.response.model")
        or attrs.get("gen_ai.request.model")
        or attrs.get("gen_ai.system")
        or None
    )


def _as_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, dict):
        v = _attr_value(v)
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _usage_from_attrs(attrs: dict[str, Any]) -> dict[str, Any] | None:
    tin = attrs.get("gen_ai.usage.input_tokens")
    if tin is None:
        tin = attrs.get("gen_ai.usage.prompt_tokens")
    tout = attrs.get("gen_ai.usage.output_tokens")
    if tout is None:
        tout = attrs.get("gen_ai.usage.completion_tokens")
    tin_i, tout_i = _as_int(tin), _as_int(tout)
    if tin_i is None and tout_i is None:
        return None
    usage: dict[str, Any] = {}
    if tin_i is not None:
        usage["input_tokens"] = tin_i
    if tout_i is not None:
        usage["output_tokens"] = tout_i
    return usage


def _messages_from_attrs_or_events(attrs: dict[str, Any], events: list) -> tuple[Any, Any]:
    inp = attrs.get("gen_ai.prompt") or attrs.get("gen_ai.input.messages") or attrs.get("input.value")
    out = (
        attrs.get("gen_ai.completion")
        or attrs.get("gen_ai.output.messages")
        or attrs.get("output.value")
    )
    for ev in events or []:
        if not isinstance(ev, dict):
            continue
        name = str(ev.get("name") or "")
        ea = attrs_to_dict(ev.get("attributes"))
        if name in ("gen_ai.content.prompt", "gen_ai.prompt") and inp is None:
            inp = ea.get("gen_ai.prompt") or ea.get("content") or ea
        if name in ("gen_ai.content.completion", "gen_ai.completion") and out is None:
            out = ea.get("gen_ai.completion") or ea.get("content") or ea
    return inp, out


def _tool_io(attrs: dict[str, Any]) -> tuple[Any, Any]:
    name = attrs.get("gen_ai.tool.name") or attrs.get("tool.name")
    arguments = (
        attrs.get("gen_ai.tool.call.arguments")
        or attrs.get("gen_ai.tool.arguments")
        or attrs.get("tool.arguments")
    )
    result = (
        attrs.get("gen_ai.tool.call.result")
        or attrs.get("gen_ai.tool.result")
        or attrs.get("tool.result")
    )
    inp = {"name": name, "arguments": arguments} if (name or arguments is not None) else None
    out = {"result": result} if result is not None else None
    return inp, out


def _iter_content_blocks(obj: Any) -> list[dict]:
    blocks: list[dict] = []
    if obj is None:
        return blocks
    if isinstance(obj, str):
        try:
            obj = json.loads(obj)
        except json.JSONDecodeError:
            return blocks
    if isinstance(obj, dict):
        if obj.get("type") in ("image_url", "input_audio", "image", "audio"):
            blocks.append(obj)
        for v in obj.values():
            blocks.extend(_iter_content_blocks(v))
    elif isinstance(obj, list):
        for v in obj:
            blocks.extend(_iter_content_blocks(v))
    return blocks


def _decode_data_url(url: str) -> tuple[bytes, str] | None:
    if not url.startswith("data:") or "," not in url:
        return None
    header, b64 = url.split(",", 1)
    mime = "application/octet-stream"
    if ";" in header:
        mime = header[5:].split(";", 1)[0] or mime
    elif header.startswith("data:") and len(header) > 5:
        mime = header[5:] or mime
    try:
        return base64.b64decode(b64), mime
    except Exception:
        return None


def extract_media_candidates(inp: Any, out: Any) -> list[dict[str, Any]]:
    """Return media descriptors: {kind: data|url, bytes?, mime?, url?, modality}."""
    found: list[dict[str, Any]] = []
    for block in _iter_content_blocks(inp) + _iter_content_blocks(out):
        btype = block.get("type")
        if btype in ("image_url", "image"):
            url = block.get("url")
            if isinstance(block.get("image_url"), dict):
                url = block["image_url"].get("url") or url
            if isinstance(url, str) and url.startswith("data:"):
                decoded = _decode_data_url(url)
                if decoded:
                    data, mime = decoded
                    found.append({"kind": "data", "bytes": data, "mime": mime, "modality": "image"})
            elif isinstance(url, str) and url.startswith(("http://", "https://")):
                found.append({"kind": "url", "url": url, "modality": "image"})
        elif btype == "input_audio":
            data = block.get("data")
            fmt = block.get("format") or "wav"
            if isinstance(data, str):
                try:
                    raw = base64.b64decode(data)
                    found.append(
                        {
                            "kind": "data",
                            "bytes": raw,
                            "mime": f"audio/{fmt}",
                            "modality": "audio",
                        }
                    )
                except Exception:
                    pass
            url = block.get("url")
            if isinstance(url, str) and url.startswith(("http://", "https://")):
                found.append({"kind": "url", "url": url, "modality": "audio"})
    return found


def _get(d: dict, *keys: str, default=None):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def map_otlp_span(raw: dict, resource_attrs: dict[str, Any]) -> dict[str, Any]:
    """Map one OTLP span JSON object to an intermediate EvalVerse span dict."""
    attrs = attrs_to_dict(raw.get("attributes"))
    events = raw.get("events") or []
    links = raw.get("links") or []
    span_id = _norm_id(_get(raw, "spanId", "span_id"))
    parent = _norm_id(_get(raw, "parentSpanId", "parent_span_id"))
    parents: list[str] = []
    if parent:
        parents.append(parent)
    for link in links:
        if not isinstance(link, dict):
            continue
        lid = _norm_id(_get(link, "spanId", "span_id"))
        if lid and lid not in parents:
            parents.append(lid)

    stype = _span_type(attrs, raw.get("name") or "")
    model = _model_from_attrs(attrs)
    usage = _usage_from_attrs(attrs)
    inp, out = _messages_from_attrs_or_events(attrs, events)
    if stype == "tool":
        tin, tout = _tool_io(attrs)
        inp = tin if tin is not None else inp
        out = tout if tout is not None else out

    status_obj = raw.get("status") if isinstance(raw.get("status"), dict) else {}
    status_code = status_obj.get("code")
    # OTLP: UNSET=0, OK=1, ERROR=2 (or string names)
    status = "completed"
    if status_code in (2, "STATUS_CODE_ERROR", "ERROR", "error"):
        status = "failed"

    start_ns = _get(raw, "startTimeUnixNano", "start_time_unix_nano")
    end_ns = _get(raw, "endTimeUnixNano", "end_time_unix_nano")
    started = _nano_to_iso(start_ns)
    ended = _nano_to_iso(end_ns)
    latency = _latency_ms(start_ns, end_ns)

    return {
        "id": span_id,
        "trace_id": _norm_id(_get(raw, "traceId", "trace_id")),
        "parent_ids": parents,
        "type": stype,
        "name": raw.get("name") or span_id,
        "status": status,
        "model": str(model) if model else None,
        "started_at": started,
        "ended_at": ended,
        "latency_ms": latency,
        "usage": usage,
        "input": inp,
        "output": out,
        "attributes": attrs,
        "error": status_obj.get("message"),
        "session_id": _session_from_attrs(attrs, resource_attrs),
        "media_candidates": extract_media_candidates(inp, out),
        "resource": resource_attrs,
    }


def flatten_resource_spans(payload: dict) -> list[dict[str, Any]]:
    """Return mapped spans from an OTLP ExportTraceServiceRequest JSON body."""
    mapped: list[dict[str, Any]] = []
    for rs in payload.get("resourceSpans") or payload.get("resource_spans") or []:
        resource_attrs = attrs_to_dict((rs.get("resource") or {}).get("attributes"))
        for ss in (
            rs.get("scopeSpans")
            or rs.get("scope_spans")
            or rs.get("instrumentationLibrarySpans")
            or []
        ):
            for sp in ss.get("spans") or []:
                mapped.append(map_otlp_span(sp, resource_attrs))
    return mapped


def group_by_trace(mapped: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for sp in mapped:
        tid = sp.get("trace_id")
        if not tid:
            continue
        groups.setdefault(tid, []).append(sp)
    return groups


def ingest_otlp_json(service, project: str, payload: dict) -> dict[str, Any]:
    """Persist OTLP spans into the store. Idempotent per (traceId, spanId)."""
    mapped = flatten_resource_spans(payload)
    groups = group_by_trace(mapped)
    for tid, spans in groups.items():
        session = None
        agent = None
        for sp in spans:
            session = session or sp.get("session_id")
            if sp.get("model"):
                agent = agent or sp["model"]
        # Register media first
        media_attach: list[MediaAttach] = []
        external_refs: list[dict] = []
        for sp in spans:
            for cand in sp.get("media_candidates") or []:
                if cand.get("kind") == "data" and cand.get("bytes"):
                    m = service.register_media_bytes(
                        project,
                        cand["bytes"],
                        modality=cand.get("modality") or "image",
                        mime=cand.get("mime"),
                        filename="otlp.bin",
                    )
                    media_attach.append(MediaAttach(media_id=m.id, role="input", span_id=sp.get("id")))
                elif cand.get("kind") == "url":
                    external_refs.append(
                        {"url": cand["url"], "modality": cand.get("modality"), "span_id": sp.get("id")}
                    )

        existing = service.db.fetchone(
            "SELECT id FROM traces WHERE id = ? AND project = ?", (tid, project)
        )
        span_ins = [
            SpanIn(
                id=sp["id"],
                parent_ids=sp.get("parent_ids") or [],
                type=sp.get("type") or "custom",
                name=sp.get("name") or sp["id"],
                status=sp.get("status") or "completed",
                model=sp.get("model"),
                started_at=sp.get("started_at"),
                ended_at=sp.get("ended_at"),
                latency_ms=sp.get("latency_ms"),
                usage=sp.get("usage"),
                input=sp.get("input"),
                output=sp.get("output"),
                attributes={
                    **(sp.get("attributes") or {}),
                    **({"external_media": external_refs} if external_refs else {}),
                },
                error=sp.get("error"),
            )
            for sp in spans
            if sp.get("id")
        ]

        if existing is None:
            # Keep parents present in this batch; drop only unknown ids (partial/out-of-order OTLP).
            known = {s.id for s in span_ins if s.id}
            for s in span_ins:
                s.parent_ids = [p for p in (s.parent_ids or []) if p in known]
            service.create_trace(
                project,
                TraceCreate(
                    id=tid,
                    session_id=session,
                    name=f"otlp:{tid[:12]}",
                    agent=str(agent) if agent else None,
                    status="completed",
                    source="otlp",
                    metadata={"otlp": True, "external_media": external_refs},
                    tags=["otlp"],
                    spans=span_ins,
                    media=media_attach,
                    started_at=min((s.started_at for s in span_ins if s.started_at), default=_now()),
                    ended_at=max((s.ended_at for s in span_ins if s.ended_at), default=None),
                ),
            )
        else:
            # Idempotent span upsert
            if session or agent:
                service.patch_trace(
                    project,
                    tid,
                    TracePatch(
                        session_id=session,
                        agent=str(agent) if agent else None,
                        media=media_attach or None,
                    ),
                )
            if span_ins:
                # Keep only parents that exist in DB or batch
                existing_spans = {
                    r["id"]
                    for r in service.db.fetchall("SELECT id FROM spans WHERE trace_id=?", (tid,))
                }
                known = existing_spans | {s.id for s in span_ins}
                for s in span_ins:
                    s.parent_ids = [p for p in (s.parent_ids or []) if p in known]
                service.add_spans(project, tid, span_ins)

    return {"partialSuccess": {}}
