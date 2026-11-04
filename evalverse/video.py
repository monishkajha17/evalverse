"""Video frame sampling and perturbation helpers for EvalVerse."""
from __future__ import annotations

import hashlib
import io
from pathlib import Path
from typing import Any

from PIL import Image

from . import core

VIDEO_AGENT_PROMPT = (
    "You are a video-reading agent. Answer the question using ONLY what you can see "
    "in the attached video frames. Each frame is preceded by its timestamp.\n"
    "Question: {question}\n\n"
    "Reply with JSON only, no other text:\n"
    '{{"answer": "<your answer>", "span_ms": [start_ms, end_ms], '
    '"box": [x_min, y_min, x_max, y_max] or null, '
    '"evidence": "<what you saw and in which frame>"}}\n'
    "span_ms must be in MILLISECONDS copied from the frame timestamps you rely on "
    "(headers look like 'Frame at t=4.0 s:'). "
    "box is on a normalized 0-1000 grid with (0,0) at the top-left. "
    "If the information is not visible in the frames, use answer \"unknown\", "
    "span_ms null, and box null."
)

BLIND_GUESS_LINE = (
    "Even if you cannot see any frames, give your single best guess of the answer."
)


def video_agent_prompt(question: str, condition: str) -> str:
    prompt = VIDEO_AGENT_PROMPT.format(question=question)
    if condition == "blind_guess":
        prompt += "\n" + BLIND_GUESS_LINE
    return prompt


def sample_frames(path: str | Path, every_s: float) -> list[tuple[int, Image.Image]]:
    """Return [(t_ms, PIL image), ...] sampled every `every_s` seconds from the video."""
    import imageio.v2 as imageio

    path = Path(path)
    reader = imageio.get_reader(str(path))
    meta = reader.get_meta_data()
    fps = float(meta.get("fps") or 10.0)
    step = max(1, int(round(every_s * fps)))
    out: list[tuple[int, Image.Image]] = []
    try:
        for i, frame in enumerate(reader):
            if i % step != 0:
                continue
            t_ms = int(round(1000.0 * i / fps))
            out.append((t_ms, Image.fromarray(frame).convert("RGB")))
    finally:
        reader.close()
    return out


def perturb_video(
    frames: list[tuple[int, Image.Image]],
    condition: str,
    seed: int = 0,
) -> list[tuple[int, Image.Image]]:
    """Apply per-frame image ops. clean/sparse leave frames unchanged (sampling is upstream).

    blur reuses `core.perturb`. noise mirrors that op with a seeded numpy RNG so
    repeated calls are deterministic (Pillow's effect_noise is not seedable).
    """
    if condition in ("clean", "sparse", "blind", "blind_guess"):
        return list(frames)
    if condition == "blur":
        return [(t_ms, core.perturb(img, "blur", seed=seed + i)) for i, (t_ms, img) in enumerate(frames)]
    if condition == "noise":
        import numpy as np

        out = []
        for i, (t_ms, img) in enumerate(frames):
            rng = np.random.default_rng(seed + i)
            arr = np.asarray(img.convert("RGB"), dtype=np.int16)
            noise = rng.integers(-70, 71, size=arr.shape, dtype=np.int16)
            out.append((t_ms, Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8))))
        return out
    raise ValueError(f"unknown video condition {condition}")


def frame_set_hash(frames: list[tuple[int, Image.Image]]) -> str:
    """Content hash of a frame set for caching."""
    h = hashlib.sha256()
    for t_ms, img in frames:
        h.update(str(t_ms).encode())
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        h.update(buf.getvalue())
    return h.hexdigest()


def frames_to_png(frames: list[tuple[int, Image.Image]]) -> list[tuple[str, bytes]]:
    """Captioned PNG payloads for the multi-image backend."""
    out = []
    for t_ms, img in frames:
        caption = f"Frame at t={t_ms / 1000.0:.1f} s:"
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append((caption, buf.getvalue()))
    return out


def sampling_interval_ms(condition: str) -> int:
    if condition == "sparse":
        return 5000
    return 2000


def every_s_for_condition(condition: str) -> float:
    return 5.0 if condition == "sparse" else 2.0


def video_span_match(
    truth_span_ms,
    claimed,
    *,
    sampling_interval_ms: int = 2000,
) -> bool:
    """Overlap >= 50% of truth, or midpoint inside truth, with ± one sample interval."""
    if (
        not isinstance(truth_span_ms, (list, tuple))
        or not isinstance(claimed, (list, tuple))
        or len(truth_span_ms) != 2
        or len(claimed) != 2
    ):
        return False
    try:
        t0, t1 = sorted(float(x) for x in truth_span_ms)
        c0, c1 = sorted(float(x) for x in claimed)
    except (TypeError, ValueError):
        return False
    if t1 <= t0:
        return False
    tol = float(sampling_interval_ms)
    t0e, t1e = t0 - tol, t1 + tol
    overlap = max(0.0, min(t1e, c1) - max(t0e, c0))
    # Compare overlap to the original (unexpanded) truth length.
    midpoint = (c0 + c1) / 2
    return overlap / (t1 - t0) >= 0.5 or t0e <= midpoint <= t1e


def _norm_token(s: Any) -> str:
    return "".join(ch for ch in str(s).upper() if ch.isalnum())


def video_answer_correct(case: dict, pred) -> bool:
    if pred is None:
        return False
    atype = case.get("answer_type")
    truth = case.get("answer")
    if atype == "seconds":
        try:
            p = float(str(pred).strip().rstrip("sS"))
            t = float(truth)
        except (TypeError, ValueError):
            return False
        tol = float(case.get("tolerance_s") or 1.0)
        return abs(p - t) <= tol
    # TAX/TOTAL or item name
    return _norm_token(pred) == _norm_token(truth)


def video_label(case: dict, run: dict, *, sampling_interval_ms: int = 2000) -> str:
    if run.get("error") or run.get("label") == "invalid_output":
        return "invalid_output"
    answer = run.get("answer")
    span = run.get("span_ms")
    tok = _norm_token(answer if answer is not None else "")
    if tok in ("", "UNKNOWN") and span is None:
        return "abstained"
    # Also treat explicit unknown
    if str(answer).strip().lower() == "unknown" and span is None:
        return "abstained"
    correct = bool(run.get("correct"))
    span_ok = video_span_match(
        case.get("truth_span_ms"), span, sampling_interval_ms=sampling_interval_ms
    )
    if correct and span_ok:
        return "grounded_correct"
    if correct and not span_ok:
        return "correct_ungrounded"
    if not correct and span_ok:
        return "misread"
    return "mistimed"
