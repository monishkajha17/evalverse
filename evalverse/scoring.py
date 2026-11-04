"""Unified Multimodal Score (UMS) — deterministic, no model calls.

    python -m evalverse.scoring --tag cord --profile balanced
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
POLICY_PATH = Path(__file__).resolve().parent / "policy.json"

BLIND_DEFAULT = ("blind", "blind_guess")


def load_policy(path: Path | None = None) -> dict[str, Any]:
    p = path or POLICY_PATH
    return json.loads(p.read_text())


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _is_blind(variant: str | None, policy: dict) -> bool:
    blind = set(policy.get("blind_variants") or BLIND_DEFAULT)
    return (variant or "") in blind


def _result_target(r: dict) -> tuple[str, str, str]:
    t = r.get("target") or {}
    agent = t.get("agent") or r.get("agent") or "agent"
    case_id = t.get("case_id") or r.get("case_id") or "case"
    variant = t.get("variant") or r.get("variant") or "clean"
    return str(agent), str(case_id), str(variant)


def _completed_scores(results: Iterable[dict], evaluator_ids: set[str] | None = None) -> list[float]:
    out = []
    for r in results:
        if r.get("status") != "completed":
            continue
        if r.get("score") is None:
            continue
        eid = r.get("evaluator_id") or ""
        if evaluator_ids is not None and eid not in evaluator_ids:
            continue
        try:
            out.append(float(r["score"]))
        except (TypeError, ValueError):
            continue
    return out


def _dim_evaluators(dim_cfg: dict, all_eids: set[str] | None = None) -> set[str]:
    eids = set(dim_cfg.get("evaluators") or [])
    prefix = dim_cfg.get("match_prefix")
    if prefix and all_eids is not None:
        eids |= {e for e in all_eids if e.startswith(prefix)}
    return eids


def honesty_score(results: list[dict]) -> tuple[float | None, int]:
    """Honesty = 1 - confident_error_rate. Confident error = wrong and not abstained.

    Uses completed answer_correctness rows: label incorrect => confident error;
    abstained / correct are not confident errors.
    """
    rows = [
        r
        for r in results
        if r.get("evaluator_id") == "answer_correctness" and r.get("status") == "completed"
    ]
    if not rows:
        return None, 0
    n_err = sum(1 for r in rows if r.get("label") == "incorrect")
    rate = n_err / len(rows)
    return 1.0 - rate, len(rows)


def dimension_scores_from_results(
    results: list[dict],
    policy: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Map results -> per-dimension {score, n, status}."""
    dims_cfg = policy.get("dimensions") or {}
    all_eids = {r.get("evaluator_id") for r in results if r.get("evaluator_id")}
    out: dict[str, dict[str, Any]] = {}
    for dim, cfg in dims_cfg.items():
        if cfg.get("kind") == "honesty_from_answer_correctness":
            score, n = honesty_score(results)
        else:
            eids = _dim_evaluators(cfg, all_eids)
            scores = _completed_scores(results, eids)
            n = len(scores)
            score = _mean(scores)
        if n == 0 or score is None:
            out[dim] = {"score": None, "n": 0, "status": "unavailable"}
        else:
            out[dim] = {"score": float(score), "n": n, "status": "available"}
    return out


def combine_ums(
    dim_scores: dict[str, dict[str, Any]],
    weights: dict[str, float],
    gate_cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Renormalise over available dims; missing never becomes zero."""
    available = {
        d: info
        for d, info in dim_scores.items()
        if info.get("status") == "available" and info.get("score") is not None
    }
    # Effective weights: only dims with original weight > 0 and available.
    usable = {d: float(weights.get(d, 0.0)) for d in available if float(weights.get(d, 0.0)) > 0}
    w_sum = sum(usable.values())
    w_eff = {d: (w / w_sum if w_sum > 0 else 0.0) for d, w in usable.items()}

    coverage = sum(float(weights.get(d, 0.0)) for d in available)
    ums = None
    if w_eff:
        ums = sum(w_eff[d] * float(available[d]["score"]) for d in w_eff)

    # Weakest among available dims that carry weight (or all available if none weighted).
    weak_pool = usable or {d: 0.0 for d in available}
    weakest = None
    if weak_pool:
        d_min = min(weak_pool, key=lambda d: float(available[d]["score"]))
        weakest = {"dimension": d_min, "score": float(available[d_min]["score"])}

    gate = evaluate_gate(ums, available, gate_cfg or {})

    dims_out = {}
    for d, info in dim_scores.items():
        dims_out[d] = {
            **info,
            "weight_orig": float(weights.get(d, 0.0)),
            "weight_eff": w_eff.get(d) if d in w_eff else None,
        }

    return {
        "ums": ums,
        "coverage": coverage,
        "weakest": weakest,
        "gate": gate,
        "dimensions": dims_out,
        "weights_eff": w_eff,
    }


def evaluate_gate(
    ums: float | None,
    available: dict[str, dict[str, Any]],
    gate_cfg: dict[str, Any],
) -> dict[str, Any]:
    reasons: list[str] = []
    min_ums = float(gate_cfg.get("min_ums", 0.7))
    floors = gate_cfg.get("floors") or {}
    passed = True
    if ums is None:
        passed = False
        reasons.append("ums_unavailable")
    elif ums < min_ums:
        passed = False
        reasons.append(f"ums_below_min ({ums:.4f} < {min_ums})")
    for dim, floor in floors.items():
        info = available.get(dim)
        if not info or info.get("score") is None:
            continue  # unavailable dims do not fail the floor
        if float(info["score"]) < float(floor):
            passed = False
            reasons.append(f"{dim}_below_floor ({float(info['score']):.4f} < {float(floor)})")
    return {"pass": passed, "reasons": reasons}


def _filter_results(
    results: list[dict],
    *,
    agent: str | None = None,
    variant: str | None = None,
    case_ids: Iterable[str] | None = None,
    include_pair_all: bool = True,
    policy: dict | None = None,
) -> list[dict]:
    """Filter results for an agent/variant slice.

    Pair-scoped evaluators (target.variant == 'all') are included for concrete
    variants when include_pair_all is True, so Media dependence / Robustness
    contribute to per-variant rows.
    """
    want_cases = set(case_ids) if case_ids is not None else None
    out = []
    for r in results:
        a, c, v = _result_target(r)
        if agent is not None and a != agent and a != "*":
            continue
        if want_cases is not None and c not in want_cases and c != "*":
            continue
        if variant is None or variant == "overall":
            if policy and _is_blind(v, policy) and v != "all":
                continue
        else:
            if v != variant and not (include_pair_all and v == "all"):
                continue
        out.append(r)
    return out


def _case_ids_for(results: list[dict], agent: str, variant: str | None, policy: dict) -> list[str]:
    ids = []
    seen = set()
    for r in results:
        a, c, v = _result_target(r)
        if a != agent or c == "*":
            continue
        if variant == "overall" or variant is None:
            if _is_blind(v, policy) and v != "all":
                continue
        elif v != variant and v != "all":
            continue
        if c not in seen:
            seen.add(c)
            ids.append(c)
    return ids


def per_case_dimension_scores(
    results: list[dict],
    agent: str,
    variant: str,
    policy: dict,
) -> dict[str, dict[str, float | None]]:
    """dimension_scores[case_id][dimension] = score | None (unavailable)."""
    case_ids = _case_ids_for(results, agent, variant, policy)
    out: dict[str, dict[str, float | None]] = {}
    for cid in case_ids:
        subset = _filter_results(
            results, agent=agent, variant=variant, case_ids=[cid], policy=policy
        )
        dims = dimension_scores_from_results(subset, policy)
        out[cid] = {d: (info["score"] if info["status"] == "available" else None) for d, info in dims.items()}
    return out


def bootstrap_ums_ci(
    results: list[dict],
    agent: str,
    variant: str,
    weights: dict[str, float],
    policy: dict,
    *,
    n: int = 1000,
    seed: int = 7,
) -> list[float] | None:
    case_ids = _case_ids_for(results, agent, variant, policy)
    if not case_ids:
        return None
    # Precompute per-case dimension vectors for speed.
    by_case = per_case_dimension_scores(results, agent, variant, policy)
    if not by_case:
        return None
    ids = list(by_case.keys())
    rng = np.random.default_rng(seed)
    samples = []
    dims = list((policy.get("dimensions") or {}).keys())
    for _ in range(n):
        draw = rng.choice(ids, size=len(ids), replace=True)
        # Mean each dimension over resampled cases (skip None).
        dim_scores: dict[str, dict[str, Any]] = {}
        for d in dims:
            vals = [by_case[c][d] for c in draw if by_case[c].get(d) is not None]
            if not vals:
                dim_scores[d] = {"score": None, "n": 0, "status": "unavailable"}
            else:
                dim_scores[d] = {"score": float(sum(vals) / len(vals)), "n": len(vals), "status": "available"}
        combined = combine_ums(dim_scores, weights, policy.get("gate"))
        if combined["ums"] is not None:
            samples.append(float(combined["ums"]))
    if not samples:
        return None
    lo = float(np.percentile(samples, 2.5))
    hi = float(np.percentile(samples, 97.5))
    return [lo, hi]


def score_agent_variant(
    results: list[dict],
    agent: str,
    variant: str,
    profile: str,
    policy: dict,
    *,
    with_ci: bool = True,
    with_per_case: bool = True,
) -> dict[str, Any]:
    weights = (policy.get("profiles") or {}).get(profile)
    if not weights:
        raise ValueError(f"unknown profile: {profile}")
    subset = _filter_results(results, agent=agent, variant=variant, policy=policy)
    dims = dimension_scores_from_results(subset, policy)
    combined = combine_ums(dims, weights, policy.get("gate"))
    row = {
        "agent": agent,
        "variant": variant,
        "profile": profile,
        "ums": combined["ums"],
        "coverage": combined["coverage"],
        "weakest": combined["weakest"],
        "gate": combined["gate"],
        "dimensions": combined["dimensions"],
    }
    if with_ci:
        boot = policy.get("bootstrap") or {}
        row["ci_95"] = bootstrap_ums_ci(
            results,
            agent,
            variant,
            weights,
            policy,
            n=int(boot.get("n", 1000)),
            seed=int(boot.get("seed", 7)),
        )
    else:
        row["ci_95"] = None
    if with_per_case:
        row["dimension_scores"] = per_case_dimension_scores(results, agent, variant, policy)
    return row


def list_agents(results: list[dict]) -> list[str]:
    agents = []
    seen = set()
    for r in results:
        a, _, _ = _result_target(r)
        if a in ("*", "") or a in seen:
            continue
        seen.add(a)
        agents.append(a)
    return agents


def list_variants(results: list[dict], policy: dict) -> list[str]:
    variants = []
    seen = set()
    for r in results:
        _, _, v = _result_target(r)
        if v in seen or v == "all" or _is_blind(v, policy):
            continue
        seen.add(v)
        variants.append(v)
    return variants


def rank_stability(results: list[dict], policy: dict) -> dict[str, Any]:
    profiles = list((policy.get("profiles") or {}).keys())
    agents = list_agents(results)
    ranking_by_profile: dict[str, list[str]] = {}
    ums_by_profile: dict[str, dict[str, float]] = {}
    for prof in profiles:
        scores = {}
        for agent in agents:
            row = score_agent_variant(
                results, agent, "overall", prof, policy, with_ci=False, with_per_case=False
            )
            if row["ums"] is not None:
                scores[agent] = float(row["ums"])
        ranking = sorted(scores, key=lambda a: (-scores[a], a))
        ranking_by_profile[prof] = ranking
        ums_by_profile[prof] = scores

    flips = []
    for i, p1 in enumerate(profiles):
        for p2 in profiles[i + 1 :]:
            r1, r2 = ranking_by_profile[p1], ranking_by_profile[p2]
            shared = [a for a in r1 if a in r2]
            pos1 = {a: i for i, a in enumerate(r1)}
            pos2 = {a: i for i, a in enumerate(r2)}
            for j, a in enumerate(shared):
                for b in shared[j + 1 :]:
                    if (pos1[a] - pos1[b]) * (pos2[a] - pos2[b]) < 0:
                        flips.append(
                            {
                                "profiles": [p1, p2],
                                "a": a,
                                "b": b,
                                "ums": {
                                    p1: {
                                        a: ums_by_profile[p1].get(a),
                                        b: ums_by_profile[p1].get(b),
                                    },
                                    p2: {
                                        a: ums_by_profile[p2].get(a),
                                        b: ums_by_profile[p2].get(b),
                                    },
                                },
                            }
                        )
    return {
        "ranking_by_profile": ranking_by_profile,
        "stable": len(flips) == 0,
        "flips": flips,
    }


def score_payload(
    data: dict[str, Any],
    *,
    profile: str = "balanced",
    policy: dict | None = None,
    with_ci: bool = True,
) -> dict[str, Any]:
    """Compute full UMS structure for a results JSON payload."""
    policy = policy or load_policy()
    if profile not in (policy.get("profiles") or {}):
        raise ValueError(f"unknown profile: {profile}")
    results = list(data.get("results") or [])
    agents = list_agents(results)
    variants = list_variants(results, policy)
    rows = []
    for agent in agents:
        for variant in variants:
            rows.append(
                score_agent_variant(
                    results, agent, variant, profile, policy, with_ci=with_ci, with_per_case=True
                )
            )
        rows.append(
            score_agent_variant(
                results, agent, "overall", profile, policy, with_ci=with_ci, with_per_case=True
            )
        )
    return {
        "profile": profile,
        "gate": policy.get("gate"),
        "weights": (policy.get("profiles") or {}).get(profile),
        "rows": rows,
        "rank_stability": rank_stability(results, policy),
    }


def results_from_eval_rows(
    eval_rows: list[dict],
    traces: list[dict] | None = None,
) -> list[dict]:
    """Normalise platform eval_results (+ optional traces) into scoring results shape."""
    trace_meta: dict[str, dict] = {}
    for tr in traces or []:
        tid = tr.get("id")
        if not tid:
            continue
        meta = tr.get("metadata") or {}
        inp = tr.get("input") or {}
        trace_meta[tid] = {
            "agent": tr.get("agent"),
            "case_id": meta.get("case_id") or inp.get("case_id"),
            "variant": meta.get("variant") or inp.get("variant") or "clean",
        }
        # Trace ids from importer: agent|case|variant
        parts = str(tid).split("|")
        if len(parts) >= 3:
            trace_meta[tid].setdefault("agent", parts[0])
            trace_meta[tid].setdefault("case_id", parts[1])
            trace_meta[tid].setdefault("variant", parts[2])

    out = []
    for r in eval_rows:
        tid = r.get("trace_id")
        tm = trace_meta.get(tid or "", {})
        agent = tm.get("agent")
        case_id = tm.get("case_id")
        variant = tm.get("variant")
        # Fallback: parse "agent|case|variant|evaluator..." result ids / trace ids
        rid = str(r.get("id") or "")
        parts = rid.split("|")
        if len(parts) >= 3:
            agent = agent or parts[0]
            case_id = case_id or parts[1]
            variant = variant or parts[2]
        if tid and "|" in str(tid):
            tp = str(tid).split("|")
            if len(tp) >= 3:
                agent = agent or tp[0]
                case_id = case_id or tp[1]
                variant = variant or tp[2]
        out.append(
            {
                "id": r.get("id"),
                "evaluator_id": r.get("evaluator_id"),
                "evaluator_version": r.get("evaluator_version"),
                "dimension": r.get("dimension"),
                "status": r.get("status"),
                "score": r.get("score"),
                "verdict": r.get("verdict"),
                "label": r.get("label"),
                "target": {
                    "agent": agent or "agent",
                    "case_id": case_id or "case",
                    "variant": variant or "clean",
                },
            }
        )
    return out


def format_table(scores: dict[str, Any]) -> str:
    rows = scores.get("rows") or []
    # Prefer overall rows for the CLI table; include variants if no overall.
    overall = [r for r in rows if r.get("variant") == "overall"]
    use = overall or rows
    lines = [
        f"{'agent':<22} {'UMS':>8} {'CI_lo':>8} {'CI_hi':>8} {'cov':>6} {'gate':>6}  weakest"
    ]
    for r in use:
        ums = r.get("ums")
        ci = r.get("ci_95") or [None, None]
        weak = r.get("weakest") or {}
        gate = "PASS" if (r.get("gate") or {}).get("pass") else "FAIL"
        weak_s = (
            f"{weak.get('dimension')}={weak.get('score'):.3f}"
            if weak and weak.get("score") is not None
            else "-"
        )
        lines.append(
            f"{str(r.get('agent')):<22} "
            f"{(ums if ums is not None else float('nan')):>8.4f} "
            f"{(ci[0] if ci and ci[0] is not None else float('nan')):>8.4f} "
            f"{(ci[1] if ci and ci[1] is not None else float('nan')):>8.4f} "
            f"{float(r.get('coverage') or 0):>6.2f} "
            f"{gate:>6}  {weak_s}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Compute Unified Multimodal Score from stored results.")
    ap.add_argument("--tag", default="", help="suite tag; loads out/results_<tag>.json")
    ap.add_argument("--profile", default="balanced")
    ap.add_argument("--json", action="store_true", help="print full scores JSON")
    args = ap.parse_args(argv)

    name = f"results_{args.tag}.json" if args.tag else "results.json"
    path = OUT / name
    if not path.exists():
        raise SystemExit(f"missing {path}")
    data = json.loads(path.read_text())
    scores = score_payload(data, profile=args.profile)
    if args.json:
        print(json.dumps(scores, indent=2))
    else:
        print(f"profile={args.profile}  file={path}")
        print(format_table(scores))
        rs = scores.get("rank_stability") or {}
        print(f"rank_stable={rs.get('stable')}  flips={len(rs.get('flips') or [])}")


if __name__ == "__main__":
    main()
