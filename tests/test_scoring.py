"""UMS (Unified Multimodal Score) unit tests — no model calls."""
from __future__ import annotations

import copy

import pytest

from evalverse import scoring


def _r(agent, case, variant, eid, score, *, status="completed", label=None, dimension="Perception"):
    return {
        "id": f"{agent}|{case}|{variant}|{eid}",
        "evaluator_id": eid,
        "dimension": dimension,
        "status": status,
        "score": score,
        "label": label,
        "target": {"agent": agent, "case_id": case, "variant": variant},
    }


POLICY = scoring.load_policy()


def test_renormalisation_and_missing_never_zero():
    # Perception + Honesty available from answer_correctness; Groundedness stays unavailable (not 0).
    results = [
        _r("a", "c1", "clean", "answer_correctness", 1.0, label="correct"),
        _r("a", "c2", "clean", "answer_correctness", 0.0, label="incorrect"),
    ]
    dims = scoring.dimension_scores_from_results(results, POLICY)
    assert dims["Perception"]["status"] == "available"
    assert dims["Perception"]["score"] == pytest.approx(0.5)
    assert dims["Honesty"]["status"] == "available"
    assert dims["Honesty"]["score"] == pytest.approx(0.5)  # 1 incorrect / 2
    assert dims["Groundedness"]["status"] == "unavailable"
    assert dims["Groundedness"]["score"] is None  # never zero

    weights = POLICY["profiles"]["balanced"]
    combined = scoring.combine_ums(dims, weights, POLICY["gate"])
    # P.25 + H.15 = 0.40 → Perception eff = 0.25/0.40
    assert combined["weights_eff"]["Perception"] == pytest.approx(0.25 / 0.40)
    assert combined["weights_eff"]["Honesty"] == pytest.approx(0.15 / 0.40)
    assert "Groundedness" not in combined["weights_eff"]
    assert combined["dimensions"]["Groundedness"]["score"] is None
    assert combined["ums"] == pytest.approx(0.5)
    assert combined["coverage"] == pytest.approx(0.25 + 0.15)


def test_honesty_maths():
    results = [
        _r("a", "c1", "clean", "answer_correctness", 1.0, label="correct"),
        _r("a", "c2", "clean", "answer_correctness", 0.0, label="incorrect"),
        _r("a", "c3", "clean", "answer_correctness", 0.0, label="abstained"),
        _r("a", "c4", "clean", "answer_correctness", 0.0, label="incorrect"),
    ]
    # 2 confident errors / 4 => rate 0.5 => honesty 0.5
    score, n = scoring.honesty_score(results)
    assert n == 4
    assert score == pytest.approx(0.5)

    empty_score, empty_n = scoring.honesty_score([])
    assert empty_score is None and empty_n == 0


def test_gate_reasons():
    dims = {
        "Perception": {"score": 0.9, "n": 10, "status": "available"},
        "Groundedness": {"score": 0.4, "n": 10, "status": "available"},  # below floor
        "Honesty": {"score": 0.9, "n": 10, "status": "available"},
        "Media dependence": {"score": None, "n": 0, "status": "unavailable"},
        "Robustness": {"score": None, "n": 0, "status": "unavailable"},
        "Tool use": {"score": None, "n": 0, "status": "unavailable"},
        "Completeness": {"score": None, "n": 0, "status": "unavailable"},
        "Hallucination": {"score": None, "n": 0, "status": "unavailable"},
    }
    # Available weights: P.25 + G.25 + H.15 = 0.65; ums = (0.25/0.65)*0.9 + (0.25/0.65)*0.4 + (0.15/0.65)*0.9
    combined = scoring.combine_ums(dims, POLICY["profiles"]["balanced"], POLICY["gate"])
    assert combined["gate"]["pass"] is False
    reasons = " ".join(combined["gate"]["reasons"])
    assert "Groundedness_below_floor" in reasons

    # Low UMS only
    dims2 = copy.deepcopy(dims)
    dims2["Groundedness"]["score"] = 0.6
    dims2["Perception"]["score"] = 0.4
    dims2["Honesty"]["score"] = 0.4
    combined2 = scoring.combine_ums(dims2, POLICY["profiles"]["balanced"], POLICY["gate"])
    assert combined2["gate"]["pass"] is False
    assert any(r.startswith("ums_below_min") for r in combined2["gate"]["reasons"])

    # Unavailable Honesty does not fail honesty floor
    dims3 = {
        "Perception": {"score": 0.95, "n": 5, "status": "available"},
        "Groundedness": {"score": 0.95, "n": 5, "status": "available"},
        "Honesty": {"score": None, "n": 0, "status": "unavailable"},
        "Media dependence": {"score": None, "n": 0, "status": "unavailable"},
        "Robustness": {"score": None, "n": 0, "status": "unavailable"},
        "Tool use": {"score": None, "n": 0, "status": "unavailable"},
        "Completeness": {"score": None, "n": 0, "status": "unavailable"},
        "Hallucination": {"score": None, "n": 0, "status": "unavailable"},
    }
    ok = scoring.combine_ums(dims3, POLICY["profiles"]["balanced"], POLICY["gate"])
    assert ok["gate"]["pass"] is True
    assert ok["gate"]["reasons"] == []


def test_ci_determinism():
    results = []
    for i in range(8):
        results.append(
            _r("a", f"c{i}", "clean", "answer_correctness", 1.0 if i % 2 == 0 else 0.0, label="correct" if i % 2 == 0 else "incorrect")
        )
        results.append(
            _r(
                "a",
                f"c{i}",
                "clean",
                "evidence_grounding",
                1.0 if i % 3 == 0 else 0.5,
                dimension="Groundedness",
                label="grounded",
            )
        )
    ci1 = scoring.bootstrap_ums_ci(
        results, "a", "clean", POLICY["profiles"]["balanced"], POLICY, n=200, seed=7
    )
    ci2 = scoring.bootstrap_ums_ci(
        results, "a", "clean", POLICY["profiles"]["balanced"], POLICY, n=200, seed=7
    )
    assert ci1 is not None and ci2 is not None
    assert ci1 == ci2
    assert ci1[0] <= ci1[1]


def test_constructed_rank_flip():
    """Perception-strong agent leads under extraction; robustness-strong agent leads under robustness."""
    results = []
    for i in range(10):
        # perc: excellent perception/grounding/honesty, weak robustness
        results.append(_r("perc", f"c{i}", "clean", "answer_correctness", 1.0, label="correct"))
        results.append(
            _r("perc", f"c{i}", "clean", "evidence_grounding", 1.0, dimension="Groundedness", label="grounded")
        )
        results.append(
            _r("perc", f"c{i}", "all", "robustness_sweep", 0.1, dimension="Robustness", label="fragile")
        )
        # rob: weaker perception/grounding, perfect honesty (abstained not confident error), strong robustness
        results.append(_r("rob", f"c{i}", "clean", "answer_correctness", 0.55, label="abstained"))
        results.append(
            _r("rob", f"c{i}", "clean", "evidence_grounding", 0.55, dimension="Groundedness", label="ungrounded")
        )
        results.append(
            _r("rob", f"c{i}", "all", "robustness_sweep", 1.0, dimension="Robustness", label="robust")
        )

    rs = scoring.rank_stability(results, POLICY)
    assert rs["ranking_by_profile"]["extraction"][0] == "perc"
    assert rs["ranking_by_profile"]["robustness"][0] == "rob"
    assert rs["stable"] is False
    involved = {(f["a"], f["b"]) for f in rs["flips"]} | {(f["b"], f["a"]) for f in rs["flips"]}
    assert ("perc", "rob") in involved


def test_score_payload_has_per_case_and_overall():
    results = [
        _r("a", "c1", "clean", "answer_correctness", 1.0, label="correct"),
        _r("a", "c1", "clean", "evidence_grounding", 1.0, dimension="Groundedness", label="grounded"),
        _r("a", "c2", "blur", "answer_correctness", 0.0, label="incorrect"),
        _r("a", "c2", "blur", "evidence_grounding", 0.0, dimension="Groundedness", label="ungrounded"),
    ]
    payload = scoring.score_payload({"results": results}, profile="balanced", with_ci=False)
    variants = {r["variant"] for r in payload["rows"]}
    assert "clean" in variants and "blur" in variants and "overall" in variants
    overall = next(r for r in payload["rows"] if r["variant"] == "overall")
    assert "dimension_scores" in overall
    assert "c1" in overall["dimension_scores"]
    assert overall["dimensions"]["Groundedness"]["score"] is not None


def test_api_scores_suite(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from evalverse.server.app import create_app

    # Point OUT at tmp and write a tiny suite file
    monkeypatch.setattr(scoring, "OUT", tmp_path)
    data = {
        "results": [
            _r("a", "c1", "clean", "answer_correctness", 1.0, label="correct"),
            _r("a", "c1", "clean", "evidence_grounding", 1.0, dimension="Groundedness", label="grounded"),
        ]
    }
    # API suite loader reads ROOT/out — patch platform path via writing real out is heavy;
    # exercise results_from_eval_rows + score path via service method with run_id instead.
    app = create_app(db_path=tmp_path / "s.db", media_dir=tmp_path / "media", api_key="dev", start_workers=False)
    with TestClient(app) as client:
        H = {"Authorization": "Bearer dev", "X-Project": "default"}
        # Create a completed evaluation run with results
        client.post(
            "/api/v1/traces",
            headers=H,
            json={
                "id": "a|c1|clean",
                "agent": "a",
                "status": "completed",
                "source": "sdk",
                "metadata": {"case_id": "c1", "variant": "clean"},
                "tags": ["demo"],
                "spans": [{"id": "m1", "name": "m", "type": "model", "status": "completed", "output": {"answer": "1"}}],
            },
        )
        svc = app.state.service
        svc.ensure_eval_run("default", "run-ums")
        svc.upsert_eval_result(
            project="default",
            run_id="run-ums",
            result_id="a|c1|clean|answer_correctness",
            trace_id="a|c1|clean",
            evaluator_id="answer_correctness",
            evaluator_version="1.0.0",
            dimension="Perception",
            status="completed",
            score=1.0,
            verdict="pass",
            label="correct",
            explanation="ok",
            evidence=[],
            meta={},
        )
        svc.upsert_eval_result(
            project="default",
            run_id="run-ums",
            result_id="a|c1|clean|evidence_grounding",
            trace_id="a|c1|clean",
            evaluator_id="evidence_grounding",
            evaluator_version="1.0.0",
            dimension="Groundedness",
            status="completed",
            score=1.0,
            verdict="pass",
            label="grounded",
            explanation="ok",
            evidence=[],
            meta={},
        )
        r = client.get("/api/v1/scores", headers=H, params={"run_id": "run-ums", "profile": "balanced"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["profile"] == "balanced"
        assert body["rows"]
        overall = next(x for x in body["rows"] if x["variant"] == "overall")
        assert overall["ums"] is not None
        assert overall["dimensions"]["Groundedness"]["score"] == pytest.approx(1.0)
