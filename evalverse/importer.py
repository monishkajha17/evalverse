"""Import existing EvalVerse results JSON into the platform store.

    python -m evalverse.importer --tag cord
    python -m evalverse.importer              # loads out/results.json
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def _api_url() -> str:
    return os.environ.get("EVALVERSE_API_URL", "http://127.0.0.1:8000").rstrip("/")


def _api_key() -> str:
    return os.environ.get("EVALVERSE_API_KEY", "dev")


def _headers(project: str = "default") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_api_key()}",
        "X-Project": project,
    }


def results_path_for_tag(tag: str | None) -> Path:
    if not tag:
        return OUT / "results.json"
    return OUT / f"results_{tag}.json"


def _resolve(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else ROOT / p


def _modality_for(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    if mime and mime.startswith("audio/"):
        return "audio"
    if mime and mime.startswith("video/"):
        return "video"
    return "image"


def upload_media(
    client: httpx.Client,
    path: Path,
    *,
    modality: str | None = None,
    parent_id: str | None = None,
    transformation: Any = None,
    preferred_id: str | None = None,
) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    data = path.read_bytes()
    form: dict[str, str] = {"modality": modality or _modality_for(path)}
    if parent_id:
        form["parent_id"] = parent_id
    if transformation is not None:
        form["transformation"] = (
            transformation if isinstance(transformation, str) else json.dumps(transformation)
        )
    files = {"file": (path.name, data)}
    r = client.post("/api/v1/media", headers=_headers(), files=files, data=form)
    if r.status_code >= 400:
        print(f"  media upload failed {path}: {r.status_code} {r.text[:200]}", file=sys.stderr)
        return None
    body = r.json()
    # preferred_id is informational; server content-addresses by sha256.
    _ = preferred_id
    return body


def import_results(
    path: Path,
    *,
    tag: str,
    api_url: str | None = None,
    project: str = "default",
    client: httpx.Client | None = None,
) -> dict[str, int]:
    raw = json.loads(path.read_text())
    traces = raw.get("traces") or []
    results = raw.get("results") or []
    cases = {c["id"]: c for c in (raw.get("cases") or []) if c.get("id")}

    owns = client is None
    if client is None:
        client = httpx.Client(base_url=api_url or _api_url(), timeout=60.0)

    stats = {
        "traces": 0,
        "traces_skipped": 0,
        "media": 0,
        "results": 0,
        "results_skipped": 0,
    }
    run_id = f"import:{tag}"
    media_cache: dict[str, str] = {}  # source path -> media_id

    try:
        # Pre-register case images under data/.
        for case in cases.values():
            for key in ("image", "audio"):
                rel = case.get(key)
                if not rel or rel in media_cache:
                    continue
                src = _resolve(rel)
                uploaded = upload_media(client, src, modality="audio" if key == "audio" else "image")
                if uploaded:
                    media_cache[rel] = uploaded["id"]
                    if uploaded.get("created", True):
                        stats["media"] += 1

        trace_ids: list[str] = []
        for tr in traces:
            tid = tr.get("id")
            if not tid:
                continue
            # Idempotent: GET first.
            existing = client.get(f"/api/v1/traces/{tid}", headers=_headers(project))
            if existing.status_code == 200:
                stats["traces_skipped"] += 1
                trace_ids.append(tid)
            else:
                case_id = tr.get("case_id") or "unknown"
                session_id = f"{tag}:{case_id}"
                asset_id_map: dict[str, str] = {}

                media_attach: list[dict[str, Any]] = []
                for asset in tr.get("assets") or []:
                    apath = asset.get("path")
                    if not apath:
                        continue
                    if apath not in media_cache:
                        uploaded = upload_media(
                            client,
                            _resolve(apath),
                            modality=asset.get("modality") or _modality_for(Path(apath)),
                            transformation=asset.get("transformation"),
                            preferred_id=asset.get("id"),
                        )
                        if uploaded:
                            media_cache[apath] = uploaded["id"]
                            if uploaded.get("created", True):
                                stats["media"] += 1
                    mid = media_cache.get(apath)
                    if mid:
                        if asset.get("id"):
                            asset_id_map[asset["id"]] = mid
                        media_attach.append({"media_id": mid, "role": "input"})

                spans_payload = []
                for sp in tr.get("spans") or []:
                    latency_ms = None
                    if sp.get("latency_ms") is not None:
                        latency_ms = float(sp["latency_ms"])
                    elif sp.get("latency_s") is not None:
                        latency_ms = float(sp["latency_s"]) * 1000.0
                    usage = sp.get("usage")
                    if isinstance(usage, str):
                        usage = None
                    attrs = dict(sp.get("metadata") or {})
                    if sp.get("result_ids"):
                        attrs["result_ids"] = sp["result_ids"]
                    # Remap asset_id in metadata to platform media id when known.
                    if "asset_id" in attrs and attrs["asset_id"] in asset_id_map:
                        attrs["media_id"] = asset_id_map[attrs["asset_id"]]
                    spans_payload.append(
                        {
                            "id": sp.get("id"),
                            "parent_ids": list(sp.get("parent_span_ids") or sp.get("parent_ids") or []),
                            "type": sp.get("type") or "custom",
                            "name": sp.get("name") or sp.get("id") or "span",
                            "status": sp.get("status") or "completed",
                            "model": sp.get("model"),
                            "latency_ms": latency_ms,
                            "usage": usage if isinstance(usage, dict) else None,
                            "input": sp.get("input"),
                            "output": sp.get("output"),
                            "attributes": attrs or None,
                            "error": sp.get("error"),
                        }
                    )

                payload = {
                    "id": tid,
                    "session_id": session_id,
                    "name": f"{tr.get('agent')}|{case_id}|{tr.get('variant')}",
                    "agent": tr.get("agent"),
                    "status": "completed",
                    "input": {
                        "case_id": case_id,
                        "variant": tr.get("variant"),
                        "variant_transform": tr.get("variant_transform"),
                    },
                    "metadata": {
                        "case_id": case_id,
                        "variant": tr.get("variant"),
                        "variant_transform": tr.get("variant_transform"),
                        "import_tag": tag,
                    },
                    "tags": [tag, str(tr.get("variant") or "")],
                    "source": "import",
                    "spans": spans_payload,
                    "media": media_attach,
                }
                r = client.post("/api/v1/traces", headers=_headers(project), json=payload)
                if r.status_code >= 400:
                    print(f"  trace {tid} failed: {r.status_code} {r.text[:300]}", file=sys.stderr)
                else:
                    stats["traces"] += 1
                    trace_ids.append(tid)

        # Attach evaluator results once per result id (idempotent).
        known = set(trace_ids)
        for res in results:
            if not res.get("id"):
                continue
            target = res.get("target") or {}
            expected_id = (
                f"{target.get('agent')}|{target.get('case_id')}|{target.get('variant')}"
            )
            rid = res["id"]
            bind_tid: str | None = None
            if expected_id in known:
                bind_tid = expected_id
            else:
                # Prefer an exact prefix match from the result id, else first matching trace.
                for tid in known:
                    if rid.startswith(tid + "|"):
                        bind_tid = tid
                        break
                if bind_tid is None and target.get("variant") == "all":
                    prefix = f"{target.get('agent')}|{target.get('case_id')}|"
                    for tid in known:
                        if tid.startswith(prefix):
                            bind_tid = tid
                            break
            if bind_tid is None:
                continue
            body = {
                "id": rid,
                "run_id": run_id,
                "trace_id": bind_tid,
                "evaluator_id": res.get("evaluator_id"),
                "evaluator_version": res.get("evaluator_version"),
                "dimension": res.get("dimension"),
                "status": res.get("status"),
                "score": res.get("score"),
                "verdict": res.get("verdict"),
                "label": res.get("label"),
                "explanation": res.get("explanation"),
                "evidence": res.get("evidence"),
                "meta": res.get("execution_metadata") or res.get("meta"),
            }
            rr = client.post("/api/v1/eval_results", headers=_headers(project), json=body)
            if rr.status_code == 200:
                data = rr.json()
                if data.get("created"):
                    stats["results"] += 1
                else:
                    stats["results_skipped"] += 1
            elif rr.status_code != 404:
                print(
                    f"  result {body['id']} failed: {rr.status_code} {rr.text[:200]}",
                    file=sys.stderr,
                )
    finally:
        if owns:
            client.close()

    return stats


def import_results_local(
    path: Path,
    *,
    tag: str,
    service: Any,
    project: str = "default",
) -> dict[str, int]:
    """Import using an in-process Service (used by tests)."""
    from evalverse.server.schemas import MediaAttach, SpanIn, TraceCreate

    raw = json.loads(path.read_text())
    traces = raw.get("traces") or []
    results = raw.get("results") or []
    cases = {c["id"]: c for c in (raw.get("cases") or []) if c.get("id")}
    stats = {"traces": 0, "traces_skipped": 0, "media": 0, "results": 0, "results_skipped": 0}
    run_id = f"import:{tag}"
    media_cache: dict[str, str] = {}

    for case in cases.values():
        for key in ("image", "audio"):
            rel = case.get(key)
            if not rel or rel in media_cache:
                continue
            src = _resolve(rel)
            if not src.is_file():
                continue
            m = service.register_media_bytes(
                project,
                src.read_bytes(),
                modality="audio" if key == "audio" else "image",
                filename=src.name,
            )
            media_cache[rel] = m.id
            if m.created:
                stats["media"] += 1

    known: list[str] = []
    for tr in traces:
        tid = tr.get("id")
        if not tid:
            continue
        try:
            service.get_trace(project, tid)
            stats["traces_skipped"] += 1
            known.append(tid)
            existed = True
        except Exception:
            existed = False

        if not existed:
            case_id = tr.get("case_id") or "unknown"
            session_id = f"{tag}:{case_id}"
            media_attach: list[MediaAttach] = []
            for asset in tr.get("assets") or []:
                apath = asset.get("path")
                if not apath:
                    continue
                if apath not in media_cache:
                    src = _resolve(apath)
                    if src.is_file():
                        m = service.register_media_bytes(
                            project,
                            src.read_bytes(),
                            modality=asset.get("modality") or _modality_for(src),
                            filename=src.name,
                            transformation=asset.get("transformation"),
                            media_id=asset.get("id"),
                        )
                        media_cache[apath] = m.id
                        if m.created:
                            stats["media"] += 1
                mid = media_cache.get(apath)
                if mid:
                    media_attach.append(MediaAttach(media_id=mid, role="input"))

            spans = []
            for sp in tr.get("spans") or []:
                latency_ms = None
                if sp.get("latency_ms") is not None:
                    latency_ms = float(sp["latency_ms"])
                elif sp.get("latency_s") is not None:
                    latency_ms = float(sp["latency_s"]) * 1000.0
                usage = sp.get("usage")
                if isinstance(usage, str):
                    usage = None
                spans.append(
                    SpanIn(
                        id=sp.get("id"),
                        parent_ids=list(sp.get("parent_span_ids") or sp.get("parent_ids") or []),
                        type=sp.get("type") or "custom",
                        name=sp.get("name") or sp.get("id") or "span",
                        status=sp.get("status") or "completed",
                        model=sp.get("model"),
                        latency_ms=latency_ms,
                        usage=usage if isinstance(usage, dict) else None,
                        input=sp.get("input"),
                        output=sp.get("output"),
                        attributes=sp.get("metadata"),
                        error=sp.get("error"),
                    )
                )

            service.create_trace(
                project,
                TraceCreate(
                    id=tid,
                    session_id=session_id,
                    name=f"{tr.get('agent')}|{case_id}|{tr.get('variant')}",
                    agent=tr.get("agent"),
                    status="completed",
                    input={
                        "case_id": case_id,
                        "variant": tr.get("variant"),
                        "variant_transform": tr.get("variant_transform"),
                    },
                    metadata={
                        "case_id": case_id,
                        "variant": tr.get("variant"),
                        "import_tag": tag,
                    },
                    tags=[tag],
                    source="import",
                    spans=spans,
                    media=media_attach,
                ),
            )
            stats["traces"] += 1
            known.append(tid)

    known_set = set(known)
    for res in results:
        if not res.get("id"):
            continue
        target = res.get("target") or {}
        expected_id = f"{target.get('agent')}|{target.get('case_id')}|{target.get('variant')}"
        rid = res["id"]
        bind_tid: str | None = None
        if expected_id in known_set:
            bind_tid = expected_id
        else:
            for tid in known_set:
                if rid.startswith(tid + "|"):
                    bind_tid = tid
                    break
            if bind_tid is None and target.get("variant") == "all":
                prefix = f"{target.get('agent')}|{target.get('case_id')}|"
                for tid in known_set:
                    if tid.startswith(prefix):
                        bind_tid = tid
                        break
        if bind_tid is None:
            continue
        before = service.db.fetchone("SELECT id FROM eval_results WHERE id = ?", (rid,))
        service.upsert_eval_result(
            project=project,
            run_id=run_id,
            result_id=rid,
            trace_id=bind_tid,
            evaluator_id=res.get("evaluator_id"),
            evaluator_version=res.get("evaluator_version"),
            dimension=res.get("dimension"),
            status=res.get("status"),
            score=res.get("score"),
            verdict=res.get("verdict"),
            label=res.get("label"),
            explanation=res.get("explanation"),
            evidence=res.get("evidence"),
            meta=res.get("execution_metadata") or res.get("meta"),
        )
        after = service.db.fetchone("SELECT id FROM eval_results WHERE id = ?", (rid,))
        if before is None and after is not None:
            stats["results"] += 1
        else:
            stats["results_skipped"] += 1

    return stats


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Import EvalVerse results into the platform store.")
    ap.add_argument("--tag", default=None, help="suite tag (loads out/results_<tag>.json)")
    ap.add_argument("--project", default="default")
    ap.add_argument("--api-url", default=None)
    ap.add_argument("--file", default=None, help="explicit results JSON path")
    args = ap.parse_args(argv)

    tag = args.tag or "default"
    path = Path(args.file) if args.file else results_path_for_tag(args.tag)
    if not path.is_file():
        raise SystemExit(f"results file not found: {path}")

    print(f"importing {path}  tag={tag}")
    stats = import_results(path, tag=tag, api_url=args.api_url, project=args.project)
    print(
        f"done  traces={stats['traces']} (skipped {stats['traces_skipped']})  "
        f"media={stats['media']}  results={stats['results']} (skipped {stats['results_skipped']})"
    )


if __name__ == "__main__":
    main()
