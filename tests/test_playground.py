"""Try-it playground API tests (mock provider, no live model calls)."""

from __future__ import annotations

import io
import os
import time
import wave
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from evalverse.server.app import create_app
from evalverse.server.sniff import sniff_upload


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("EVALVERSE_ALLOW_MOCK", "1")
    monkeypatch.setenv("EVALVERSE_PLAYGROUND_DAILY", "50")
    app = create_app(
        db_path=tmp_path / "pg.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=True,
        worker_size=2,
        allow_dev_key=True,
    )
    with TestClient(app) as c:
        yield c


def H(project="default"):
    return {"Authorization": "Bearer dev", "X-Project": project}


def _png_bytes(color=(200, 100, 50), size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format="PNG")
    return buf.getvalue()


def _wav_bytes(duration_s: float = 0.5, sr: int = 16000) -> bytes:
    n = int(sr * duration_s)
    samples = (np.sin(2 * np.pi * 440 * np.arange(n) / sr) * 0.2 * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def _mp4_bytes(tmp_path: Path, seconds: float = 2.0) -> bytes:
    import imageio.v2 as imageio

    path = tmp_path / "clip.mp4"
    fps = 10
    n = max(1, int(seconds * fps))
    with imageio.get_writer(str(path), fps=fps, codec="libx264", quality=8) as w:
        for i in range(n):
            img = Image.new("RGB", (64, 48), color=(i * 10 % 255, 40, 80))
            w.append_data(np.asarray(img))
    return path.read_bytes()


def _poll(client: TestClient, run_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    detail = None
    while time.time() < deadline:
        r = client.get(f"/api/v1/playground/runs/{run_id}", headers=H())
        assert r.status_code == 200, r.text
        detail = r.json()
        if detail["status"] in ("completed", "failed"):
            return detail
        time.sleep(0.05)
    assert detail is not None
    return detail


def test_sniff_allowlist_and_reject_exe():
    assert sniff_upload(_png_bytes())[0] == "image"
    assert sniff_upload(_wav_bytes())[0] == "audio"
    assert sniff_upload(b"\x7fELF\x01\x01\x01") is None
    assert sniff_upload(b"MZ\x90\x00") is None
    assert sniff_upload(b"not-a-real-file") is None


def test_playground_image_run_claim_grounding(client, tmp_path):
    png = _png_bytes()
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={
            "question": "Describe this receipt and say what the total is",
            "agent_model": "mock:muse-spark-1.3",
            "judge_model": "muse-wonder-1.0",
            "mock": "true",
            "evaluator_ids": "claim_grounding",
            "conditions": "clean",
        },
        files=[("files", ("receipt.png", png, "application/octet-stream"))],
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["run_id"]
    assert body["session_id"].startswith("playground:")
    assert "status_url" in body

    detail = _poll(client, body["run_id"])
    assert detail["status"] == "completed", detail
    assert detail["answer"]
    assert detail["trace_ids"]
    cg = next((x for x in detail["results"] if x.get("evaluator_id") == "claim_grounding"), None)
    assert cg is not None, detail["results"]
    assert cg["status"] in ("completed", "skipped", "error")


def test_playground_audio_mock_asr(client):
    wav = _wav_bytes(0.4)
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={
            "question": "What was said?",
            "mock": "true",
            "agent_model": "mock:muse-spark-1.3",
        },
        files=[("files", ("clip.wav", wav, "application/octet-stream"))],
    )
    assert r.status_code == 202, r.text
    detail = _poll(client, r.json()["run_id"])
    assert detail["status"] == "completed", detail.get("error")
    tid = detail["trace_ids"][0]
    tr = client.get(f"/api/v1/traces/{tid}", headers=H()).json()
    names = [s["name"] for s in tr["spans"]]
    assert "attach_audio" in names
    assert "transcribe" in names
    assert "model_call" in names
    evs = client.get(f"/api/v1/traces/{tid}/events", headers=H()).json()
    assert any(e["source"] == "asr" for e in evs)


def test_playground_video_frames(client, tmp_path):
    mp4 = _mp4_bytes(tmp_path, seconds=3.0)
    assert sniff_upload(mp4) is not None
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={
            "question": "What appears in the video?",
            "mock": "true",
            "agent_model": "mock:muse-spark-1.3",
        },
        files=[("files", ("clip.mp4", mp4, "application/octet-stream"))],
    )
    assert r.status_code == 202, r.text
    detail = _poll(client, r.json()["run_id"], timeout=45.0)
    assert detail["status"] == "completed", detail.get("error")
    tid = detail["trace_ids"][0]
    tr = client.get(f"/api/v1/traces/{tid}", headers=H()).json()
    frame_spans = [s for s in tr["spans"] if str(s["name"]).startswith("sample frame")]
    assert frame_spans, tr["spans"]
    evs = client.get(f"/api/v1/traces/{tid}/events", headers=H()).json()
    assert any(e["source"] == "sampled_frame" for e in evs)


def test_playground_bad_content_type(client):
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={"question": "hi", "mock": "true"},
        files=[("files", ("evil.exe", b"\x7fELF\x02\x01\x01" + b"\x00" * 20, "application/octet-stream"))],
    )
    assert r.status_code == 400
    body = r.json()
    assert "error" in body
    assert body["error"]["code"] == "UNSUPPORTED_MEDIA"


def test_playground_unauthorised(client):
    r = client.post(
        "/api/v1/playground/runs",
        data={"question": "hi"},
        files=[("files", ("a.png", _png_bytes(), "image/png"))],
    )
    assert r.status_code == 401
    assert "error" in r.json()


def test_playground_cross_project_isolation(client, tmp_path):
    # Register two users with distinct projects
    a = client.post(
        "/api/v1/auth/register",
        json={"email": "pg_a@example.com", "password": "password1", "name": "A"},
    ).json()
    b = client.post(
        "/api/v1/auth/register",
        json={"email": "pg_b@example.com", "password": "password1", "name": "B"},
    ).json()
    key_a, proj_a = a["api_key"], a["project"]
    key_b, proj_b = b["api_key"], b["project"]
    assert proj_a != proj_b

    r = client.post(
        "/api/v1/playground/runs",
        headers={"Authorization": f"Bearer {key_a}", "X-Project": proj_a},
        data={"question": "total?", "mock": "true", "agent_model": "mock:muse-spark-1.3"},
        files=[("files", ("r.png", _png_bytes(), "image/png"))],
    )
    assert r.status_code == 202, r.text
    run_id = r.json()["run_id"]
    # Poll with A's key
    for _ in range(200):
        d = client.get(
            f"/api/v1/playground/runs/{run_id}",
            headers={"Authorization": f"Bearer {key_a}", "X-Project": proj_a},
        )
        assert d.status_code == 200
        if d.json()["status"] in ("completed", "failed"):
            break
        time.sleep(0.05)

    # B cannot see A's run
    denied = client.get(
        f"/api/v1/playground/runs/{run_id}",
        headers={"Authorization": f"Bearer {key_b}", "X-Project": proj_b},
    )
    assert denied.status_code == 404
    # B's key cannot use A's project
    cross = client.get(
        f"/api/v1/playground/runs/{run_id}",
        headers={"Authorization": f"Bearer {key_b}", "X-Project": proj_a},
    )
    assert cross.status_code == 403


def test_playground_rate_limit_429(client, monkeypatch):
    monkeypatch.setenv("EVALVERSE_PLAYGROUND_DAILY", "3")
    # Reset in-memory minute window by using unique project via X-Project
    png = _png_bytes()
    last = None
    for i in range(4):
        last = client.post(
            "/api/v1/playground/runs",
            headers=H("rateproj"),
            data={"question": f"q{i}", "mock": "true", "agent_model": "mock:muse-spark-1.3"},
            files=[("files", ("r.png", png, "image/png"))],
        )
        if last.status_code == 429:
            break
    assert last is not None
    assert last.status_code == 429, last.text
    err = last.json()["error"]
    assert err["code"] == "RATE_LIMITED"
    assert "daily" in err["message"].lower() or "minute" in err["message"].lower()


def test_playground_file_too_large(client, monkeypatch):
    # Bypass sniff by using oversized png-like header + padding — still fails size check first
    huge = b"\x89PNG\r\n\x1a\n" + b"\x00" * (10 * 1024 * 1024 + 1)
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={"question": "x", "mock": "true"},
        files=[("files", ("big.png", huge, "application/octet-stream"))],
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_mock_requires_env(tmp_path, monkeypatch):
    monkeypatch.delenv("EVALVERSE_ALLOW_MOCK", raising=False)
    app = create_app(
        db_path=tmp_path / "m.db",
        media_dir=tmp_path / "media",
        api_key="dev",
        start_workers=False,
    )
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/playground/runs",
            headers=H(),
            data={"question": "x", "mock": "true"},
            files=[("files", ("a.png", _png_bytes(), "image/png"))],
        )
        assert r.status_code == 400
        assert "EVALVERSE_ALLOW_MOCK" in r.json()["error"]["message"]


def _ffmpeg_audio(path: Path, *, fmt: str, duration: float = 0.4) -> bytes:
    import imageio_ffmpeg
    import subprocess

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    args = [
        ff,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"sine=frequency=440:duration={duration}",
    ]
    if fmt == "webm":
        args += ["-c:a", "libopus", "-b:a", "32k", str(path)]
    elif fmt == "ogg":
        args += ["-c:a", "libopus", str(path)]
    else:
        raise ValueError(fmt)
    subprocess.check_call(args)
    return path.read_bytes()


def test_sniff_webm_ogg_audio_and_video(tmp_path):
    webm = _ffmpeg_audio(tmp_path / "a.webm", fmt="webm")
    ogg = _ffmpeg_audio(tmp_path / "a.ogg", fmt="ogg")
    assert sniff_upload(webm) == ("audio", "audio/webm", ".webm")
    assert sniff_upload(ogg) == ("audio", "audio/ogg", ".ogg")

    import imageio_ffmpeg
    import subprocess

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    vpath = tmp_path / "v.webm"
    subprocess.check_call(
        [
            ff,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x48:d=0.4",
            "-c:v",
            "libvpx",
            "-f",
            "webm",
            str(vpath),
        ]
    )
    kind = sniff_upload(vpath.read_bytes())
    assert kind is not None
    assert kind[0] == "video"
    assert kind[1] == "video/webm"


def test_webm_transcode_to_wav16k(tmp_path):
    from evalverse.server.media_convert import transcode_to_wav16k_mono

    webm = _ffmpeg_audio(tmp_path / "voice.webm", fmt="webm", duration=0.5)
    wav, dur = transcode_to_wav16k_mono(webm)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    assert 0.3 < dur < 0.8
    # 16-bit mono 16 kHz
    import wave

    with wave.open(io.BytesIO(wav), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.getframerate() == 16000


def test_playground_accepts_webm_audio(client, tmp_path):
    png = _png_bytes()
    webm = _ffmpeg_audio(tmp_path / "claim.webm", fmt="webm")
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={
            "mode": "cross_check",
            "mock": "true",
            "judge_model": "mock:muse-wonder-1.0",
            "evaluator_ids": "cross_modal_judge",
        },
        files=[
            ("files", ("receipt.png", png, "image/png")),
            ("files", ("claim.webm", webm, "audio/webm")),
        ],
    )
    assert r.status_code == 202, r.text
    detail = _poll(client, r.json()["run_id"], timeout=45.0)
    assert detail["status"] == "completed", detail.get("error")


def test_playground_corrupt_audio_4xx(client):
    # EBML header only — looks like webm/audio-ish but cannot decode
    corrupt = b"\x1a\x45\xdf\xa3" + b"A_OPUS" + b"\x00" * 64
    assert sniff_upload(corrupt) is not None
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={"question": "hi", "mock": "true"},
        files=[
            ("files", ("a.png", _png_bytes(), "image/png")),
            ("files", ("bad.webm", corrupt, "audio/webm")),
        ],
    )
    assert r.status_code == 400, r.text
    err = r.json()["error"]
    assert err["code"] == "CORRUPT_MEDIA"
    assert "message" in err


def test_playground_total_size_limit(client):
    # Each under per-file 10 MiB; three × ~9 MiB exceeds 25 MiB total
    chunk = b"\x89PNG\r\n\x1a\n" + b"\x00" * (9 * 1024 * 1024)
    r = client.post(
        "/api/v1/playground/runs",
        headers=H(),
        data={"question": "x", "mock": "true"},
        files=[
            ("files", ("a.png", chunk, "image/png")),
            ("files", ("b.png", chunk, "image/png")),
            ("files", ("c.png", chunk, "image/png")),
        ],
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
