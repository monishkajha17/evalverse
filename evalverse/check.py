"""Live API check. Run this first:

    python -m evalverse.check

It answers four questions in about a minute:
  1. Which models does my key reach?
  2. Does a plain text call work?
  3. Does an image call with a grounding box work, and is the answer right?
  4. Does the older agent model (for the version comparison) respond?

Paste the whole output when asking for help. The key itself is never printed.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path

from . import core

ROOT = Path(__file__).resolve().parent.parent
AGENTS = ["muse-spark-1.3", "muse-spark-1.1"]


def say(msg=""):
    print(msg, flush=True)


def main(client=None):
    key = os.environ.get("MODEL_API_KEY")
    if client is None:
        if not key:
            say("FAIL  MODEL_API_KEY is not set.")
            say("      Mac/Linux:  export MODEL_API_KEY='your-key'")
            say("      Windows:    $env:MODEL_API_KEY='your-key'")
            sys.exit(1)
        from openai import OpenAI

        client = OpenAI(base_url=core.BASE_URL, api_key=key, timeout=120)
    results = {}

    # 1. models
    say("== 1. Models reachable with this key ==")
    try:
        ids = sorted(m.id for m in client.models.list().data)
        for i in ids:
            say(f"   {i}")
        results["models"] = True
        for want in AGENTS:
            say(f"   {'ok     ' if want in ids else 'MISSING'} {want}")
    except Exception as e:
        results["models"] = False
        say(f"WARN  could not list models: {type(e).__name__}: {str(e)[:200]}")
        say("      (not fatal; continuing with the calls below)")

    # 2. text call
    say("\n== 2. Text call ==")
    try:
        t = time.time()
        r = client.chat.completions.create(
            model=AGENTS[0], messages=[{"role": "user", "content": "Reply with exactly one word: ready"}]
        )
        text = (r.choices[0].message.content or "").strip()
        say(f"   reply: {text[:80]!r}   ({time.time() - t:.1f}s)")
        if getattr(r, "usage", None):
            say(f"   usage: {r.usage}")
        results["text"] = bool(text)
        if not text:
            say("WARN  empty reply. The model may have spent its output on reasoning; see the usage line.")
    except Exception as e:
        results["text"] = False
        say(f"FAIL  text call: {type(e).__name__}: {str(e)[:300]}")

    # 3. image + grounding call on a known case
    say("\n== 3. Image call with grounding box ==")
    try:
        cases = json.loads((ROOT / "data" / "cases.json").read_text())
        case = cases[0]
        png = (ROOT / case["image"]).read_bytes()
        t = time.time()
        r = client.chat.completions.create(
            model=AGENTS[0],
            messages=[{"role": "user", "content": [
                {"type": "text", "text": core.AGENT_PROMPT.format(question=case["question"])},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
            ]}],
        )
        raw = r.choices[0].message.content or ""
        say(f"   raw reply ({time.time() - t:.1f}s): {raw[:400]!r}")
        parsed = core.parse_json(raw)
        if not parsed:
            results["image"] = False
            say("FAIL  reply was not parseable JSON. Send me the raw reply above.")
        else:
            box = core.clean_box(parsed.get("box"))
            ok_ans = core.answer_correct(case, str(parsed.get("answer", "")))
            ok_box = core.evidence_ok(case["truth_box"], box)
            say(f"   expected answer: {case['answer']}   got: {parsed.get('answer')!r}   -> {'correct' if ok_ans else 'WRONG'}")
            say(f"   expected region: {case['truth_box']}   got: {box}   -> {'right place' if ok_box else 'wrong place'}")
            results["image"] = True
    except Exception as e:
        results["image"] = False
        say(f"FAIL  image call: {type(e).__name__}: {str(e)[:300]}")

    # 4. second agent version
    say("\n== 4. Second agent model ==")
    try:
        r = client.chat.completions.create(
            model=AGENTS[1], messages=[{"role": "user", "content": "Reply with exactly one word: ready"}]
        )
        text = (r.choices[0].message.content or "").strip()
        say(f"   {AGENTS[1]} reply: {text[:80]!r}")
        results["second"] = bool(text)
    except Exception as e:
        results["second"] = False
        say(f"WARN  {AGENTS[1]}: {type(e).__name__}: {str(e)[:200]}")
        say("      If this model is unavailable, tell me and we will compare against another model.")

    say("\n== Summary ==")
    for k, label in [("models", "list models"), ("text", "text call"), ("image", "image + grounding"), ("second", "second model")]:
        say(f"   {'PASS' if results.get(k) else 'FAIL'}  {label}")
    core_ok = results.get("text") and results.get("image")
    say("\nNext step: " + ("run the smoke test (step 2 in the runbook)." if core_ok else "paste this whole output to me and we will fix it."))
    return 0 if core_ok else 1


if __name__ == "__main__":
    sys.exit(main())
