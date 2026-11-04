#!/usr/bin/env python3
"""Print verified figures for README.md from out/results_*.json and out/evalverse.db.

Skip result files with meta.mock true. Tool-use numbers dedupe by
(session_prefix, receipt/case_id, condition), keeping the latest started_at.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
DB = OUT / "evalverse.db"


def _load_suites() -> dict[str, dict]:
    suites: dict[str, dict] = {}
    for path in sorted(OUT.glob("results_*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            print(f"SKIP {path.name}: not an object")
            continue
        meta = data.get("meta") or {}
        if meta.get("mock") is True:
            print(f"SKIP {path.name}: meta.mock=true")
            continue
        tag = path.stem.replace("results_", "", 1)
        suites[tag] = data
    return suites


def _file_dates(path: Path, meta: dict) -> str:
    created = meta.get("created") or "unknown"
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    return f"meta.created={created}  file_mtime_utc={mtime}"


def _qkind(case_id: str) -> str | None:
    part = (case_id or "").rsplit("_", 1)[-1]
    return part if part in {"time", "order", "third"} else None


def _pct(n: int, d: int) -> str:
    if d <= 0:
        return "n/a"
    return f"{100.0 * n / d:.1f}%"


def section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def suite_inventory(suites: dict[str, dict]) -> None:
    section("SUITE INVENTORY (non-mock results_*.json)")
    for tag, data in suites.items():
        path = OUT / f"results_{tag}.json"
        meta = data.get("meta") or {}
        print(f"\n[{tag}] {path}")
        print(f"  {_file_dates(path, meta)}")
        print(
            f"  agents={meta.get('agents')}  judge={meta.get('judge')}  "
            f"conditions={meta.get('conditions')}"
        )
        print(
            f"  n_cases={len(data.get('cases') or [])}  "
            f"n_runs={len(data.get('runs') or [])}  "
            f"n_traces={len(data.get('traces') or [])}  "
            f"n_results={len(data.get('results') or [])}  "
            f"n_judged={len(data.get('judged') or [])}"
        )


def measured_dimensions(suites: dict[str, dict]) -> None:
    section("DIMENSIONS MEASURED IN THIS RELEASE")
    dims = [
        "Perception",
        "Groundedness",
        "Temporal grounding",
        "Hallucination",
        "Completeness",
        "Reasoning",
        "Cross-modal consistency",
        "Media dependence",
        "Robustness",
        "Honesty",
        "Tool use",
        "Judge trust",
        "Failure analysis",
    ]
    counts: dict[str, dict] = {
        d: {"measured": 0, "skipped": 0, "suites": set()} for d in dims
    }
    for tag, data in suites.items():
        # From result rows
        for r in data.get("results") or []:
            dim = r.get("dimension") or ""
            if dim == "Honesty / confident errors":
                dim = "Honesty"
            if dim not in counts:
                continue
            lab = r.get("label")
            st = r.get("status")
            if st == "completed" and lab not in (None, "skipped"):
                counts[dim]["measured"] += 1
                counts[dim]["suites"].add(tag)
            elif st == "skipped" or lab == "skipped":
                counts[dim]["skipped"] += 1
        # Honesty also appears as a scored dimension in scores.rows
        scores = data.get("scores") or {}
        for row in scores.get("rows") or []:
            dims_block = row.get("dimensions") or {}
            hon = dims_block.get("Honesty") or {}
            if hon.get("status") == "available" and (hon.get("n") or 0) > 0:
                counts["Honesty"]["measured"] += int(hon.get("n") or 0)
                counts["Honesty"]["suites"].add(tag)

    if DB.exists():
        con = sqlite3.connect(DB)
        n = con.execute(
            """
            SELECT COUNT(*) FROM eval_results
            WHERE dimension = 'Tool use' AND status = 'completed'
              AND label IS NOT NULL AND label != 'skipped'
            """
        ).fetchone()[0]
        if n:
            counts["Tool use"]["measured"] += n
            counts["Tool use"]["suites"].add("evalverse.db")
        con.close()

    print(f"{'dimension':<28} {'measured':>8} {'skipped':>8}  suites")
    for d in dims:
        c = counts[d]
        suites_s = ",".join(sorted(c["suites"])) if c["suites"] else "—"
        measured = "yes" if c["measured"] else "no"
        print(
            f"{d:<28} {c['measured']:>8} {c['skipped']:>8}  "
            f"measured_in_release={measured}  sources={suites_s}"
        )


def failure_mix(suites: dict[str, dict]) -> None:
    section("FAILURE MIX — receipts under blur / noise / lowres (cord)")
    data = suites.get("cord")
    if not data:
        print("UNSUPPORTED: no cord suite")
        return
    path = OUT / "results_cord.json"
    print(f"source={path}  {_file_dates(path, data.get('meta') or {})}")
    conditions = ["blur", "noise", "lowres"]
    for agent in sorted({r["agent"] for r in data["runs"] if r.get("condition") in conditions}):
        runs = [
            r
            for r in data["runs"]
            if r["agent"] == agent and r["condition"] in conditions
        ]
        correct = sum(1 for r in runs if r.get("correct") is True)
        could = sum(1 for r in runs if r.get("label") == "abstained")
        wrong = sum(
            1 for r in runs if r.get("correct") is False and r.get("label") != "abstained"
        )
        n = len(runs)
        print(
            f"  {agent} degraded(blur+noise+lowres): n={n}  "
            f"correct={correct} ({_pct(correct, n)})  "
            f"confidently_wrong={wrong} ({_pct(wrong, n)})  "
            f"could_not_read={could} ({_pct(could, n)})"
        )
        for cond in conditions:
            rs = [r for r in data["runs"] if r["agent"] == agent and r["condition"] == cond]
            c = sum(1 for r in rs if r.get("correct") is True)
            a = sum(1 for r in rs if r.get("label") == "abstained")
            w = sum(
                1 for r in rs if r.get("correct") is False and r.get("label") != "abstained"
            )
            print(
                f"    {cond}: n={len(rs)} correct={c} confidently_wrong={w} could_not_read={a}"
            )


def audio_stage(suites: dict[str, dict]) -> None:
    section("AUDIO STAGE — phone-band (bandlimit)")
    data = suites.get("audio")
    if not data:
        print("UNSUPPORTED: no audio suite")
        return
    path = OUT / "results_audio.json"
    print(f"source={path}  {_file_dates(path, data.get('meta') or {})}")
    for agent in sorted({r["agent"] for r in data["runs"] if r.get("condition") == "bandlimit"}):
        runs = [r for r in data["runs"] if r["agent"] == agent and r["condition"] == "bandlimit"]
        print(f"  {agent}: n={len(runs)}  labels={dict(Counter(r.get('label') for r in runs))}")


def video_chance(suites: dict[str, dict]) -> None:
    section("VIDEO CHANCE — with frames (clean) vs no frames (blind_guess)")
    data = suites.get("video")
    if not data:
        print("UNSUPPORTED: no video suite")
        return
    path = OUT / "results_video.json"
    print(f"source={path}  {_file_dates(path, data.get('meta') or {})}")
    for kind in ["time", "order", "third"]:
        for cond in ["clean", "blind_guess"]:
            runs = [
                r
                for r in data["runs"]
                if _qkind(r.get("case_id", "")) == kind and r.get("condition") == cond
            ]
            if not runs:
                continue
            correct = sum(1 for r in runs if r.get("correct"))
            print(
                f"  {kind} · {cond}: correct={correct}/{len(runs)} ({_pct(correct, len(runs))})"
                + ("  chance_line=50%" if kind == "order" else "")
            )


def why_examples(suites: dict[str, dict]) -> None:
    section("WHY EXAMPLES (verified against results_cord.json)")
    data = suites.get("cord")
    if not data:
        print("UNSUPPORTED")
        return
    cases = {c["id"]: c for c in data.get("cases") or []}

    def find(label: str, condition: str | None = None, case_id: str | None = None):
        for r in data["runs"]:
            if r.get("label") != label:
                continue
            if condition and r.get("condition") != condition:
                continue
            if case_id and r.get("case_id") != case_id:
                continue
            return r
        return None

    specs = [
        ("fluent_but_wrong", "misread", "blur", "cord_total_01"),
        ("right_answer_wrong_place", "correct_ungrounded", "clean", "cord_subtotal_03"),
    ]
    for name, label, cond, cid in specs:
        r = find(label, cond, cid) or find(label, cond)
        if not r:
            print(f"  UNSUPPORTED {name}")
            continue
        exp = cases.get(r["case_id"], {}).get("answer")
        print(
            f"  {name}: agent={r['agent']} case={r['case_id']} condition={r['condition']} "
            f"expected={exp!r} answer={r.get('answer')!r} correct={r.get('correct')} "
            f"iou={r.get('iou')} evidence_ok={r.get('evidence_ok')} label={r.get('label')}"
        )


def judge_trust(suites: dict[str, dict]) -> None:
    section("JUDGE TRUST — planted with image vs image hidden (exclude agent_answer)")
    data = suites.get("wonder")
    if not data:
        print("UNSUPPORTED: no wonder suite")
        return
    path = OUT / "results_wonder.json"
    print(f"source={path}  {_file_dates(path, data.get('meta') or {})}")
    print(f"  judge_model={data.get('meta', {}).get('judge')}")
    judged = data.get("judged") or []
    print(f"  kinds={dict(Counter(j.get('kind') for j in judged))}")

    with_img = [j for j in judged if j.get("kind") in ("planted_right", "planted_wrong")]
    no_img = [
        j for j in judged if j.get("kind") in ("planted_right_noimg", "planted_wrong_noimg")
    ]
    agent_ans = [j for j in judged if j.get("kind") == "agent_answer"]
    print(f"  excluded_agent_answer_n={len(agent_ans)}")

    def report(name: str, rows: list[dict]) -> None:
        right = [j for j in rows if j.get("kind") in ("planted_right", "planted_right_noimg")]
        wrong = [j for j in rows if j.get("kind") in ("planted_wrong", "planted_wrong_noimg")]
        # false accept: accept a planted wrong; false reject: reject a planted right
        fa = sum(1 for j in wrong if j.get("judge_accepts"))
        fr = sum(1 for j in right if not j.get("judge_accepts"))
        agrees = sum(1 for j in rows if j.get("agrees") is True)
        n = len(rows)
        acc = agrees / n if n else 0.0
        print(
            f"  {name}: planted_right={len(right)} planted_wrong={len(wrong)}  "
            f"false_accepts={fa}/{len(wrong)}  false_rejects={fr}/{len(right)}  "
            f"accuracy={acc:.3f} (agrees={agrees}/{n})"
        )

    report("WITH_IMAGE", with_img)
    report("IMAGE_HIDDEN", no_img)
    print(
        "  CONTROL: image-hidden rows ask the same planted answers with the receipt "
        "removed so a chance-level score shows the judge needed the image."
    )


def _cm_verdict_bucket(r: dict) -> str:
    expected = (r.get("expected_verdict") or "").strip().lower()
    verdict = (r.get("verdict") or "").strip().lower()
    answer = (r.get("answer") or "").strip().lower()
    if verdict not in ("consistent", "inconsistent", "cannot_tell", "none", ""):
        verdict = answer
    if (
        verdict in ("cannot_tell", "none", "", "unknown")
        or answer in ("cannot_tell", "unknown", "none")
        or r.get("label") == "abstained"
        or r.get("error_type") == "abstained"
    ):
        return "declined"
    if verdict not in ("consistent", "inconsistent"):
        return "other"
    if expected not in ("consistent", "inconsistent"):
        return "other"
    if verdict == expected:
        return "correct"
    if expected == "inconsistent" and verdict == "consistent":
        return "missed_contradiction"  # said they agree when they did not
    if expected == "consistent" and verdict == "inconsistent":
        return "false_alarm"  # said they disagree when they agreed
    return "other"


def crossmodal(suites: dict[str, dict]) -> None:
    section("CROSS-MODAL — verdict-level (not stage labels)")
    data = suites.get("crossmodal")
    if not data:
        print("UNSUPPORTED")
        return
    path = OUT / "results_crossmodal.json"
    print(f"source={path}  {_file_dates(path, data.get('meta') or {})}")
    print(f"  n_cases={len(data.get('cases') or [])}")
    for cond in ["clean", "blur", "noisy_voice", "no_image"]:
        rows = [r for r in data.get("runs") or [] if r.get("condition") == cond]
        if not rows:
            continue
        c = Counter(_cm_verdict_bucket(r) for r in rows)
        print(f"  {cond}: n={len(rows)}  {dict(c)}")
    with_r = [r for r in data["runs"] if r.get("condition") != "no_image"]
    no_r = [r for r in data["runs"] if r.get("condition") == "no_image"]
    print(f"  WITH_RECEIPT: n={len(with_r)}  {dict(Counter(_cm_verdict_bucket(r) for r in with_r))}")
    print(f"  NO_RECEIPT_FORCED_GUESS: n={len(no_r)}  {dict(Counter(_cm_verdict_bucket(r) for r in no_r))}")
    print("  NOTE: cross-modal stage labels are not reported in this release")


def tool_use_from_db() -> None:
    section(
        "TOOL USE (evalverse.db) — live=safety instruction, naive=no safety; "
        "dedupe (prefix, receipt, condition)"
    )
    if not DB.exists():
        print("UNSUPPORTED: out/evalverse.db missing")
        return
    mtime = datetime.fromtimestamp(DB.stat().st_mtime, tz=timezone.utc).isoformat()
    print(f"source={DB}  file_mtime_utc={mtime}")

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT t.id AS tid, t.session_id, t.started_at, t.metadata_json, t.input_json,
               t.output_json, er.evaluator_id, er.label, er.status, er.explanation
        FROM traces t
        JOIN eval_results er ON er.trace_id = t.id
        WHERE EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.id AND s.type = 'tool')
          AND er.evaluator_id IN (
            'tool_args_correct', 'action_despite_abstention', 'answer_correctness'
          )
        """
    ).fetchall()

    by_trace: dict[str, dict] = defaultdict(dict)
    meta_by: dict[str, sqlite3.Row] = {}
    for r in rows:
        by_trace[r["tid"]][r["evaluator_id"]] = {
            "label": r["label"],
            "status": r["status"],
            "explanation": r["explanation"],
        }
        meta_by[r["tid"]] = r

    best: dict[tuple[str, str, str], dict] = {}
    for tid, evs in by_trace.items():
        r = meta_by[tid]
        meta = json.loads(r["metadata_json"] or "{}")
        inp = json.loads(r["input_json"] or "{}")
        out = json.loads(r["output_json"] or "{}")
        exp = meta.get("expectation") if isinstance(meta.get("expectation"), dict) else {}
        case = meta.get("case_id") or exp.get("case_id") or inp.get("case_id")
        cond = meta.get("variant") or exp.get("variant") or inp.get("condition")
        sess = r["session_id"] or ""
        prefix = sess.split(":", 1)[0] if ":" in sess else sess
        if prefix not in ("live", "naive") or not case or not cond:
            continue
        tac = evs.get("tool_args_correct") or {}
        ada = (evs.get("action_despite_abstention") or {}).get("label")
        ans = (evs.get("answer_correctness") or {}).get("label")
        lab = tac.get("label")
        if lab == "correct_amount":
            bucket = "correct_amount"
        elif lab == "wrong_amount":
            bucket = "wrong_amount"
        elif lab == "skipped" or tac.get("status") == "skipped":
            bucket = "declined"
        else:
            bucket = lab or "other"
        acted = bucket in ("correct_amount", "wrong_amount")
        # acted while unsure: tools fired while answer abstained, or unsafe action label
        acted_while_unsure = bool(
            acted
            and (
                ans == "abstained"
                or (ada not in (None, "safe", "skipped"))
            )
        )
        ts = r["started_at"] or ""
        key = (prefix, str(case), str(cond))
        if key not in best or ts > best[key]["ts"]:
            best[key] = {
                "ts": ts,
                "bucket": bucket,
                "acted": acted,
                "acted_while_unsure": acted_while_unsure,
                "ans": ans,
                "ada": ada,
                "answer": out.get("answer"),
                "explanation": (tac.get("explanation") or "")[:160],
                "tid": tid,
                "case": case,
                "cond": cond,
            }

    unsure_total = 0
    for prefix in ("live", "naive"):
        items = [v for k, v in best.items() if k[0] == prefix]
        n = len(items)
        acted = sum(1 for v in items if v["acted"])
        correct = sum(1 for v in items if v["bucket"] == "correct_amount")
        wrong = sum(1 for v in items if v["bucket"] == "wrong_amount")
        declined = sum(1 for v in items if v["bucket"] == "declined")
        unsure = sum(1 for v in items if v["acted_while_unsure"])
        unsure_total += unsure
        style = "safety_instruction" if prefix == "live" else "no_safety_instruction"
        print(
            f"  prefix={prefix} ({style}): n={n}  acted={acted}  "
            f"correct_amount={correct}  wrong_amount={wrong}  declined={declined}  "
            f"acted_while_unsure={unsure}"
        )
        # example wrong amount after confident misread
        ex = next(
            (
                v
                for v in items
                if v["bucket"] == "wrong_amount" and v["ans"] == "incorrect"
            ),
            None,
        )
        if ex:
            print(
                f"    example_wrong_amount_after_confident_misread: "
                f"case={ex['case']} condition={ex['cond']} answer={ex['answer']!r} "
                f"explanation={ex['explanation']!r}"
            )

    print(f"  ACTED_WHILE_UNSURE_TOTAL={unsure_total}")
    print(
        "  SURVIVES_DEDUPE_CHECK="
        + ("yes" if best else "no")
    )
    con.close()


def scores_ums(suites: dict[str, dict]) -> None:
    section("UMS / SCORES — overall rows with ci_95 and coverage (skip crossmodal in README table)")
    for tag, data in suites.items():
        scores = data.get("scores")
        if not scores:
            continue
        path = OUT / f"results_{tag}.json"
        print(f"[{tag}] {_file_dates(path, data.get('meta') or {})}  profile={scores.get('profile')}")
        for row in scores.get("rows") or []:
            if row.get("variant") != "overall":
                continue
            ci = row.get("ci_95")
            print(
                f"  agent={row.get('agent')} ums={row.get('ums')} "
                f"ci_95={ci} coverage={row.get('coverage')} gate={row.get('gate')}"
            )


def model_calls(suites: dict[str, dict]) -> None:
    section("MODEL CALLS behind non-mock result files")
    total_agent = total_judge = total_asr = 0
    for tag, data in suites.items():
        agent = sum(
            1
            for t in data.get("traces") or []
            for s in t.get("spans") or []
            if s.get("type") == "model" or s.get("name") == "model_call"
        )
        judge = len(data.get("judged") or [])
        asr = sum(
            1
            for t in data.get("traces") or []
            for s in t.get("spans") or []
            if "transcribe" in (s.get("name") or "").lower()
        )
        total_agent += agent
        total_judge += judge
        total_asr += asr
        print(f"  {tag}: agent_model_spans={agent}  judged={judge}  transcribe_spans={asr}")
    print(
        f"  TOTAL agent_model_spans={total_agent}  judged={total_judge}  "
        f"transcribe_spans={total_asr}  "
        f"sum={total_agent + total_judge + total_asr}"
    )
    print("  provider_models=muse-spark-1.1,muse-spark-1.3,muse-wonder-1.0,muse-voice-transcribe-1.0")
    print("  api_base=https://api.meta.ai/v1")


def main() -> int:
    print("EvalVerse README numbers")
    print(f"ROOT={ROOT}")
    print(f"generated_at_utc={datetime.now(tz=timezone.utc).isoformat()}")
    suites = _load_suites()
    if not suites:
        print("ERROR: no non-mock results_*.json under out/", file=sys.stderr)
        return 1
    suite_inventory(suites)
    measured_dimensions(suites)
    failure_mix(suites)
    why_examples(suites)
    judge_trust(suites)
    audio_stage(suites)
    video_chance(suites)
    crossmodal(suites)
    tool_use_from_db()
    scores_ums(suites)
    model_calls(suites)
    section("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
