"""Video slice tests — no network."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from evalverse import core
from evalverse import video as vmod
from evalverse import video_evaluators  # noqa: F401 — register
from evalverse import video_run
from evalverse.datasets import video as video_ds


def test_frame_timestamps(tmp_path):
    # Tiny synthetic clip via dataset builder pieces: write 1s @ 10fps manually
    import imageio.v2 as imageio

    path = tmp_path / "t.mp4"
    with imageio.get_writer(str(path), fps=10, codec="libx264", quality=8) as w:
        for i in range(30):  # 3 seconds
            img = Image.new("RGB", (64, 48), color=(i * 5 % 255, 40, 40))
            w.append_data(np.asarray(img))
    frames = vmod.sample_frames(path, every_s=1.0)
    assert frames, "expected sampled frames"
    times = [t for t, _ in frames]
    # 0, 1000, 2000 (± rounding)
    assert times[0] == 0
    assert abs(times[1] - 1000) <= 50
    assert all(isinstance(im, Image.Image) for _, im in frames)


def test_perturbation_determinism():
    frames = [(0, Image.new("RGB", (32, 32), color=(100, 120, 140))), (2000, Image.new("RGB", (32, 32), color=(50, 60, 70)))]
    a = vmod.perturb_video(frames, "blur", seed=3)
    b = vmod.perturb_video(frames, "blur", seed=3)
    assert [t for t, _ in a] == [t for t, _ in b]
    assert list(a[0][1].getdata()) == list(b[0][1].getdata())
    c = vmod.perturb_video(frames, "noise", seed=3)
    d = vmod.perturb_video(frames, "noise", seed=3)
    assert list(c[0][1].getdata()) == list(d[0][1].getdata())
    # clean is identity
    clean = vmod.perturb_video(frames, "clean", seed=0)
    assert list(clean[0][1].getdata()) == list(frames[0][1].getdata())
    h1 = vmod.frame_set_hash(a)
    h2 = vmod.frame_set_hash(b)
    assert h1 == h2


def test_seconds_tolerance():
    case = {
        "answer": "12.4",
        "answer_type": "seconds",
        "tolerance_s": 1.0,
    }
    assert vmod.video_answer_correct(case, "12.4")
    assert vmod.video_answer_correct(case, "12.0")
    assert vmod.video_answer_correct(case, "13.4")
    assert not vmod.video_answer_correct(case, "14.0")
    assert vmod.video_answer_correct(
        {"answer": "TAX", "answer_type": "text"}, "tax"
    )
    assert vmod.video_answer_correct(
        {"answer": "MILK 1L", "answer_type": "text"}, "milk1l"
    )
    assert not vmod.video_answer_correct(
        {"answer": "MILK 1L", "answer_type": "text"}, "BREAD"
    )


def test_label_logic():
    case = {
        "answer": "10.0",
        "answer_type": "seconds",
        "tolerance_s": 1.0,
        "truth_span_ms": [10000, 11500],
    }
    interval = 2000

    def lab(answer, span, correct=None):
        run = {
            "answer": answer,
            "span_ms": span,
            "correct": vmod.video_answer_correct(case, answer) if correct is None else correct,
        }
        run["evidence_ok"] = vmod.video_span_match(
            case["truth_span_ms"], span, sampling_interval_ms=interval
        )
        return vmod.video_label(case, run, sampling_interval_ms=interval)

    assert lab("10.0", [10000, 11500]) == "grounded_correct"
    assert lab("10.0", [0, 500]) == "correct_ungrounded"
    assert lab("4.0", [10000, 11500]) == "misread"
    assert lab("4.0", [0, 500]) == "mistimed"
    assert lab("unknown", None) == "abstained"
    assert vmod.video_label(case, {"label": "invalid_output", "answer": "", "span_ms": None}) == "invalid_output"


def test_video_span_match_with_sampling_tolerance():
    truth = [10000, 11500]
    # Midpoint inside expanded window
    assert vmod.video_span_match(truth, [8000, 8500], sampling_interval_ms=2000)
    # Far away
    assert not vmod.video_span_match(truth, [0, 500], sampling_interval_ms=2000)


def test_event_order_evaluator_skips_non_order():
    from evalverse import evaluators as ev

    meta = ev.REGISTRY["event_order"]
    case = {"id": "vid_01_time", "modality": "video", "answer": "TAX", "truth_span_ms": [1, 2]}
    res = ev._call(meta, "a", "vid_01_time", "clean", case=case, run={"answer": "TAX"})
    assert res["status"] == "skipped"

    case_o = {"id": "vid_01_order", "modality": "video", "answer": "TAX", "truth_span_ms": [1, 2]}
    res2 = ev._call(meta, "a", "vid_01_order", "clean", case=case_o, run={"answer": "TAX"})
    assert res2["status"] == "completed" and res2["label"] == "ordered"


def test_mock_video_runner_end_to_end(tmp_path, monkeypatch):
    # Build one short video + cases into tmp, point paths there.
    monkeypatch.setattr(video_ds, "ROOT", tmp_path)
    monkeypatch.setattr(video_ds, "DATA", tmp_path / "data")
    monkeypatch.setattr(video_ds, "VIDEO_DIR", tmp_path / "data" / "video")
    # Speed up: shorter clip for the test by monkeypatching constants
    monkeypatch.setattr(video_ds, "DURATION_S", 4.0)
    monkeypatch.setattr(video_ds, "N_FRAMES", 40)
    monkeypatch.setattr(video_ds, "FPS", 10)

    video_ds.main(["--n", "1", "--seed", "7"])
    cases_path = tmp_path / "data" / "cases_video.json"
    assert cases_path.exists()
    cases = json.loads(cases_path.read_text())
    assert len(cases) == 3
    assert (tmp_path / "data" / "video" / "vid_01.mp4").is_file()

    monkeypatch.setattr(video_run, "ROOT", tmp_path)
    monkeypatch.setattr(video_run, "OUT", tmp_path / "out")
    monkeypatch.setattr(video_run, "CASES", cases_path)
    monkeypatch.setattr(
        "sys.argv",
        ["video_run", "--mock", "--tag", "video", "--agents", "muse-spark-1.3", "--conditions", "clean"],
    )
    video_run.main()
    out = tmp_path / "out" / "results_video.json"
    assert out.exists()
    payload = json.loads(out.read_text())
    assert payload["meta"]["modality"] == "video"
    assert payload["traces"]
    tr = payload["traces"][0]
    by = {s["id"]: s for s in tr["spans"]}
    assert by["s1"]["name"] in ("attach_video", "remove_media")
    assert by["s1"]["parent_span_ids"] == []
    s2 = [s for s in tr["spans"] if str(s["id"]).startswith("s2_")]
    assert s2, "expected parallel sample-frame spans"
    for sp in s2:
        assert sp["parent_span_ids"] == ["s1"]
        assert "t_ms" in (sp.get("attributes") or {})
    assert set(by["s3"]["parent_span_ids"]) == {s["id"] for s in s2}
    assert by["s4"]["parent_span_ids"] == ["s3"]
