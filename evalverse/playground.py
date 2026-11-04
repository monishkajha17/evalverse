"""CLI for the Try-it playground.

    python -m evalverse.playground --image path --question "..."
    python -m evalverse.playground --audio path.wav --question "..."
    python -m evalverse.playground --video path.mp4 --question "..."
    python -m evalverse.playground --image a.jpg --audio b.wav --mode cross_check
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parent.parent


def _api_url() -> str:
    return os.environ.get("EVALVERSE_API_URL", "http://127.0.0.1:8000").rstrip("/")


def _api_key() -> str:
    return os.environ.get("EVALVERSE_API_KEY", "dev")


def _project() -> str:
    return os.environ.get("EVALVERSE_PROJECT", "default")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="EvalVerse Try-it playground CLI")
    ap.add_argument("--image", action="append", default=[], help="image path (repeatable)")
    ap.add_argument("--audio", action="append", default=[], help="audio path (repeatable)")
    ap.add_argument("--video", action="append", default=[], help="video path (repeatable)")
    ap.add_argument("--question", default=None, help="question text (required for --mode answer)")
    ap.add_argument("--text", default=None, help="claim text for --mode cross_check (image+text)")
    ap.add_argument("--mode", default="answer", choices=("answer", "cross_check"))
    ap.add_argument("--agent-model", default="muse-spark-1.3")
    ap.add_argument("--judge-model", default="muse-wonder-1.0")
    ap.add_argument("--evaluator", action="append", default=[], dest="evaluators")
    ap.add_argument("--condition", action="append", default=[], dest="conditions")
    ap.add_argument("--mock", action="store_true", help="use mock provider (needs EVALVERSE_ALLOW_MOCK)")
    ap.add_argument("--timeout", type=float, default=60.0, help="poll timeout seconds")
    ap.add_argument("--api-url", default=None)
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--project", default=None)
    args = ap.parse_args(argv)

    if args.mode == "answer" and not (args.question or "").strip():
        print("--question is required for --mode answer", file=sys.stderr)
        return 2

    paths: list[Path] = []
    for p in args.image + args.audio + args.video:
        path = Path(p)
        if not path.is_file():
            print(f"file not found: {path}", file=sys.stderr)
            return 2
        paths.append(path)
    if not paths:
        print("provide at least one --image / --audio / --video", file=sys.stderr)
        return 2
    if args.mode == "cross_check":
        if not args.image and not args.video:
            print("cross_check needs --image or --video", file=sys.stderr)
            return 2
        if not args.audio and not (args.text or "").strip():
            print("cross_check needs --audio or --text", file=sys.stderr)
            return 2

    headers = {
        "Authorization": f"Bearer {args.api_key or _api_key()}",
        "X-Project": args.project or _project(),
    }
    default_evals = (
        ["cross_modal_judge"] if args.mode == "cross_check" else ["claim_grounding"]
    )
    multipart: list[tuple[str, Any]] = [
        ("question", (None, args.question or "")),
        ("agent_model", (None, args.agent_model)),
        ("judge_model", (None, args.judge_model)),
        ("mock", (None, "true" if args.mock else "false")),
        ("mode", (None, args.mode)),
    ]
    if args.text:
        multipart.append(("text", (None, args.text)))
    for eid in args.evaluators or default_evals:
        multipart.append(("evaluator_ids", (None, eid)))
    for c in args.conditions:
        multipart.append(("conditions", (None, c)))
    for path in paths:
        multipart.append(("files", (path.name, path.read_bytes())))

    url = (args.api_url or _api_url()) + "/api/v1/playground/runs"
    with httpx.Client(timeout=120.0) as client:
        r = client.post(url, headers=headers, files=multipart)
        if r.status_code >= 400:
            print(r.text, file=sys.stderr)
            return 1
        body = r.json()
        run_id = body.get("run_id")
        status_url = body.get("status_url") or f"/api/v1/playground/runs/{run_id}"
        print(f"run_id={run_id} status={body.get('status')} mode={args.mode}")

        deadline = time.time() + float(args.timeout)
        detail = None
        while time.time() < deadline:
            gr = client.get((args.api_url or _api_url()) + status_url, headers=headers)
            if gr.status_code >= 400:
                print(gr.text, file=sys.stderr)
                return 1
            detail = gr.json()
            st = detail.get("status")
            if st in ("completed", "failed"):
                break
            time.sleep(0.4)

        if not detail:
            print("no response", file=sys.stderr)
            return 1
        if detail.get("status") != "completed":
            print(json.dumps(detail, indent=2, default=str))
            return 1

        tids = detail.get("trace_ids") or []
        print(f"trace_id: {tids[0] if tids else None}")
        if args.mode == "cross_check":
            cmj = next(
                (x for x in (detail.get("results") or []) if x.get("evaluator_id") == "cross_modal_judge"),
                None,
            )
            print("cross_modal_judge:")
            if not cmj:
                print("null")
                return 1
            em = cmj.get("execution_metadata") or cmj.get("meta") or {}
            print(f"  label={cmj.get('label')} score={cmj.get('score')}")
            for c in em.get("claims") or []:
                print(
                    f"  - [{c.get('verdict') or c.get('status')}] {c.get('claim')}"
                    + (f"  ({c.get('explanation')})" if c.get("explanation") else "")
                )
            return 0

        print(f"answer: {detail.get('answer')}")
        cg = next(
            (x for x in (detail.get("results") or []) if x.get("evaluator_id") == "claim_grounding"),
            None,
        )
        print("claim_grounding:")
        print(json.dumps(cg, indent=2, default=str) if cg else "null")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
