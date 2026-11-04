from __future__ import annotations

import numpy as np

from evalverse import audio
from evalverse import audio_run
from evalverse import evaluators as ev


CASE = {
    "id": "a1", "modality": "audio", "answer": "2", "answer_type": "text",
    "keyword": "elephant", "truth_span": [1000, 2000],
}


def run(answer="2", span=(1000, 2000), text="elephant"):
    return {
        "answer": answer, "span_ms": list(span) if span is not None else None,
        "asr_turns": {"2": text}, "error": None, "label": "x",
    }


def test_wer():
    assert audio.wer("Hello, world!", "hello world") == 0
    assert audio.wer("one two three", "one four") == 2 / 3
    assert audio.wer("", "extra") == 1


def test_audio_perturbations_are_deterministic():
    samples = np.linspace(-0.5, 0.5, 1600, dtype=np.float32)
    assert np.array_equal(audio.perturb_audio(samples, 16000, "noise", 4), audio.perturb_audio(samples, 16000, "noise", 4))
    assert np.array_equal(audio.perturb_audio(samples, 16000, "bandlimit", 0), audio.perturb_audio(samples, 16000, "bandlimit", 9))
    assert not np.array_equal(samples, audio.perturb_audio(samples, 16000, "bandlimit", 0))


def test_span_match():
    assert ev.span_match([1000, 2000], [1400, 2200])
    assert ev.span_match([1000, 2000], [1400, 1600])  # cited midpoint is inside
    assert not ev.span_match([1000, 2000], [2100, 2200])


def test_audio_labels():
    assert ev.audio_label(CASE, run()) == "grounded_correct"
    assert ev.audio_label(CASE, run(span=(3000, 4000))) == "correct_ungrounded"
    assert ev.audio_label(CASE, run(answer="1", span=(1000, 2000), text="missing")) == "heard_wrong"
    assert ev.audio_label(CASE, run(answer="1", span=(1000, 2000))) == "misunderstood"
    assert ev.audio_label(CASE, run(answer="1", span=(3000, 4000))) == "mislocated"
    assert ev.audio_label(CASE, run(answer="unknown", span=None)) == "abstained"


def test_mock_audio_runner_writes_results(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_run, "OUT", tmp_path)
    monkeypatch.setattr("sys.argv", ["audio_run", "--mock", "--tag", "audio"])
    audio_run.main()
    result = tmp_path / "results_audio.json"
    assert result.exists()
    payload = __import__("json").loads(result.read_text())
    assert payload["meta"]["modality"] == "audio"
    assert payload["traces"][0]["spans"][1]["name"] == "transcribe"
