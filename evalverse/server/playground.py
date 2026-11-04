"""Try-it playground: async multimodal runs with rate limits and content sniffing."""

from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from evalverse import audio as audio_mod
from evalverse import core
from evalverse import video as video_mod
from evalverse.providers.registry import get_provider, resolve_model_ref
from evalverse.server.schemas import MediaAttach, SpanIn, TraceCreate
from evalverse.server.sniff import media_duration_s, sniff_upload

log = logging.getLogger("evalverse.server.playground")

MAX_FILES = 4
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_VIDEO_S = 30.0
MAX_AUDIO_S = 120.0
MAX_QUESTION = 2000
DEFAULT_AGENT_MODEL = "muse-spark-1.3"
DEFAULT_JUDGE_MODEL = "muse-wonder-1.0"
DEFAULT_EVALUATORS = ["claim_grounding"]
ALLOWED_CONDITIONS = ("clean", "blur", "noise")
RATE_PER_MINUTE = 10
VIDEO_EVERY_S = 2.0
VIDEO_MAX_FRAMES = 12

_RATE_LOCK = threading.Lock()
_RATE_HITS: dict[str, list[float]] = {}  # project -> timestamps (minute window)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dumps(obj: Any) -> str | None:
    if obj is None:
        return None
    return json.dumps(obj)


def _loads(raw: str | None, default: Any = None) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def _err(status: int, code: str, message: str, details: list | None = None) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"code": code, "message": message, "details": details or []},
    )


def _daily_limit() -> int:
    try:
        return int(os.environ.get("EVALVERSE_PLAYGROUND_DAILY", "50"))
    except ValueError:
        return 50


def _allow_mock() -> bool:
    return os.environ.get("EVALVERSE_ALLOW_MOCK", "").lower() in ("1", "true", "yes", "on")


def _safe_filename(name: str | None) -> str:
    base = Path(name or "upload").name  # strip directories
    base = re.sub(r"[^\w.\-]+", "_", base)[:80]
    return base or "upload"


def _to_mono16k_wav(data: bytes) -> tuple[bytes, float]:
    """Decode any supported audio to 16 kHz mono WAV; return (wav_bytes, duration_s)."""
    import numpy as np
    import soundfile as sf

    samples, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    x = np.asarray(samples, dtype=np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    target_sr = 16000
    if int(sr) != target_sr and len(x) > 0:
        n_out = max(1, int(round(len(x) * target_sr / float(sr))))
        t_in = np.linspace(0.0, 1.0, num=len(x), endpoint=False)
        t_out = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
        x = np.interp(t_out, t_in, x)
    x = x.astype(np.float32)
    dur = float(len(x)) / float(target_sr) if len(x) else 0.0
    return audio_mod.wav_bytes(x, target_sr), dur


def _parse_answer_text(raw: str) -> str:
    if not raw:
        return ""
    text = raw.strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            for k in ("answer", "text", "total", "response"):
                if obj.get(k) is not None:
                    return str(obj[k])
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict) and obj.get("answer") is not None:
                return str(obj["answer"])
        except Exception:
            pass
    return text


class PlaygroundMixin:
    """Mixin for Service — playground run CRUD + async execution."""

    def _check_playground_rate(self, project: str) -> None:
        now = time.time()
        with _RATE_LOCK:
            hits = [t for t in _RATE_HITS.get(project, []) if now - t < 60.0]
            if len(hits) >= RATE_PER_MINUTE:
                raise _err(
                    429,
                    "RATE_LIMITED",
                    f"Playground rate limit exceeded: {RATE_PER_MINUTE} runs per minute per project.",
                )
            hits.append(now)
            _RATE_HITS[project] = hits

        # Daily limit from DB (compare by ISO date prefix on created_at)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        rows = self.db.fetchall(
            "SELECT created_at FROM playground_runs WHERE project=? AND created_at LIKE ?",
            (project, f"{today}%"),
        )
        limit = _daily_limit()
        if len(rows) >= limit:
            raise _err(
                429,
                "RATE_LIMITED",
                f"Playground daily limit exceeded: {limit} runs per day per project "
                f"(EVALVERSE_PLAYGROUND_DAILY).",
            )

    async def create_playground_run(
        self,
        project: str,
        *,
        files: list[UploadFile],
        question: str,
        agent_model: str | None = None,
        judge_model: str | None = None,
        evaluator_ids: list[str] | None = None,
        conditions: list[str] | None = None,
        mock: bool = False,
    ) -> dict[str, Any]:
        self.ensure_project(project)
        q = (question or "").strip()
        if not q or len(q) > MAX_QUESTION:
            raise _err(
                400,
                "VALIDATION_ERROR",
                f"question must be 1–{MAX_QUESTION} characters.",
                [{"field": "question"}],
            )
        if not files:
            raise _err(400, "VALIDATION_ERROR", "At least one file is required.", [{"field": "files"}])
        if len(files) > MAX_FILES:
            raise _err(
                400,
                "VALIDATION_ERROR",
                f"At most {MAX_FILES} files allowed.",
                [{"field": "files"}],
            )

        if mock and not _allow_mock():
            raise _err(
                400,
                "VALIDATION_ERROR",
                "mock=true requires EVALVERSE_ALLOW_MOCK to be set.",
                [{"field": "mock"}],
            )

        conds = list(conditions or [])
        for c in conds:
            if c not in ALLOWED_CONDITIONS:
                raise _err(
                    400,
                    "VALIDATION_ERROR",
                    f"Invalid condition {c!r}; allowed: {list(ALLOWED_CONDITIONS)}",
                    [{"field": "conditions"}],
                )

        self._check_playground_rate(project)

        file_blobs: list[dict[str, Any]] = []
        total = 0
        for uf in files:
            data = await uf.read()
            total += len(data)
            if len(data) > MAX_FILE_BYTES:
                raise _err(
                    400,
                    "VALIDATION_ERROR",
                    f"File exceeds {MAX_FILE_BYTES} byte limit.",
                    [{"field": "files", "reason": "too large"}],
                )
            if total > MAX_TOTAL_BYTES:
                raise _err(
                    400,
                    "VALIDATION_ERROR",
                    f"Total upload exceeds {MAX_TOTAL_BYTES} byte limit.",
                    [{"field": "files", "reason": "total too large"}],
                )
            kind = sniff_upload(data)
            if kind is None:
                raise _err(
                    400,
                    "UNSUPPORTED_MEDIA",
                    "Unsupported or disallowed content type (sniffed from bytes).",
                    [{"field": "files", "filename": _safe_filename(uf.filename)}],
                )
            modality, mime, ext = kind
            dur = None
            if modality in ("audio", "video"):
                dur = media_duration_s(data, modality)
                if dur is not None:
                    if modality == "video" and dur > MAX_VIDEO_S:
                        raise _err(
                            400,
                            "VALIDATION_ERROR",
                            f"Video longer than {MAX_VIDEO_S:.0f}s is not allowed.",
                            [{"field": "files", "reason": "video too long"}],
                        )
                    if modality == "audio" and dur > MAX_AUDIO_S:
                        raise _err(
                            400,
                            "VALIDATION_ERROR",
                            f"Audio longer than {MAX_AUDIO_S:.0f}s is not allowed.",
                            [{"field": "files", "reason": "audio too long"}],
                        )
            # Register immediately under content hash (no client path stored).
            media = self.register_media_bytes(
                project,
                data,
                modality=modality,
                filename=f"upload{ext}",
                mime=mime,
            )
            file_blobs.append(
                {
                    "media_id": media.id,
                    "modality": modality,
                    "mime": mime,
                    "size": len(data),
                    "sha256": media.sha256,
                    "duration_s": dur,
                    "path": media.path,  # server-local only
                }
            )

        # conditions only apply to image-only runs
        modalities = {f["modality"] for f in file_blobs}
        if conds and modalities != {"image"}:
            raise _err(
                400,
                "VALIDATION_ERROR",
                "conditions[] are only supported for image uploads.",
                [{"field": "conditions"}],
            )
        if not conds and modalities == {"image"}:
            conds = ["clean"]

        eids = list(evaluator_ids) if evaluator_ids else list(DEFAULT_EVALUATORS)
        if not eids:
            eids = list(DEFAULT_EVALUATORS)

        run_id = uuid.uuid4().hex
        session_id = f"playground:{run_id}"
        created = _now()
        self.db.execute(
            """INSERT INTO playground_runs
               (id, project, session_id, status, question, agent_model, judge_model,
                evaluator_ids_json, conditions_json, mock, files_meta_json,
                answer_json, trace_ids_json, eval_run_id, error_json, created_at)
               VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)""",
            (
                run_id,
                project,
                session_id,
                q,
                agent_model or DEFAULT_AGENT_MODEL,
                judge_model or DEFAULT_JUDGE_MODEL,
                _dumps(eids),
                _dumps(conds),
                1 if mock else 0,
                _dumps(file_blobs),
                created,
            ),
        )
        log.info(
            "playground run created id=%s project=%s files=%s mock=%s",
            run_id,
            project,
            len(file_blobs),
            mock,
        )
        if hasattr(self, "worker") and self.worker:
            self.worker.start()
        return {
            "run_id": run_id,
            "session_id": session_id,
            "trace_ids": [],
            "status_url": f"/api/v1/playground/runs/{run_id}",
            "status": "pending",
        }

    def get_playground_run(self, project: str, run_id: str) -> dict[str, Any]:
        row = self.db.fetchone(
            "SELECT * FROM playground_runs WHERE id=? AND project=?", (run_id, project)
        )
        if row is None:
            raise _err(404, "NOT_FOUND", "Playground run not found.")
        trace_ids = _loads(row["trace_ids_json"], []) or []
        traces = []
        for tid in trace_ids:
            try:
                tr = self.get_trace(project, tid)
                traces.append(tr.model_dump() if hasattr(tr, "model_dump") else dict(tr))
            except Exception:
                continue
        results = []
        if row["eval_run_id"]:
            try:
                ev = self.get_evaluation(project, row["eval_run_id"])
                results = ev.get("results") or []
            except Exception:
                results = []
        answers = _loads(row["answer_json"], {}) or {}
        return {
            "id": row["id"],
            "project": row["project"],
            "session_id": row["session_id"],
            "status": row["status"],
            "question": row["question"],
            "agent_model": row["agent_model"],
            "judge_model": row["judge_model"],
            "evaluator_ids": _loads(row["evaluator_ids_json"], []) or [],
            "conditions": _loads(row["conditions_json"], []) or [],
            "mock": bool(row["mock"]),
            "trace_ids": trace_ids,
            "traces": traces,
            "results": results,
            "answer": answers.get("primary") or answers.get("answer"),
            "answers": answers,
            "eval_run_id": row["eval_run_id"],
            "error": _loads(row["error_json"]),
            "created_at": row["created_at"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "status_url": f"/api/v1/playground/runs/{run_id}",
        }

    def claim_next_playground_run(self) -> dict | None:
        with self.db.transaction() as conn:
            row = conn.execute(
                """SELECT * FROM playground_runs WHERE status='pending'
                   ORDER BY created_at ASC LIMIT 1"""
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE playground_runs SET status='running', started_at=? WHERE id=?",
                (_now(), row["id"]),
            )
            return dict(row)

    def execute_playground_run(self, row: dict) -> None:
        run_id = row["id"]
        project = row["project"]
        try:
            self._execute_playground_run_inner(row)
        except Exception as exc:  # noqa: BLE001
            log.exception("playground run %s failed: %s", run_id, exc)
            self.db.execute(
                """UPDATE playground_runs SET status='failed', ended_at=?, error_json=?
                   WHERE id=?""",
                (
                    _now(),
                    _dumps({"code": "EXECUTION_ERROR", "message": str(exc)[:500]}),
                    run_id,
                ),
            )

    def _execute_playground_run_inner(self, row: dict) -> None:
        run_id = row["id"]
        project = row["project"]
        session_id = row["session_id"]
        question = row["question"]
        agent_model = row["agent_model"] or DEFAULT_AGENT_MODEL
        judge_model = row["judge_model"] or DEFAULT_JUDGE_MODEL
        eids = _loads(row["evaluator_ids_json"], DEFAULT_EVALUATORS) or list(DEFAULT_EVALUATORS)
        conds = _loads(row["conditions_json"], ["clean"]) or ["clean"]
        use_mock = bool(row["mock"]) and _allow_mock()
        files_meta = _loads(row["files_meta_json"], []) or []

        # Resolve provider
        if use_mock:
            provider_name, model_id = "mock", agent_model.split(":")[-1]
        else:
            try:
                provider_name, model_id = resolve_model_ref(agent_model)
            except Exception:
                provider_name, model_id = "meta", agent_model
        provider = get_provider(provider_name)

        modalities = {f.get("modality") for f in files_meta}
        trace_ids: list[str] = []
        answers: dict[str, Any] = {}

        if modalities == {"image"}:
            for cond in conds:
                tid, ans = self._run_image_variant(
                    project,
                    session_id=session_id,
                    run_id=run_id,
                    question=question,
                    files_meta=files_meta,
                    condition=cond,
                    provider=provider,
                    model_id=model_id,
                    use_mock=use_mock,
                )
                trace_ids.append(tid)
                answers[cond] = ans
            answers["primary"] = answers.get("clean") or next(iter(answers.values()), "")
        elif "audio" in modalities:
            tid, ans = self._run_audio(
                project,
                session_id=session_id,
                run_id=run_id,
                question=question,
                files_meta=files_meta,
                provider=provider,
                model_id=model_id,
                use_mock=use_mock,
            )
            trace_ids.append(tid)
            answers["primary"] = ans
        elif "video" in modalities:
            tid, ans = self._run_video(
                project,
                session_id=session_id,
                run_id=run_id,
                question=question,
                files_meta=files_meta,
                provider=provider,
                model_id=model_id,
                use_mock=use_mock,
            )
            trace_ids.append(tid)
            answers["primary"] = ans
        else:
            # Mixed: prefer first modality
            raise RuntimeError(f"unsupported modality mix: {modalities}")

        # Persist trace ids + answer before evaluations
        self.db.execute(
            """UPDATE playground_runs SET trace_ids_json=?, answer_json=? WHERE id=?""",
            (_dumps(trace_ids), _dumps(answers), run_id),
        )

        # Filter evaluators: skip deterministic reference-based with reason via create_evaluation
        # (run_builtin already skips needs_reference without expectation).
        # Prefer claim_grounding / rubrics; still enqueue requested ids.
        filtered = []
        for eid in eids:
            try:
                ev = self.get_evaluator(project, eid)
            except Exception:
                continue
            # Skip deterministic needs_reference builtins (no expectation in playground)
            if (
                ev.get("source") == "builtin"
                and ev.get("needs_reference")
                and ev.get("category") not in ("model_judge", "rubric", "judge")
            ):
                # Still enqueue — they skip with "no expectation"; user asked for that reason.
                pass
            filtered.append(eid)
        if not filtered:
            filtered = ["claim_grounding"]

        # Set judge model for claim_grounding
        prev_judge = getattr(self, "judge_model", None)
        self.judge_model = judge_model
        try:
            eval_out = self.create_evaluation(
                project,
                trace_ids=trace_ids,
                filter=None,
                evaluator_ids=filtered,
            )
            eval_run_id = eval_out["id"]
        finally:
            if prev_judge is None and hasattr(self, "judge_model"):
                try:
                    delattr(self, "judge_model")
                except Exception:
                    self.judge_model = None
            else:
                self.judge_model = prev_judge

        # Wait briefly for eval jobs to finish (worker is same pool)
        deadline = time.time() + 50.0
        while time.time() < deadline:
            detail = self.get_evaluation(project, eval_run_id)
            if detail.get("status") in ("completed", "partial", "failed"):
                break
            # Also process locally if no background worker claimed yet
            job = self.claim_next_job()
            if job:
                self.execute_job(job, timeout_s=60.0)
            else:
                time.sleep(0.05)

        self.db.execute(
            """UPDATE playground_runs
               SET status='completed', ended_at=?, eval_run_id=?, answer_json=?, trace_ids_json=?
               WHERE id=?""",
            (_now(), eval_run_id, _dumps(answers), _dumps(trace_ids), run_id),
        )
        log.info("playground run completed id=%s traces=%s", run_id, len(trace_ids))

    # ------------------------------------------------------------------ variants

    def _call_model(
        self,
        provider,
        model_id: str,
        prompt: str,
        *,
        images: list[bytes] | None = None,
        use_mock: bool = False,
    ) -> tuple[str, dict, float]:
        t0 = time.perf_counter()
        blocks: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for img in images or []:
            blocks.append({"type": "image", "bytes": img})
        if use_mock or getattr(provider, "name", "") == "mock":
            # Prefer a readable answer for playground
            text, usage = provider.generate(model_id, blocks)
            # Mock often returns JSON — keep as-is; parse later
        else:
            # Multi-image via LiveBackend when >1 frame
            if images and len(images) > 1 and hasattr(provider, "name") and provider.name == "meta":
                from evalverse.core import LiveBackend

                framed = [(f"Frame {i+1}:", img) for i, img in enumerate(images)]
                text, usage = LiveBackend().chat_images(model_id, prompt, framed)
            else:
                text, usage = provider.generate(model_id, blocks)
        latency = time.perf_counter() - t0
        return text or "", usage or {}, latency

    def _run_image_variant(
        self,
        project: str,
        *,
        session_id: str,
        run_id: str,
        question: str,
        files_meta: list[dict],
        condition: str,
        provider,
        model_id: str,
        use_mock: bool,
    ) -> tuple[str, str]:
        from PIL import Image

        primary = next(f for f in files_meta if f["modality"] == "image")
        raw = Path(primary["path"]).read_bytes()
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        perturbed = core.perturb(img, condition, seed=hash(run_id) % 10_000)
        png = core.to_png_bytes(perturbed)
        media = self.register_media_bytes(
            project,
            png,
            modality="image",
            filename=f"{condition}.png",
            mime="image/png",
            parent_id=primary["media_id"],
            transformation=condition,
        )

        prompt = (
            f"Answer the question about the attached image.\n"
            f"Question: {question}\n"
            f'Reply with JSON: {{"answer": "...", "evidence": "..."}}'
        )
        raw_reply, usage, latency = self._call_model(
            provider, model_id, prompt, images=[png], use_mock=use_mock
        )
        answer = _parse_answer_text(raw_reply)

        tid = f"playground|{run_id}|{condition}|{uuid.uuid4().hex[:8]}"
        spans = [
            SpanIn(
                id="s1",
                name="attach_image",
                type="media",
                status="completed",
                attributes={"media_id": media.id, "transformation": condition},
            ),
            SpanIn(
                id="s2",
                name="model_call",
                type="model",
                status="completed",
                model=model_id,
                parent_ids=["s1"],
                latency_ms=latency * 1000.0,
                usage=usage if isinstance(usage, dict) else None,
                input={"prompt": prompt},
                output={"raw": raw_reply, "answer": answer},
            ),
            SpanIn(
                id="s3",
                name="evaluation",
                type="evaluation",
                status="completed",
                parent_ids=["s2"],
            ),
        ]
        self.create_trace(
            project,
            TraceCreate(
                id=tid,
                session_id=session_id,
                name=f"playground:{condition}",
                agent=model_id,
                status="completed",
                input={"question": question},
                output={"answer": answer, "raw": raw_reply},
                metadata={
                    "playground_run_id": run_id,
                    "variant": condition,
                    "judge_model": None,
                },
                tags=["playground", condition],
                source="sdk",
                spans=spans,
                media=[MediaAttach(media_id=media.id, role="input", span_id="s1")],
            ),
        )
        return tid, answer

    def _run_audio(
        self,
        project: str,
        *,
        session_id: str,
        run_id: str,
        question: str,
        files_meta: list[dict],
        provider,
        model_id: str,
        use_mock: bool,
    ) -> tuple[str, str]:
        primary = next(f for f in files_meta if f["modality"] == "audio")
        raw = Path(primary["path"]).read_bytes()
        wav, dur = _to_mono16k_wav(raw)
        wav_media = self.register_media_bytes(
            project,
            wav,
            modality="audio",
            filename="audio_16k.wav",
            mime="audio/wav",
            parent_id=primary["media_id"],
            transformation="resample_16k_mono",
        )

        # Transcribe
        asr_provider_name = "mock" if use_mock else "meta"
        asr_prov = get_provider(asr_provider_name)
        t0 = time.perf_counter()
        asr_out = asr_prov.transcribe(wav, model="muse-voice-transcribe-1.0")
        asr_latency = time.perf_counter() - t0
        transcript = str((asr_out or {}).get("text") or "")

        prompt = (
            f"Answer the question using the transcript.\n"
            f"Question: {question}\n"
            f"Transcript:\n{transcript}\n"
            f'Reply with JSON: {{"answer": "..."}}'
        )
        raw_reply, usage, latency = self._call_model(
            provider, model_id, prompt, images=None, use_mock=use_mock
        )
        answer = _parse_answer_text(raw_reply)

        tid = f"playground|{run_id}|audio|{uuid.uuid4().hex[:8]}"
        spans = [
            SpanIn(
                id="s1",
                name="attach_audio",
                type="media",
                status="completed",
                attributes={"media_id": wav_media.id},
            ),
            SpanIn(
                id="s2",
                name="transcribe",
                type="media",
                status="completed",
                parent_ids=["s1"],
                latency_ms=asr_latency * 1000.0,
                attributes={
                    "text": transcript,
                    "turn": 1,
                    "start_ms": 0,
                    "end_ms": int(dur * 1000),
                },
                output={"transcript": transcript},
            ),
            SpanIn(
                id="s3",
                name="model_call",
                type="model",
                status="completed",
                model=model_id,
                parent_ids=["s2"],
                latency_ms=latency * 1000.0,
                usage=usage if isinstance(usage, dict) else None,
                input={"prompt": prompt},
                output={"raw": raw_reply, "answer": answer},
            ),
            SpanIn(
                id="s4",
                name="evaluation",
                type="evaluation",
                status="completed",
                parent_ids=["s3"],
            ),
        ]
        self.create_trace(
            project,
            TraceCreate(
                id=tid,
                session_id=session_id,
                name="playground:audio",
                agent=model_id,
                status="completed",
                input={"question": question, "transcript": transcript},
                output={"answer": answer, "raw": raw_reply},
                metadata={"playground_run_id": run_id, "modality": "audio"},
                tags=["playground", "audio"],
                source="sdk",
                spans=spans,
                media=[MediaAttach(media_id=wav_media.id, role="input", span_id="s1")],
            ),
        )
        # Temporal events: ASR turn
        self.add_events(
            project,
            tid,
            [
                {
                    "client_id": "asr:turn:1",
                    "span_id": "s2",
                    "media_id": wav_media.id,
                    "source": "asr",
                    "label": transcript,
                    "start_ms": 0,
                    "end_ms": dur * 1000.0,
                    "time_base": "media",
                    "payload": {"turn": 1},
                }
            ],
        )
        return tid, answer

    def _run_video(
        self,
        project: str,
        *,
        session_id: str,
        run_id: str,
        question: str,
        files_meta: list[dict],
        provider,
        model_id: str,
        use_mock: bool,
    ) -> tuple[str, str]:
        primary = next(f for f in files_meta if f["modality"] == "video")
        path = Path(primary["path"])
        frames = video_mod.sample_frames(path, VIDEO_EVERY_S)[:VIDEO_MAX_FRAMES]
        framed = video_mod.frames_to_png(frames)

        prompt = (
            f"Answer the question about the attached video frames. "
            f"Each frame is preceded by its timestamp.\n"
            f"Question: {question}\n"
            f'Reply with JSON: {{"answer": "...", "span_ms": [start_ms, end_ms]}}'
        )
        images = [png for _, png in framed]
        raw_reply, usage, latency = self._call_model(
            provider, model_id, prompt, images=images, use_mock=use_mock
        )
        answer = _parse_answer_text(raw_reply)

        tid = f"playground|{run_id}|video|{uuid.uuid4().hex[:8]}"
        s1 = SpanIn(
            id="s1",
            name="attach_video",
            type="media",
            status="completed",
            attributes={"media_id": primary["media_id"]},
        )
        frame_spans = []
        frame_ids = []
        for i, (t_ms, _) in enumerate(frames, start=1):
            sid = f"s2_{i}"
            frame_ids.append(sid)
            frame_spans.append(
                SpanIn(
                    id=sid,
                    name=f"sample frame {i}",
                    type="media",
                    status="completed",
                    parent_ids=["s1"],
                    attributes={"t_ms": t_ms, "frame_index": i},
                )
            )
        model_parents = frame_ids or ["s1"]
        spans = [
            s1,
            *frame_spans,
            SpanIn(
                id="s3",
                name="model_call",
                type="model",
                status="completed",
                model=model_id,
                parent_ids=model_parents,
                latency_ms=latency * 1000.0,
                usage=usage if isinstance(usage, dict) else None,
                input={"prompt": prompt},
                output={"raw": raw_reply, "answer": answer},
            ),
            SpanIn(
                id="s4",
                name="evaluation",
                type="evaluation",
                status="completed",
                parent_ids=["s3"],
            ),
        ]
        self.create_trace(
            project,
            TraceCreate(
                id=tid,
                session_id=session_id,
                name="playground:video",
                agent=model_id,
                status="completed",
                input={"question": question},
                output={"answer": answer, "raw": raw_reply},
                metadata={"playground_run_id": run_id, "modality": "video"},
                tags=["playground", "video"],
                source="sdk",
                spans=spans,
                media=[MediaAttach(media_id=primary["media_id"], role="input", span_id="s1")],
            ),
        )
        events = []
        for i, (t_ms, _) in enumerate(frames, start=1):
            events.append(
                {
                    "client_id": f"sampled_frame:{t_ms}",
                    "span_id": f"s2_{i}",
                    "media_id": primary["media_id"],
                    "source": "sampled_frame",
                    "label": f"frame@{t_ms}",
                    "start_ms": float(t_ms),
                    "end_ms": float(t_ms),
                    "time_base": "media",
                    "payload": {"t_ms": t_ms, "frame_index": i},
                }
            )
        if events:
            self.add_events(project, tid, events)
        return tid, answer
