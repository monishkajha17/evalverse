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


def test_transcript_header_uses_milliseconds():
    case = audio_run._mock_cases()[0]
    transcript, *_ = audio_run.hear(case, "clean", mock=True)
    turn = case["turns"][2]
    assert f"[turn 3 | {turn['start_ms']}-{turn['end_ms']} ms]" in transcript
    assert " ms]" in transcript
    assert " s]" not in transcript


def test_span_unit_warning_counter():
    cases = [{"id": "long", "duration_ms": 20000}, {"id": "short", "duration_ms": 4000}]
    runs = [
        {"case_id": "long", "span_ms": [1.2, 6.4]},
        {"case_id": "long", "span_ms": [12400, 18900]},
        {"case_id": "long", "span_ms": None},
        {"case_id": "short", "span_ms": [1, 3]},
    ]
    assert audio_run.count_span_unit_warnings(cases, runs) == 1


def test_media_dependence_guess():
    meta = ev.REGISTRY["media_dependence_guess"]
    assert ev.REGISTRY["media_dependence"]["id"] == "media_dependence"
    clean = run()
    guessed_wrong = run(answer="1", span=(8000, 11000))
    guessed_right = run()
    clean_wrong = run(answer="1", span=(1000, 2000))

    required = ev._call(meta, "a", "a1", "all", case=CASE, clean_run=clean, blind_guess_run=guessed_wrong)
    assert required["status"] == "completed" and required["verdict"] == "pass"
    assert required["label"] == "media_required" and "1/5" in required["explanation"]

    not_required = ev._call(meta, "a", "a1", "all", case=CASE, clean_run=clean, blind_guess_run=guessed_right)
    assert not_required["label"] == "media_not_required" and not_required["verdict"] == "fail"
    assert "1/5" in not_required["explanation"]

    inconclusive = ev._call(meta, "a", "a1", "all", case=CASE, clean_run=clean_wrong, blind_guess_run=guessed_wrong)
    assert inconclusive["status"] == "inconclusive" and inconclusive["score"] is None
    assert "1/5" in inconclusive["explanation"]


def test_reuse_asr_mock_makes_no_asr_calls(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(audio, "transcribe", lambda *args, **kwargs: calls.append(1) or {"transcript": "should not run"})
    monkeypatch.setattr(audio_run, "OUT", tmp_path)
    monkeypatch.setattr("sys.argv", ["audio_run", "--mock", "--reuse-asr", "--tag", "audio", "--limit", "1"])
    audio_run.main()
    assert calls == []
    payload = __import__("json").loads((tmp_path / "results_audio.json").read_text())
    assert "span_unit_warnings" in payload["meta"]
    assert any(run["condition"] == "blind_guess" for run in payload["runs"])


def test_mock_audio_runner_writes_results(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_run, "OUT", tmp_path)
    monkeypatch.setattr("sys.argv", ["audio_run", "--mock", "--tag", "audio"])
    audio_run.main()
    result = tmp_path / "results_audio.json"
    assert result.exists()
    payload = __import__("json").loads(result.read_text())
    assert payload["meta"]["modality"] == "audio"
    assert payload["traces"][0]["spans"][1]["name"] == "transcribe"
