"""Build data/sample_workspace/ from real results (+ optional server DB tool traces).

    python -m evalverse.make_sample_workspace
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from pathlib import Path
from typing import Any

from PIL import Image

from evalverse.events import build_events_for_trace
from evalverse.export import MAX_SIDE, JPEG_QUALITY

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DEST = ROOT / "data" / "sample_workspace"
MAX_TOTAL_BYTES = 15 * 1024 * 1024

# Keys / substrings that must not appear in the committed pack.
_FORBIDDEN_RE = re.compile(r"(evk_|token|password)", re.IGNORECASE)
_STRIP_KEY_RE = re.compile(
    r"(token|password|api[_-]?key|secret|authorization|bearer)", re.IGNORECASE
)


def _loads_results(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    meta = data.get("meta") or {}
    if meta.get("mock") is True:
        return None
    return data


def _export_jpeg(src: Path, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        longest = max(w, h)
        if longest > MAX_SIDE:
            scale = MAX_SIDE / longest
            im = im.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )
        im.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return dest.stat().st_size


def _copy_binary(src: Path, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return dest.stat().st_size


def _resolve(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else ROOT / p


def _sanitize(obj: Any) -> Any:
    """Drop secrets and any key/value containing forbidden substrings."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if _STRIP_KEY_RE.search(str(k)):
                continue
            cleaned = _sanitize(v)
            if isinstance(cleaned, str) and _FORBIDDEN_RE.search(cleaned):
                continue
            out[k] = cleaned
        return out
    if isinstance(obj, list):
        return [_sanitize(x) for x in obj]
    if isinstance(obj, str) and _FORBIDDEN_RE.search(obj):
        return "[redacted]"
    return obj


def _assert_clean(obj: Any, path: str = "$") -> None:
    text = json.dumps(obj)
    if _FORBIDDEN_RE.search(text):
        raise SystemExit(f"sanitization failed: forbidden substring remains near {path}")


def _pick_run(
    data: dict[str, Any],
    *,
    label: str,
    condition: str | None = None,
    used_cases: set[str] | None = None,
) -> tuple[dict, dict, dict] | None:
    """Return (run, trace, case) for the first matching label/condition."""
    cases = {c["id"]: c for c in (data.get("cases") or []) if c.get("id")}
    traces = {
        (t.get("agent"), t.get("case_id"), t.get("variant")): t for t in (data.get("traces") or [])
    }
    used_cases = used_cases if used_cases is not None else set()
    for r in data.get("runs") or []:
        if r.get("label") != label:
            continue
        if condition is not None and r.get("condition") != condition:
            continue
        case_id = r.get("case_id")
        if case_id in used_cases:
            continue
        key = (r.get("agent"), case_id, r.get("condition"))
        tr = traces.get(key)
        if tr is None:
            continue
        case = cases.get(case_id or "")
        if case is None:
            continue
        return r, tr, case
    return None


def _results_for(data: dict[str, Any], run: dict, tr: dict) -> list[dict]:
    out = []
    agent, case_id, variant = tr.get("agent"), tr.get("case_id"), tr.get("variant")
    for res in data.get("results") or []:
        target = res.get("target") or {}
        if (
            target.get("agent") == agent
            and target.get("case_id") == case_id
            and target.get("variant") == variant
        ):
            out.append(res)
            continue
        rid = res.get("id") or ""
        if rid.startswith(f"{tr.get('id')}|"):
            out.append(res)
    return out


def _span_out(sp: dict) -> dict:
    latency_ms = sp.get("latency_ms")
    if latency_ms is None and sp.get("latency_s") is not None:
        try:
            latency_ms = float(sp["latency_s"]) * 1000.0
        except (TypeError, ValueError):
            latency_ms = None
    attrs: dict[str, Any] = {}
    if isinstance(sp.get("attributes"), dict):
        attrs.update(sp["attributes"])
    if isinstance(sp.get("metadata"), dict):
        attrs.update(sp["metadata"])
    return {
        "id": sp.get("id"),
        "parent_ids": list(sp.get("parent_span_ids") or sp.get("parent_ids") or []),
        "type": sp.get("type") or "custom",
        "name": sp.get("name") or sp.get("id") or "span",
        "status": sp.get("status") or "completed",
        "model": sp.get("model"),
        "latency_ms": latency_ms,
        "input": sp.get("input"),
        "output": sp.get("output"),
        "attributes": attrs or None,
        "error": sp.get("error"),
    }


def _expectation(case: dict, run: dict) -> dict[str, Any]:
    exp: dict[str, Any] = {
        "case_id": case.get("id"),
        "variant": run.get("condition") or "clean",
        "answer": case.get("answer"),
        "answer_type": case.get("answer_type"),
    }
    for key in ("truth_box", "truth_span", "truth_time_ms", "keyword", "family", "question"):
        if case.get(key) is not None:
            exp[key] = case[key]
    return exp


def _copy_media_for_trace(
    tr: dict,
    case: dict,
    dest_media: Path,
    short: str,
    budget: list[int],
) -> list[dict]:
    """Copy assets; returns media descriptors with pack-relative paths."""
    items: list[dict] = []
    sources: list[tuple[Path, str, Any]] = []
    for asset in tr.get("assets") or []:
        apath = asset.get("path")
        if not apath:
            continue
        src = _resolve(apath)
        if src.is_file():
            sources.append((src, asset.get("modality") or "image", asset.get("transformation")))
    if not sources:
        for key, modality in (("image", "image"), ("audio", "audio"), ("video", "video")):
            rel = case.get(key)
            if rel:
                src = _resolve(rel)
                if src.is_file():
                    sources.append((src, modality, None))
    for i, (src, modality, transformation) in enumerate(sources):
        if budget[0] <= 0:
            break
        if modality == "image" or src.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            dest_name = f"{short}_{i}.jpg"
            dest = dest_media / dest_name
            size = _export_jpeg(src, dest)
            modality = "image"
        else:
            dest_name = f"{short}_{i}{src.suffix.lower() or ''}"
            dest = dest_media / dest_name
            size = _copy_binary(src, dest)
        budget[0] -= size
        items.append(
            {
                "path": f"media/{dest_name}",
                "modality": modality,
                "role": "input",
                "transformation": transformation,
                "bytes": size,
            }
        )
    return items


def _pack_trace(
    *,
    short: str,
    kind: str,
    data: dict,
    run: dict,
    tr: dict,
    case: dict,
    dest_media: Path,
    budget: list[int],
) -> dict[str, Any]:
    media = _copy_media_for_trace(tr, case, dest_media, short, budget)
    spans = [_span_out(sp) for sp in (tr.get("spans") or [])]
    # Keep several parents when present (already in parent_ids).
    events = tr.get("events")
    if not events:
        events = build_events_for_trace(
            case=case,
            run=run,
            spans=spans,
            media_id="$media" if media else None,
        )
    results = _results_for(data, run, tr)
    # Prefer modality-relevant completed results; keep all that have an id.
    results = [r for r in results if r.get("id")]

    output = {
        "answer": run.get("answer"),
        "box": run.get("box"),
        "evidence": run.get("evidence"),
        "label": run.get("label"),
    }
    item = {
        "sample_key": short,
        "short_name": short,
        "kind": kind,
        "session_id": f"sample:{short}",
        "name": f"{kind}|{case.get('id')}|{run.get('condition')}",
        "agent": tr.get("agent") or run.get("agent"),
        "tags": ["sample", kind],
        "input": {"question": case.get("question"), "case_id": case.get("id")},
        "output": output,
        "expectation": _expectation(case, run),
        "metadata": {
            "sample_key": short,
            "case_id": case.get("id"),
            "variant": run.get("condition") or "clean",
            "label": run.get("label"),
            "expectation": _expectation(case, run),
            "source_suite": (data.get("meta") or {}).get("suite")
            or (data.get("meta") or {}).get("modality"),
        },
        "spans": spans,
        "media": media,
        "events": events or [],
        "results": results,
    }
    return _sanitize(item)


def _db_path() -> Path | None:
    for candidate in (OUT / "evalverse.db", ROOT / "evalverse.db"):
        if candidate.is_file():
            return candidate
    return None


def _json_col(row: sqlite3.Row, key: str) -> Any:
    raw = row[key] if key in row.keys() else None
    if raw is None or raw == "":
        return None
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return raw


def _pack_tool_from_db(
    conn: sqlite3.Connection,
    *,
    short: str,
    kind: str,
    trace_id: str,
    dest_media: Path,
    budget: list[int],
) -> dict[str, Any] | None:
    t = conn.execute("SELECT * FROM traces WHERE id = ?", (trace_id,)).fetchone()
    if t is None:
        return None
    spans_rows = conn.execute(
        "SELECT * FROM spans WHERE trace_id = ? ORDER BY rowid", (trace_id,)
    ).fetchall()
    media_rows = conn.execute(
        """SELECT m.*, tm.role, tm.span_id FROM media m
           JOIN trace_media tm ON tm.media_id = m.id WHERE tm.trace_id = ?""",
        (trace_id,),
    ).fetchall()
    res_rows = conn.execute(
        "SELECT * FROM eval_results WHERE trace_id = ?", (trace_id,)
    ).fetchall()
    ev_rows = conn.execute(
        "SELECT * FROM temporal_events WHERE trace_id = ?", (trace_id,)
    ).fetchall()

    media_out: list[dict] = []
    for i, m in enumerate(media_rows):
        if budget[0] <= 0:
            break
        src = Path(m["path"])
        if not src.is_file():
            continue
        modality = m["modality"] or "image"
        if modality == "image" or src.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            dest_name = f"{short}_{i}.jpg"
            dest = dest_media / dest_name
            size = _export_jpeg(src, dest)
            modality = "image"
        else:
            dest_name = f"{short}_{i}{src.suffix.lower()}"
            dest = dest_media / dest_name
            size = _copy_binary(src, dest)
        budget[0] -= size
        media_out.append(
            {
                "path": f"media/{dest_name}",
                "modality": modality,
                "role": m["role"] or "input",
                "span_id": m["span_id"],
                "bytes": size,
            }
        )

    spans = []
    for sp in spans_rows:
        spans.append(
            {
                "id": sp["id"],
                "parent_ids": _json_col(sp, "parent_ids_json") or [],
                "type": sp["type"] or "custom",
                "name": sp["name"] or sp["id"],
                "status": sp["status"] or "completed",
                "model": sp["model"],
                "latency_ms": sp["latency_ms"],
                "input": _json_col(sp, "input_json"),
                "output": _json_col(sp, "output_json"),
                "attributes": _json_col(sp, "attributes_json"),
                "error": sp["error"],
            }
        )

    results = []
    for r in res_rows:
        results.append(
            {
                "id": r["id"],
                "evaluator_id": r["evaluator_id"],
                "evaluator_version": r["evaluator_version"],
                "dimension": r["dimension"],
                "status": r["status"] or "completed",
                "score": r["score"],
                "verdict": r["verdict"],
                "label": r["label"],
                "explanation": r["explanation"],
                "evidence": _json_col(r, "evidence_json"),
                "meta": _json_col(r, "meta_json"),
            }
        )

    events = []
    for ev in ev_rows:
        events.append(
            {
                "client_id": ev["client_id"],
                "source": ev["source"],
                "label": ev["label"],
                "speaker": ev["speaker"],
                "start_ms": ev["start_ms"],
                "end_ms": ev["end_ms"],
                "time_base": ev["time_base"] or "media",
                "confidence": ev["confidence"],
                "payload": _json_col(ev, "payload_json"),
                "media_id": "$media" if media_out else None,
                "span_id": ev["span_id"],
            }
        )

    meta = _json_col(t, "metadata_json") or {}
    expectation = meta.get("expectation") if isinstance(meta, dict) else None
    item = {
        "sample_key": short,
        "short_name": short,
        "kind": kind,
        "session_id": f"sample:{short}",
        "name": t["name"] or short,
        "agent": t["agent"] or "receipt_agent",
        "tags": ["sample", "tool_use"],
        "input": _json_col(t, "input_json"),
        "output": _json_col(t, "output_json"),
        "expectation": expectation,
        "metadata": {
            "sample_key": short,
            "expectation": expectation,
            "case_id": (expectation or {}).get("case_id") if isinstance(expectation, dict) else None,
            "variant": (expectation or {}).get("variant") if isinstance(expectation, dict) else None,
            "source": "server_db",
        },
        "spans": spans,
        "media": media_out,
        "events": events,
        "results": results,
    }
    return _sanitize(item)


def _find_tool_traces(conn: sqlite3.Connection) -> dict[str, str]:
    """Map short_name -> trace_id for correct / wrong / refrained tool-use."""
    out: dict[str, str] = {}

    row = conn.execute(
        """
        SELECT t.id FROM traces t
        JOIN eval_results er ON er.trace_id = t.id
          AND er.evaluator_id = 'tool_args_correct' AND er.label = 'correct_amount'
        WHERE EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.id AND s.type = 'tool')
        ORDER BY t.id LIMIT 1
        """
    ).fetchone()
    if row:
        out["tool_correct"] = row["id"]

    row = conn.execute(
        """
        SELECT t.id FROM traces t
        JOIN eval_results er ON er.trace_id = t.id
          AND er.evaluator_id = 'tool_args_correct' AND er.label = 'wrong_amount'
        WHERE EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.id AND s.type = 'tool')
        ORDER BY t.id LIMIT 1
        """
    ).fetchone()
    if row:
        out["tool_wrong_amount"] = row["id"]

    row = conn.execute(
        """
        SELECT t.id FROM traces t
        JOIN eval_results er ON er.trace_id = t.id
          AND er.evaluator_id = 'tool_args_correct' AND er.label = 'skipped'
        JOIN eval_results er2 ON er2.trace_id = t.id
          AND er2.evaluator_id = 'answer_correctness' AND er2.label = 'abstained'
        ORDER BY t.id LIMIT 1
        """
    ).fetchone()
    if row:
        out["tool_refrained"] = row["id"]
    return out


def build(dest: Path = DEST) -> dict[str, Any]:
    if dest.exists():
        shutil.rmtree(dest)
    media_dir = dest / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    budget = [MAX_TOTAL_BYTES]
    traces: list[dict] = []
    used_cases: set[str] = set()

    cord = _loads_results(OUT / "results_cord.json")
    if cord:
        picks = [
            ("receipt_grounded", "grounded_correct", "clean", "receipt"),
            ("receipt_wrong_place", "correct_ungrounded", "clean", "receipt"),
            ("receipt_misread", "misread", "noise", "receipt"),
            ("receipt_abstained", "abstained", "blur", "receipt"),
        ]
        for short, label, cond, kind in picks:
            hit = _pick_run(cord, label=label, condition=cond, used_cases=used_cases)
            if hit is None:
                hit = _pick_run(cord, label=label, condition=cond)
            if hit is None:
                print(f"skip {short}: no matching run")
                continue
            run, tr, case = hit
            used_cases.add(case["id"])
            traces.append(
                _pack_trace(
                    short=short,
                    kind=kind,
                    data=cord,
                    run=run,
                    tr=tr,
                    case=case,
                    dest_media=media_dir,
                    budget=budget,
                )
            )

    audio = _loads_results(OUT / "results_audio.json")
    if audio:
        for short, label, cond in (
            ("audio_grounded", "grounded_correct", "clean"),
            ("audio_misunderstood", "misunderstood", None),
        ):
            hit = _pick_run(audio, label=label, condition=cond)
            if hit is None:
                print(f"skip {short}: no matching run")
                continue
            run, tr, case = hit
            traces.append(
                _pack_trace(
                    short=short,
                    kind="audio",
                    data=audio,
                    run=run,
                    tr=tr,
                    case=case,
                    dest_media=media_dir,
                    budget=budget,
                )
            )

    video = _loads_results(OUT / "results_video.json")
    if video:
        for short, label, cond in (
            ("video_correct", "grounded_correct", "clean"),
            ("video_mistimed", "mistimed", "clean"),
        ):
            hit = _pick_run(video, label=label, condition=cond)
            if hit is None and label == "mistimed":
                hit = _pick_run(video, label=label, condition=None)
            if hit is None:
                print(f"skip {short}: no matching run")
                continue
            run, tr, case = hit
            traces.append(
                _pack_trace(
                    short=short,
                    kind="video",
                    data=video,
                    run=run,
                    tr=tr,
                    case=case,
                    dest_media=media_dir,
                    budget=budget,
                )
            )

    cross = _loads_results(OUT / "results_crossmodal.json")
    if cross and len(cross.get("cases") or []) >= 30:
        hit = _pick_run(cross, label="cross_modal_correct", condition="clean")
        if hit is None:
            hit = _pick_run(cross, label="cross_modal_correct", condition=None)
        if hit:
            run, tr, case = hit
            traces.append(
                _pack_trace(
                    short="crossmodal_pair",
                    kind="cross_modal",
                    data=cross,
                    run=run,
                    tr=tr,
                    case=case,
                    dest_media=media_dir,
                    budget=budget,
                )
            )
        else:
            print("skip crossmodal_pair: no matching run")
    else:
        n = len((cross or {}).get("cases") or [])
        print(f"skip crossmodal_pair: need >=30 cases (have {n})")

    dbp = _db_path()
    if dbp is not None:
        conn = sqlite3.connect(str(dbp))
        conn.row_factory = sqlite3.Row
        try:
            mapping = _find_tool_traces(conn)
            for short, tid in mapping.items():
                packed = _pack_tool_from_db(
                    conn,
                    short=short,
                    kind="tool_use",
                    trace_id=tid,
                    dest_media=media_dir,
                    budget=budget,
                )
                if packed:
                    traces.append(packed)
                    print(f"tool {short} <- {tid}")
                else:
                    print(f"skip {short}: export failed")
        finally:
            conn.close()
    else:
        print("skip tool-use: no server DB")

    manifest = _sanitize(
        {
            "version": 1,
            "description": "EvalVerse onboarding sample workspace",
            "traces": traces,
        }
    )
    _assert_clean(manifest)
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
    print(f"wrote {dest}  traces={len(traces)}  bytes={total}")
    if total > MAX_TOTAL_BYTES:
        raise SystemExit(f"sample workspace exceeds {MAX_TOTAL_BYTES} bytes ({total})")
    return manifest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Build data/sample_workspace from real results.")
    ap.add_argument("--dest", type=Path, default=DEST)
    args = ap.parse_args(argv)
    build(args.dest)


if __name__ == "__main__":
    main()
