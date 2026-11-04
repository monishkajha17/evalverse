"""Platform wiring for video: labels, DAG, importer, policy."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from evalverse import evaluators as ev
from evalverse import scoring
from evalverse import video as vmod
from evalverse import video_evaluators  # noqa: F401
from evalverse.importer import import_results_local
from evalverse.server.app import create_app
from evalverse.video_run import build_video_trace


def test_video_evaluators_registered():
    assert "temporal_alignment_video" in ev.REGISTRY
    assert "event_order" in ev.REGISTRY
    assert "video" in ev.REGISTRY["answer_correctness"]["modalities"]
    assert "video" in ev.REGISTRY["stage_attribution"]["modalities"]
    assert "video" in ev.REGISTRY["media_dependence"]["modalities"]
    assert "video" in ev.REGISTRY["media_dependence_guess"]["modalities"]
    assert "video" in ev.REGISTRY["robustness_sweep"]["modalities"]
    assert "video" in ev.REGISTRY["perception_judge"]["modalities"]
    assert "video" in ev.REGISTRY["judge_audit"]["modalities"]


def test_video_label_rules_via_stage_attribution():
    case = {
        "id": "vid_01_time",
        "modality": "video",
        "family": "register_video",
        "answer": "10.0",
        "answer_type": "seconds",
        "tolerance_s": 1.0,
        "truth_span_ms": [10000, 11500],
        "truth_box": [100, 200, 800, 250],
    }
    meta = ev.REGISTRY["stage_attribution"]

    def run_label(answer, span):
        run = {
            "answer": answer,
            "span_ms": span,
            "box": case["truth_box"] if span else None,
            "correct": vmod.video_answer_correct(case, answer),
            "condition": "clean",
        }
        return ev._call(meta, "a", case["id"], "clean", case=case, run=run)["label"]

    assert run_label("10.0", [10000, 11500]) == "grounded_correct"
    assert run_label("10.0", [0, 500]) == "correct_ungrounded"
    assert run_label("4.0", [10000, 11500]) == "misread"
    assert run_label("4.0", [0, 500]) == "mistimed"
    assert run_label("unknown", None) == "abstained"


def test_video_dag_shape_parallel_parents():
    case = {
        "id": "vid_01_time",
        "modality": "video",
        "video": "data/video/vid_01.mp4",
        "answer": "1.0",
    }
    run = {
        "agent": "muse-spark-1.3",
        "case_id": case["id"],
        "condition": "clean",
        "answer": "1.0",
        "span_ms": [1000, 2000],
        "box": None,
        "model": "muse-spark-1.3",
        "latency": 0.01,
        "usage": {"input_tokens": 1, "output_tokens": 1},
        "prompt": "p",
        "raw": "{}",
        "error": None,
    }
    tmss = [0, 2000, 4000, 6000, 8000]
    tr = build_video_trace(case, run, tmss, result_ids=["r1"])
    by = {s["id"]: s for s in tr["spans"]}
    assert by["s1"]["parent_span_ids"] == []
    s2 = [s for s in tr["spans"] if str(s["id"]).startswith("s2_")]
    assert len(s2) == 5
    for sp in s2:
        assert sp["parent_span_ids"] == ["s1"]
        assert sp["attributes"]["t_ms"] in tmss
    assert by["s3"]["parent_span_ids"] == [f"s2_{i}" for i in range(1, 6)]
    assert by["s4"]["parent_span_ids"] == ["s3"]
    assert ev.dag_is_acyclic(tr["spans"])


def test_policy_video_mapping():
    policy = scoring.load_policy()
    g = policy["dimensions"]["Groundedness"]["evaluators"]
    assert "temporal_alignment_video" in g
    assert "event_order" in policy["dimensions"]["Reasoning"]["evaluators"]
    assert "media_dependence_guess" in policy["dimensions"]["Media dependence"]["evaluators"]
    assert policy["profiles"]["balanced"]["Reasoning"] == pytest.approx(0.1)
    # Reasoning weight taken from others: balanced still sums to 1.0
    assert sum(policy["profiles"]["balanced"].values()) == pytest.approx(1.0)

    results = [
        {
            "id": "a|vid_01_order|clean|event_order",
            "evaluator_id": "event_order",
            "dimension": "Reasoning",
            "status": "completed",
            "score": 1.0,
            "label": "ordered",
            "target": {"agent": "a", "case_id": "vid_01_order", "variant": "clean"},
        },
        {
            "id": "a|vid_01_order|clean|answer_correctness",
            "evaluator_id": "answer_correctness",
            "dimension": "Perception",
            "status": "completed",
            "score": 1.0,
            "label": "correct",
            "target": {"agent": "a", "case_id": "vid_01_order", "variant": "clean"},
        },
        {
            "id": "a|vid_01_order|clean|temporal_alignment_video",
            "evaluator_id": "temporal_alignment_video",
            "dimension": "Temporal grounding",
            "status": "completed",
            "score": 1.0,
            "label": "aligned",
            "target": {"agent": "a", "case_id": "vid_01_order", "variant": "clean"},
        },
    ]
    dims = scoring.dimension_scores_from_results(results, policy)
    assert dims["Reasoning"]["status"] == "available"
    assert dims["Reasoning"]["score"] == pytest.approx(1.0)
    assert dims["Groundedness"]["status"] == "available"
    assert dims["Perception"]["status"] == "available"


def test_importer_video_idempotent(tmp_path):
    # Minimal mp4 bytes via imageio
    import imageio.v2 as imageio
    import numpy as np
    from PIL import Image

    vid = tmp_path / "vid_01.mp4"
    with imageio.get_writer(str(vid), fps=5, codec="libx264", quality=8) as w:
        for i in range(5):
            w.append_data(np.asarray(Image.new("RGB", (32, 24), color=(i * 20, 10, 10))))

    results = {
        "meta": {"modality": "video"},
        "cases": [{"id": "vid_01_time", "video": str(vid), "modality": "video"}],
        "traces": [
            {
                "id": "ag|vid_01_time|clean",
                "agent": "ag",
                "case_id": "vid_01_time",
                "variant": "clean",
                "assets": [{"id": "v1", "path": str(vid), "modality": "video"}],
                "spans": [
                    {"id": "s1", "name": "attach_video", "type": "media", "parent_span_ids": []},
                    {
                        "id": "s2_1",
                        "name": "sample frame 1",
                        "type": "media",
                        "parent_span_ids": ["s1"],
                        "attributes": {"t_ms": 0},
                    },
                    {
                        "id": "s2_2",
                        "name": "sample frame 2",
                        "type": "media",
                        "parent_span_ids": ["s1"],
                        "attributes": {"t_ms": 2000},
                    },
                    {
                        "id": "s3",
                        "name": "model_call",
                        "type": "model",
                        "parent_span_ids": ["s2_1", "s2_2"],
                        "output": {"answer": "1.0"},
                    },
                    {
                        "id": "s4",
                        "name": "evaluation",
                        "type": "evaluation",
                        "parent_span_ids": ["s3"],
                        "result_ids": ["ag|vid_01_time|clean|answer_correctness"],
                    },
                ],
            }
        ],
        "results": [
            {
                "id": "ag|vid_01_time|clean|answer_correctness",
                "evaluator_id": "answer_correctness",
                "evaluator_version": "1.0.0",
                "dimension": "Perception",
                "status": "completed",
                "score": 1.0,
                "verdict": "pass",
                "label": "correct",
                "target": {"agent": "ag", "case_id": "vid_01_time", "variant": "clean"},
            }
        ],
    }
    path = tmp_path / "results_video.json"
    path.write_text(json.dumps(results))

    app = create_app(
        db_path=tmp_path / "v.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=False,
    )
    with TestClient(app) as client:
        svc = app.state.service
        s1 = import_results_local(path, tag="video", service=svc)
        s2 = import_results_local(path, tag="video", service=svc)
        assert s1["traces"] == 1
        assert s2["traces"] == 0
        assert s2["traces_skipped"] == 1
        tr = svc.get_trace("default", "ag|vid_01_time|clean")
        assert tr.source == "import"
        names = [s.name for s in tr.spans]
        assert "attach_video" in names
        assert any(n.startswith("sample frame") for n in names)
        model = next(s for s in tr.spans if s.name == "model_call")
        parents = set(model.parent_ids or [])
        assert len(parents) == 2
