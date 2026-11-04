#!/usr/bin/env python3
"""Verified figures for README.md from non-mock out/results_*.json and out/evalverse.db."""

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

LABELS = [
    "grounded_correct",
    "correct_ungrounded",
    "misread",
    "mislocated",
    "misunderstood",
    "heard_wrong",
    "mistimed",
    "abstained",
    "invalid_output",
]


def _load_suites() -> dict[str, dict]:
    suites: dict[str, dict] = {}
    for path in sorted(OUT.glob("results_*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            continue
        if (data.get("meta") or {}).get("mock") is True:
            print(f"SKIP {path.name}: mock")
            continue
        suites[path.stem.replace("results_", "", 1)] = data
    return suites


def _dates(path: Path, meta: dict) -> str:
    created = meta.get("created") or "unknown"
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    return f"created={created} mtime={mtime}"


def _pct(n: int, d: int) -> str:
    return "n/a" if d <= 0 else f"{100.0 * n / d:.1f}%"


def _qkind(case_id: str) -> str | None:
    part = (case_id or "").rsplit("_", 1)[-1]
    return part if part in {"time", "order", "third"} else None


def section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def inventory(suites: dict[str, dict]) -> None:
    section("SUITE INVENTORY")
    for tag, data in suites.items():
        path = OUT / f"results_{tag}.json"
        meta = data.get("meta") or {}
        print(
            f"[{tag}] {_dates(path, meta)} cases={len(data.get('cases') or [])} "
            f"runs={len(data.get('runs') or [])} judged={len(data.get('judged') or [])} "
            f"agents={meta.get('agents')} judge={meta.get('judge')}"
        )


def evaluator_catalogue() -> None:
    section("EVALUATOR CATALOGUE (from evalverse.evaluators.REGISTRY)")
    sys.path.insert(0, str(ROOT))
    from evalverse.evaluators import REGISTRY  # noqa: WPS433

    # Display groups requested by README
    group_of = {
        "answer_correctness": "deterministic",
        "evidence_grounding": "deterministic",
        "item_recall": "deterministic",
        "fabrication_check": "deterministic",
        "transcript_fidelity": "deterministic",
        "event_order": "deterministic",
        "temporal_alignment": "temporal",
        "temporal_alignment_video": "temporal",
        "cross_modal_consistency": "cross-modal",
        "cross_modal_perception": "cross-modal",
        "cross_modal_stage_attribution": "cross-modal",
        "perception_judge": "perception",
        "claim_grounding": "model judge",
        "cross_modal_judge": "model judge",
        "tool_schema_valid": "tool use",
        "tool_args_correct": "tool use",
        "tool_args_grounded": "tool use",
        "tool_order_policy": "tool use",
        "action_despite_abstention": "tool use",
        "media_dependence": "paired",
        "media_dependence_guess": "paired",
        "cross_modal_media_dependence": "paired",
        "robustness_sweep": "paired",
        "judge_audit": "paired",
        "judge_media_dependence": "paired",
        "stage_attribution": "composite",
        "audio_stage_attribution": "composite",
    }
    by: dict[str, list] = defaultdict(list)
    for eid, meta in REGISTRY.items():
        g = group_of.get(eid, meta.get("category") or "other")
        by[g].append(meta)
    order = [
        "deterministic",
        "perception",
        "temporal",
        "cross-modal",
        "model judge",
        "tool use",
        "paired",
        "composite",
        "other",
    ]
    for g in order:
        items = by.get(g) or []
        if not items:
            continue
        print(f"\n[{g}] n={len(items)}")
        for m in sorted(items, key=lambda x: x["id"]):
            mods = ",".join(m.get("modalities") or [])
            print(
                f"  {m['id']}\t{m.get('category')}\t{m.get('dimension')}\t"
                f"{mods}\tneeds_reference={m.get('needs_reference')}\tscope={m.get('scope')}"
            )


def failure_labels(suites: dict[str, dict]) -> None:
    section("FAILURE LABEL EXAMPLES (one real case each)")
    found: dict[str, dict] = {}
    for tag, data in suites.items():
        cases = {c["id"]: c for c in data.get("cases") or []}
        for r in data.get("runs") or []:
            lab = r.get("label")
            if lab not in LABELS or lab in found:
                continue
            case = cases.get(r.get("case_id"), {})
            found[lab] = {
                "suite": f"results_{tag}.json",
                "case_id": r.get("case_id"),
                "agent": r.get("agent") or r.get("model"),
                "condition": r.get("condition"),
                "expected": case.get("answer") or case.get("expected_verdict"),
                "got": r.get("answer") if r.get("answer") is not None else r.get("verdict"),
                "wer": r.get("wer"),
                "correct": r.get("correct"),
                "iou": r.get("iou"),
            }
    for lab in LABELS:
        if lab not in found:
            print(f"  {lab}: not observed in these runs")
        else:
            e = found[lab]
            print(
                f"  {lab}: suite={e['suite']} case={e['case_id']} agent={e['agent']} "
                f"condition={e['condition']} expected={e['expected']!r} got={e['got']!r} "
                f"correct={e['correct']} iou={e['iou']} wer={e['wer']}"
            )


def measured_dimensions(suites: dict[str, dict]) -> None:
    section("DIMENSIONS MEASURED")
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
    ]
    counts = {d: {"measured": 0, "suites": set()} for d in dims}
    for tag, data in suites.items():
        for r in data.get("results") or []:
            dim = r.get("dimension") or ""
            if dim == "Honesty / confident errors":
                dim = "Honesty"
            if dim not in counts:
                continue
            if r.get("status") == "completed" and r.get("label") not in (None, "skipped"):
                counts[dim]["measured"] += 1
                counts[dim]["suites"].add(tag)
        for row in (data.get("scores") or {}).get("rows") or []:
            hon = (row.get("dimensions") or {}).get("Honesty") or {}
            if hon.get("status") == "available" and (hon.get("n") or 0) > 0:
                counts["Honesty"]["measured"] += int(hon["n"])
                counts["Honesty"]["suites"].add(tag)
    if DB.exists():
        con = sqlite3.connect(DB)
        n = con.execute(
            """
            SELECT COUNT(*) FROM eval_results
            WHERE dimension='Tool use' AND status='completed'
              AND label IS NOT NULL AND label!='skipped'
            """
        ).fetchone()[0]
        if n:
            counts["Tool use"]["measured"] += n
            counts["Tool use"]["suites"].add("evalverse.db")
        con.close()
    for d in dims:
        c = counts[d]
        print(
            f"  {d}: measured_in_release={'yes' if c['measured'] else 'no'} "
            f"n={c['measured']} sources={','.join(sorted(c['suites'])) or '—'}"
        )


def failure_mix(suites: dict[str, dict]) -> None:
    section("FAILURE MIX degraded cord (blur+noise+lowres)")
    data = suites.get("cord")
    if not data:
        print("UNSUPPORTED")
        return
    print(f"source results_cord.json {_dates(OUT/'results_cord.json', data.get('meta') or {})}")
    for agent in sorted({r["agent"] for r in data["runs"]}):
        runs = [
            r
            for r in data["runs"]
            if r["agent"] == agent and r["condition"] in ("blur", "noise", "lowres")
        ]
        correct = sum(1 for r in runs if r.get("correct") is True)
        could = sum(1 for r in runs if r.get("label") == "abstained")
        wrong = sum(
            1 for r in runs if r.get("correct") is False and r.get("label") != "abstained"
        )
        n = len(runs)
        print(
            f"  {agent}: n={n} correct={correct} ({_pct(correct,n)}) "
            f"confidently_wrong={wrong} ({_pct(wrong,n)}) "
            f"could_not_read={could} ({_pct(could,n)})"
        )


def judge_trust(suites: dict[str, dict]) -> None:
    section("JUDGE TRUST (exclude agent_answer)")
    data = suites.get("wonder")
    if not data:
        print("UNSUPPORTED")
        return
    judged = data.get("judged") or []
    with_img = [j for j in judged if j.get("kind") in ("planted_right", "planted_wrong")]
    no_img = [
        j for j in judged if j.get("kind") in ("planted_right_noimg", "planted_wrong_noimg")
    ]

    def report(name: str, rows: list) -> None:
        right = [j for j in rows if "right" in (j.get("kind") or "")]
        wrong = [j for j in rows if "wrong" in (j.get("kind") or "")]
        fa = sum(1 for j in wrong if j.get("judge_accepts"))
        fr = sum(1 for j in right if not j.get("judge_accepts"))
        agrees = sum(1 for j in rows if j.get("agrees") is True)
        n = len(rows)
        print(
            f"  {name}: planted_right={len(right)} planted_wrong={len(wrong)} "
            f"FA={fa}/{len(wrong)} FR={fr}/{len(right)} "
            f"accuracy={agrees/n if n else 0:.3f} ({agrees}/{n})"
        )

    report("WITH_IMAGE", with_img)
    report("IMAGE_HIDDEN", no_img)
    print(f"  excluded_agent_answer={sum(1 for j in judged if j.get('kind')=='agent_answer')}")


def audio_stage(suites: dict[str, dict]) -> None:
    section("AUDIO bandlimit")
    data = suites.get("audio")
    if not data:
        return
    for agent in sorted({r["agent"] for r in data["runs"] if r.get("condition") == "bandlimit"}):
        runs = [r for r in data["runs"] if r["agent"] == agent and r["condition"] == "bandlimit"]
        print(f"  {agent}: n={len(runs)} {dict(Counter(r.get('label') for r in runs))}")


def video_chance(suites: dict[str, dict]) -> None:
    section("VIDEO chance")
    data = suites.get("video")
    if not data:
        return
    for kind in ["time", "order", "third"]:
        for cond in ["clean", "blind_guess"]:
            runs = [
                r
                for r in data["runs"]
                if _qkind(r.get("case_id", "")) == kind and r.get("condition") == cond
            ]
            if not runs:
                continue
            c = sum(1 for r in runs if r.get("correct"))
            print(f"  {kind}/{cond}: {c}/{len(runs)}")


def _cm_bucket(r: dict) -> str:
    expected = (r.get("expected_verdict") or "").strip().lower()
    verdict = (r.get("verdict") or r.get("answer") or "").strip().lower()
    if (
        verdict in ("cannot_tell", "none", "", "unknown")
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
        return "missed_contradiction"
    if expected == "consistent" and verdict == "inconsistent":
        return "false_alarm"
    return "other"


def crossmodal(suites: dict[str, dict]) -> None:
    section("CROSS-MODAL verdict-level")
    data = suites.get("crossmodal")
    if not data:
        return
    print(f"  n_cases={len(data.get('cases') or [])}")
    for cond in ["clean", "blur", "noisy_voice", "no_image"]:
        rows = [r for r in data["runs"] if r.get("condition") == cond]
        if rows:
            print(f"  {cond}: n={len(rows)} {dict(Counter(_cm_bucket(r) for r in rows))}")
    with_r = [r for r in data["runs"] if r.get("condition") != "no_image"]
    no_r = [r for r in data["runs"] if r.get("condition") == "no_image"]
    print(f"  WITH_RECEIPT: n={len(with_r)} {dict(Counter(_cm_bucket(r) for r in with_r))}")
    print(f"  NO_RECEIPT: n={len(no_r)} {dict(Counter(_cm_bucket(r) for r in no_r))}")


def lists_suite(suites: dict[str, dict]) -> None:
    section("LISTS completeness + hallucination")
    data = suites.get("lists")
    if not data:
        print("UNSUPPORTED")
        return
    print(f"source results_lists.json {_dates(OUT/'results_lists.json', data.get('meta') or {})}")
    for eid in ("item_recall", "fabrication_check"):
        rows = [
            r
            for r in data.get("results") or []
            if r.get("evaluator_id") == eid
            and r.get("status") == "completed"
            and r.get("label") != "skipped"
        ]
        print(f"  {eid}: n={len(rows)} {dict(Counter(r.get('label') for r in rows))}")


def tool_use() -> None:
    section("TOOL USE deduped live vs naive")
    if not DB.exists():
        print("UNSUPPORTED")
        return
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT t.id tid, t.session_id, t.started_at, t.metadata_json, t.input_json, t.output_json,
               er.evaluator_id, er.label, er.status, er.explanation
        FROM traces t
        JOIN eval_results er ON er.trace_id=t.id
        WHERE EXISTS (SELECT 1 FROM spans s WHERE s.trace_id=t.id AND s.type='tool')
          AND er.evaluator_id IN ('tool_args_correct','action_despite_abstention','answer_correctness')
        """
    ).fetchall()
    by_trace: dict[str, dict] = defaultdict(dict)
    meta_by: dict[str, sqlite3.Row] = {}
    for r in rows:
        by_trace[r["tid"]][r["evaluator_id"]] = r
        meta_by[r["tid"]] = r
    best: dict[tuple, dict] = {}
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
        tac = evs.get("tool_args_correct")
        lab = tac["label"] if tac else None
        if lab == "correct_amount":
            bucket = "correct_amount"
        elif lab == "wrong_amount":
            bucket = "wrong_amount"
        elif lab == "skipped" or (tac and tac["status"] == "skipped"):
            bucket = "declined"
        else:
            bucket = lab or "other"
        ans = (evs.get("answer_correctness") or {"label": None})["label"]
        ada = (evs.get("action_despite_abstention") or {"label": None})["label"]
        acted = bucket in ("correct_amount", "wrong_amount")
        unsure = bool(acted and (ans == "abstained" or ada not in (None, "safe", "skipped")))
        key = (prefix, str(case), str(cond))
        ts = r["started_at"] or ""
        if key not in best or ts > best[key]["ts"]:
            best[key] = {
                "ts": ts,
                "bucket": bucket,
                "acted": acted,
                "unsure": unsure,
                "ans": ans,
                "case": case,
                "cond": cond,
                "answer": out.get("answer"),
                "explanation": (tac["explanation"] if tac else "")[:120],
            }
    unsure_total = 0
    for prefix in ("live", "naive"):
        items = [v for k, v in best.items() if k[0] == prefix]
        unsure = sum(1 for v in items if v["unsure"])
        unsure_total += unsure
        print(
            f"  {prefix}: n={len(items)} acted={sum(1 for v in items if v['acted'])} "
            f"correct_amount={sum(1 for v in items if v['bucket']=='correct_amount')} "
            f"wrong_amount={sum(1 for v in items if v['bucket']=='wrong_amount')} "
            f"declined={sum(1 for v in items if v['bucket']=='declined')} "
            f"acted_while_unsure={unsure}"
        )
        ex = next(
            (v for v in items if v["bucket"] == "wrong_amount" and v["ans"] == "incorrect"),
            None,
        )
        if ex:
            print(
                f"    example: case={ex['case']} cond={ex['cond']} "
                f"answer={ex['answer']!r} expl={ex['explanation']!r}"
            )
    print(f"  ACTED_WHILE_UNSURE_TOTAL={unsure_total}")
    con.close()


def ums(suites: dict[str, dict]) -> None:
    section("UMS overall (skip crossmodal in README table)")
    for tag, data in suites.items():
        scores = data.get("scores")
        if not scores:
            continue
        for row in scores.get("rows") or []:
            if row.get("variant") != "overall":
                continue
            print(
                f"  [{tag}] {row.get('agent')} ums={row.get('ums')} "
                f"ci_95={row.get('ci_95')} coverage={row.get('coverage')} gate={row.get('gate')}"
            )


def model_calls(suites: dict[str, dict]) -> None:
    section("MODEL CALLS")
    ta = tj = ts = 0
    for tag, data in suites.items():
        a = sum(
            1
            for t in data.get("traces") or []
            for s in t.get("spans") or []
            if s.get("type") == "model" or s.get("name") == "model_call"
        )
        j = len(data.get("judged") or [])
        s = sum(
            1
            for t in data.get("traces") or []
            for sp in t.get("spans") or []
            if "transcribe" in (sp.get("name") or "").lower()
        )
        ta += a
        tj += j
        ts += s
        print(f"  {tag}: agent={a} judged={j} transcribe={s}")
    print(f"  TOTAL agent={ta} judged={tj} transcribe={ts} sum={ta+tj+ts}")
    print("  models=muse-spark-1.1,muse-spark-1.3,muse-wonder-1.0,muse-voice-transcribe-1.0")
    print("  api_base=https://api.meta.ai/v1")


def main() -> int:
    print("EvalVerse README numbers")
    print(f"generated_at_utc={datetime.now(tz=timezone.utc).isoformat()}")
    suites = _load_suites()
    if not suites:
        return 1
    inventory(suites)
    evaluator_catalogue()
    failure_labels(suites)
    measured_dimensions(suites)
    failure_mix(suites)
    judge_trust(suites)
    audio_stage(suites)
    video_chance(suites)
    crossmodal(suites)
    lists_suite(suites)
    tool_use()
    ums(suites)
    model_calls(suites)
    section("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
