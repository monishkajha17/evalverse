"""Path rewriting for Studio export."""
from __future__ import annotations

from evalverse.export import rewrite_media_paths, suite_from_results_path
from pathlib import Path


def test_suite_from_results_path():
    assert suite_from_results_path(Path("out/results.json")) == "default"
    assert suite_from_results_path(Path("out/results_cord.json")) == "cord"
    assert suite_from_results_path(Path("results_audio.json")) == "audio"


def test_rewrite_media_paths_cases_and_traces():
    mapping = {
        "data/images/receipt_01.png": "/media/default/receipt_01.jpg",
        "out/perturbed/receipt_01_clean.png": "/media/default/receipt_01_clean.jpg",
        "data/audio/conv_01.wav": "/media/audio/conv_01.wav",
    }
    payload = {
        "cases": [
            {
                "id": "receipt_01",
                "image": "data/images/receipt_01.png",
                "note": "leave alone",
            },
            {
                "id": "conv_01",
                "audio": "data/audio/conv_01.wav",
                "turns": [{"clip": "data/audio/conv_01.wav"}],
            },
        ],
        "traces": [
            {
                "assets": [
                    {"path": "out/perturbed/receipt_01_clean.png", "type": "media"},
                    {"path": "missing/file.png", "type": "media"},
                ]
            }
        ],
        "untouched": "data/images/receipt_01.png",
    }

    out = rewrite_media_paths(
        {"cases": payload["cases"], "traces": payload["traces"]},
        mapping,
    )

    assert out["cases"][0]["image"] == "/media/default/receipt_01.jpg"
    assert out["cases"][0]["note"] == "leave alone"
    assert out["cases"][1]["audio"] == "/media/audio/conv_01.wav"
    assert out["cases"][1]["turns"][0]["clip"] == "/media/audio/conv_01.wav"
    assert out["traces"][0]["assets"][0]["path"] == "/media/default/receipt_01_clean.jpg"
    # Unmapped paths stay as-is (missing files are skipped at copy time).
    assert out["traces"][0]["assets"][1]["path"] == "missing/file.png"
    # Only the selected subtrees are rewritten by the caller.
    assert payload["untouched"] == "data/images/receipt_01.png"
