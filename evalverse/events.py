"""Build temporal event payloads from audio/video traces — no model calls."""

from __future__ import annotations

from typing import Any


VALID_SOURCES = frozenset(
    {"asr", "agent_citation", "ground_truth", "evaluator", "sdk", "sampled_frame"}
)


def _ms(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _primary_media_id(media_attach: list[dict] | None, media_links: list | None = None) -> str | None:
    for m in media_attach or []:
        mid = m.get("media_id") if isinstance(m, dict) else getattr(m, "media_id", None)
        if mid:
            return mid
    for m in media_links or []:
        mid = m.get("id") if isinstance(m, dict) else getattr(m, "id", None)
        if mid:
            return mid
    return None


def build_audio_events(
    *,
    case: dict | None,
    run: dict | None,
    spans: list[dict] | None = None,
    media_id: str | None = None,
) -> list[dict[str, Any]]:
    """Ground-truth turn spans, ASR turn text, and agent citation — idempotent client ids."""
    events: list[dict[str, Any]] = []
    case = case or {}
    run = run or {}
    spans = spans or []

    for turn in case.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        idx = turn.get("index")
        start = _ms(turn.get("start_ms"))
        end = _ms(turn.get("end_ms"))
        if start is None and end is None:
            continue
        cid = f"ground_truth:turn:{idx}"
        speaker = turn.get("speaker_id") if turn.get("speaker_id") is not None else turn.get("speaker")
        if speaker is not None:
            speaker = str(speaker)
        events.append(
            {
                "client_id": cid,
                "source": "ground_truth",
                "label": str(turn.get("text") or turn.get("transcript") or f"turn {idx}"),
                "speaker": speaker,
                "start_ms": start,
                "end_ms": end,
                "time_base": "media",
                "media_id": media_id,
                "payload": {"turn": idx},
            }
        )

    asr_turns = {str(k): v for k, v in (run.get("asr_turns") or {}).items()}
    for sp in spans:
        attrs = sp.get("attributes") or {}
        if not isinstance(attrs, dict):
            continue
        turn = attrs.get("turn")
        text = attrs.get("text")
        if text is None and turn is not None:
            text = asr_turns.get(str(turn))
        start = _ms(attrs.get("start_ms"))
        end = _ms(attrs.get("end_ms"))
        # ASR span: has turn index and (text or timing from ground truth turn)
        if turn is None and text is None:
            continue
        if start is None and end is None and text is None:
            continue
        # Only treat media/transcribe spans as ASR
        name = str(sp.get("name") or "")
        if "transcribe" not in name.lower() and attrs.get("text") is None and turn is None:
            continue
        if turn is None and "transcribe" not in name.lower():
            continue
        cid = f"asr:turn:{turn if turn is not None else sp.get('id')}"
        events.append(
            {
                "client_id": cid,
                "span_id": sp.get("id"),
                "source": "asr",
                "label": str(text) if text is not None else "",
                "speaker": None,
                "start_ms": start,
                "end_ms": end,
                "time_base": "media",
                "media_id": media_id,
                "confidence": None,
                "payload": {"turn": turn, "wer": attrs.get("wer")},
            }
        )

    # Fallback ASR from run.asr_turns when spans lack attributes
    if not any(e["source"] == "asr" for e in events) and asr_turns:
        turns_by_idx = {str(t.get("index")): t for t in (case.get("turns") or []) if isinstance(t, dict)}
        for k, text in asr_turns.items():
            tmeta = turns_by_idx.get(str(k), {})
            events.append(
                {
                    "client_id": f"asr:turn:{k}",
                    "source": "asr",
                    "label": str(text),
                    "start_ms": _ms(tmeta.get("start_ms")),
                    "end_ms": _ms(tmeta.get("end_ms")),
                    "time_base": "media",
                    "media_id": media_id,
                    "payload": {"turn": int(k) if str(k).isdigit() else k},
                }
            )

    span_ms = run.get("span_ms")
    if span_ms is None:
        for sp in spans:
            if sp.get("type") == "model":
                out = sp.get("output") or {}
                if isinstance(out, dict):
                    span_ms = out.get("span_ms")
                break
    if isinstance(span_ms, (list, tuple)) and len(span_ms) == 2:
        events.append(
            {
                "client_id": "agent_citation:span",
                "source": "agent_citation",
                "label": "citation",
                "start_ms": _ms(span_ms[0]),
                "end_ms": _ms(span_ms[1]),
                "time_base": "media",
                "media_id": media_id,
                "payload": {"span_ms": list(span_ms)},
            }
        )

    return events


def build_video_events(
    *,
    case: dict | None,
    run: dict | None,
    spans: list[dict] | None = None,
    media_id: str | None = None,
) -> list[dict[str, Any]]:
    """Ground-truth case events, sampled frames, and agent citation."""
    events: list[dict[str, Any]] = []
    case = case or {}
    run = run or {}
    spans = spans or []

    for i, ev in enumerate(case.get("events") or []):
        if not isinstance(ev, dict):
            continue
        t_ms = _ms(ev.get("t_ms"))
        start = t_ms
        end = t_ms + 1500.0 if t_ms is not None else None
        if ev.get("start_ms") is not None:
            start = _ms(ev.get("start_ms"))
        if ev.get("end_ms") is not None:
            end = _ms(ev.get("end_ms"))
        cid = f"ground_truth:event:{i}:{ev.get('type') or 'ev'}"
        events.append(
            {
                "client_id": cid,
                "source": "ground_truth",
                "label": str(ev.get("text") or ev.get("type") or f"event {i}"),
                "start_ms": start,
                "end_ms": end,
                "time_base": "media",
                "media_id": media_id,
                "payload": {k: ev[k] for k in ("type", "text", "t_ms", "box", "row") if k in ev},
            }
        )

    # Also emit truth_span_ms as ground_truth if no events list
    if not (case.get("events") or []) and case.get("truth_span_ms"):
        ts = case["truth_span_ms"]
        if isinstance(ts, (list, tuple)) and len(ts) == 2:
            events.append(
                {
                    "client_id": "ground_truth:truth_span",
                    "source": "ground_truth",
                    "label": "truth_span",
                    "start_ms": _ms(ts[0]),
                    "end_ms": _ms(ts[1]),
                    "time_base": "media",
                    "media_id": media_id,
                }
            )

    for sp in spans:
        attrs = sp.get("attributes") or {}
        name = str(sp.get("name") or "")
        t_ms = attrs.get("t_ms") if isinstance(attrs, dict) else None
        if t_ms is None and not name.startswith("sample frame"):
            continue
        if t_ms is None:
            continue
        t_ms_f = _ms(t_ms)
        cid = f"sampled_frame:{int(t_ms_f) if t_ms_f is not None else sp.get('id')}"
        events.append(
            {
                "client_id": cid,
                "span_id": sp.get("id"),
                "source": "sampled_frame",
                "label": name or f"frame@{t_ms}",
                "start_ms": t_ms_f,
                "end_ms": t_ms_f,
                "time_base": "media",
                "media_id": media_id,
                "payload": {"t_ms": t_ms, "frame_index": attrs.get("frame_index") if isinstance(attrs, dict) else None},
            }
        )

    span_ms = run.get("span_ms")
    if span_ms is None:
        for sp in spans:
            if sp.get("type") == "model":
                out = sp.get("output") or {}
                if isinstance(out, dict):
                    span_ms = out.get("span_ms")
                break
    if isinstance(span_ms, (list, tuple)) and len(span_ms) == 2:
        events.append(
            {
                "client_id": "agent_citation:span",
                "source": "agent_citation",
                "label": "citation",
                "start_ms": _ms(span_ms[0]),
                "end_ms": _ms(span_ms[1]),
                "time_base": "media",
                "media_id": media_id,
                "payload": {"span_ms": list(span_ms)},
            }
        )

    return events


def build_events_for_trace(
    *,
    case: dict | None,
    run: dict | None = None,
    spans: list[dict] | None = None,
    media_id: str | None = None,
) -> list[dict[str, Any]]:
    """Dispatch to audio or video builder based on case modality / span shape."""
    case = case or {}
    spans = spans or []
    modality = case.get("modality")
    if modality == "video" or any(
        str(s.get("name") or "").startswith("sample frame") for s in spans
    ):
        return build_video_events(case=case, run=run, spans=spans, media_id=media_id)
    if (
        modality == "audio"
        or case.get("turns")
        or (run or {}).get("asr_turns") is not None
        or any("transcribe" in str(s.get("name") or "").lower() for s in spans)
    ):
        return build_audio_events(case=case, run=run, spans=spans, media_id=media_id)
    return []


def attach_events_to_traces(data: dict) -> None:
    """Attach portable `events` lists onto each trace during rescore (no media_id)."""
    cases = {c["id"]: c for c in (data.get("cases") or []) if c.get("id")}
    runs_by_key = {}
    for r in data.get("runs") or []:
        key = (r.get("agent"), r.get("case_id"), r.get("condition") or r.get("variant") or "clean")
        runs_by_key[key] = r
        # Also index without agent for looser match
        runs_by_key[(r.get("case_id"), r.get("condition") or r.get("variant") or "clean")] = r

    for tr in data.get("traces") or []:
        case = cases.get(tr.get("case_id"))
        variant = tr.get("variant") or "clean"
        run = runs_by_key.get((tr.get("agent"), tr.get("case_id"), variant))
        if run is None:
            run = runs_by_key.get((tr.get("case_id"), variant))
        # Prefer spans already on the trace payload
        raw_spans = []
        for sp in tr.get("spans") or []:
            raw_spans.append(
                {
                    "id": sp.get("id"),
                    "name": sp.get("name"),
                    "type": sp.get("type"),
                    "attributes": sp.get("attributes") or sp.get("metadata"),
                    "output": sp.get("output"),
                }
            )
        tr["events"] = build_events_for_trace(case=case, run=run, spans=raw_spans, media_id=None)
