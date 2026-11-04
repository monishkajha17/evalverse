"""EvalVerse core: model calls, perturbations, and the checks that decide
whether an agent actually *looked* at the image.

Three ideas, all cheap and all programmatic where possible:

1. Evidence check   - the agent must say WHERE it found the answer (a box on the
                      0-1000 grid). We compare it to the known region.
2. Blind test       - rerun the same question with no image. If the agent still
                      gets it right, the image was never needed.
3. Judge audit      - a VLM judge is only trusted if it agrees with ground truth
                      on answers we planted (some right, some wrong).
"""
from __future__ import annotations

import base64
import io
import json
import os
import random
import re
import time

from PIL import Image, ImageChops, ImageFilter

BASE_URL = "https://api.meta.ai/v1"

# --------------------------------------------------------------------------- prompts
AGENT_PROMPT = (
    "You are a visual-reading agent. Answer the question using ONLY what you can see in the attached image.\n"
    "Question: {question}\n\n"
    "Reply with JSON only, no other text:\n"
    '{{"answer": "<your answer>", "box": [x_min, y_min, x_max, y_max], "evidence": "<what you read and where>"}}\n'
    "box is the region of the image that shows the answer, on a normalized 0-1000 grid with (0,0) at the "
    "top-left. If you cannot read the answer, use answer \"unknown\" and box null."
)

JUDGE_PROMPT = (
    "You are auditing an answer about the attached image. Look at the image yourself.\n"
    "Question: {question}\n"
    "Proposed answer: {proposed}\n\n"
    "Is the proposed answer correct according to the image? Reply with JSON only:\n"
    '{{"verdict": "correct" or "incorrect", "reason": "<one sentence>"}}'
)

AUDIO_AGENT_PROMPT = (
    "You are an audio-transcript reading agent. Answer only from the supplied transcript.\n"
    "Question: {question}\n\nTranscript:\n{transcript}\n\n"
    "Reply with JSON only, no other text:\n"
    '{{"answer":"<turn number>", "span_ms":[start,end], "evidence":"<quoted transcript evidence>"}}\n'
    "span_ms must cite the time range of the turn that proves the answer. If the transcript is absent "
    'or insufficient, use answer "unknown" and span_ms null.'
)

AUDIO_JUDGE_PROMPT = (
    "You are auditing an answer against this transcript.\n"
    "Question: {question}\nProposed answer: {proposed}\n\nTranscript:\n{transcript}\n\n"
    'Reply with JSON only: {{"verdict":"correct" or "incorrect","reason":"<one sentence>"}}'
)


def parse_json(text: str) -> dict | None:
    if not text:
        return None
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        out = json.loads(text)
        return out if isinstance(out, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, flags=re.S)
    if m:
        try:
            out = json.loads(m.group(0))
            return out if isinstance(out, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def clean_box(box):
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    try:
        x0, y0, x1, y1 = [float(v) for v in box]
    except (TypeError, ValueError):
        return None
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    clamp = lambda v: max(0.0, min(1000.0, v))  # docs: edge objects can exceed the grid slightly
    x0, y0, x1, y1 = map(clamp, (x0, y0, x1, y1))
    if x1 - x0 < 1 or y1 - y0 < 1:
        return None
    return [round(x0), round(y0), round(x1), round(y1)]


# --------------------------------------------------------------------------- perturbations
def perturb(img: Image.Image, condition: str, seed: int = 0) -> Image.Image:
    img = img.convert("RGB")
    if condition == "clean":
        return img
    if condition == "blur":
        return img.filter(ImageFilter.GaussianBlur(radius=5))
    if condition == "noise":
        random.seed(seed)
        noise = Image.effect_noise(img.size, 70).convert("RGB")
        return ImageChops.add(img, noise, scale=1, offset=-128)
    if condition == "lowres":
        w, h = img.size
        small = img.resize((max(8, int(w * 0.16)), max(8, int(h * 0.16))), Image.BILINEAR)
        return small.resize((w, h), Image.BILINEAR)
    raise ValueError(f"unknown condition {condition}")


def to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# --------------------------------------------------------------------------- checks
def iou(a, b) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    area = lambda r: max(0, r[2] - r[0]) * max(0, r[3] - r[1])
    union = area(a) + area(b) - inter
    return inter / union if union else 0.0


def evidence_ok(truth, pred, margin: float = 0) -> bool:
    """Right place. The agent's region counts as grounded when ANY of these hold:
       - it overlaps the true region (overlap >= 0.25),
       - most of the agent's region lies inside the true region (it boxed the value inside the row),
       - most of the true region lies inside the agent's region (it boxed the whole row),
       - its centre falls inside the true region.
    A region that blankets the image (more than 6x the true area) never counts.
    `margin` expands the TRUE region vertically on the 0-1000 grid before matching
    (about one text line at 25); margin=0 keeps the strict behaviour."""
    if not pred:
        return False
    if margin:
        truth = [
            truth[0],
            max(0.0, truth[1] - margin),
            truth[2],
            min(1000.0, truth[3] + margin),
        ]
    area = lambda r: max(0, r[2] - r[0]) * max(0, r[3] - r[1])
    if area(pred) > 6 * area(truth) or area(truth) == 0 or area(pred) == 0:
        return False
    ix0, iy0 = max(truth[0], pred[0]), max(truth[1], pred[1])
    ix1, iy1 = min(truth[2], pred[2]), min(truth[3], pred[3])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    pred_in_truth = inter / area(pred)
    truth_in_pred = inter / area(truth)
    cx, cy = (pred[0] + pred[2]) / 2, (pred[1] + pred[3]) / 2
    inside = truth[0] <= cx <= truth[2] and truth[1] <= cy <= truth[3]
    return iou(truth, pred) >= 0.25 or pred_in_truth >= 0.6 or truth_in_pred >= 0.7 or inside


def _amount(s):
    """Parse a money-like number, understanding thousands separators.
    '60.000' -> 60000, '1,346,000' -> 1346000, '51.70' -> 51.7, '1.234,56' -> 1234.56"""
    m = re.search(r"\d[\d.,]*", str(s))
    if not m:
        return None
    tok = m.group(0).rstrip(".,")
    if "," in tok and "." in tok:
        dec = "." if tok.rfind(".") > tok.rfind(",") else ","
        thou = "," if dec == "." else "."
        tok = tok.replace(thou, "").replace(dec, ".")
    elif re.fullmatch(r"\d{1,3}([.,]\d{3})+", tok):
        tok = re.sub(r"[.,]", "", tok)
    elif re.fullmatch(r"\d+[.,]\d{1,2}", tok):
        tok = tok.replace(",", ".")
    else:
        tok = re.sub(r"[.,]", "", tok)
    try:
        return float(tok)
    except ValueError:
        return None


def _txt(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def answer_correct(case: dict, pred: str) -> bool:
    if pred is None or _txt(pred) in ("", "unknown"):
        return False
    if case["answer_type"] == "number":
        p, t = _amount(pred), _amount(case["answer"])
        return p is not None and t is not None and abs(p - t) < 0.0051
    return _txt(pred) == _txt(case["answer"])


def attribute(correct: bool, ev_ok: bool, valid: bool, answer=None, box=None) -> str:
    """Where did it go wrong?  The point of the whole tool."""
    if not valid:
        return "invalid_output"
    # Valid JSON that declines to answer and cites no region.
    if box is None and _txt(answer if answer is not None else "") in ("", "unknown"):
        return "abstained"
    if correct and ev_ok:
        return "grounded_correct"
    if correct and not ev_ok:
        return "correct_ungrounded"   # right answer, wrong place: possible guess or shortcut
    if not correct and ev_ok:
        return "misread"              # looked at the right place, read it wrong (perception)
    return "mislocated"               # looked in the wrong place


# --------------------------------------------------------------------------- backends
class LiveBackend:
    """Meta Model API via the OpenAI-compatible Chat Completions endpoint."""

    def __init__(self):
        from openai import OpenAI

        key = os.environ.get("MODEL_API_KEY")
        if not key:
            raise SystemExit("Set MODEL_API_KEY first (Meta Model API dashboard -> API keys).")
        self.client = OpenAI(base_url=BASE_URL, api_key=key, timeout=180)
        self.effort = os.environ.get("EVALVERSE_REASONING_EFFORT")  # optional, e.g. "low"

    @staticmethod
    def _usage_from_response(r) -> dict:
        u = getattr(r, "usage", None)
        if u is None:
            return {"input_tokens": None, "output_tokens": None, "reasoning_tokens": None}
        details = getattr(u, "completion_tokens_details", None)
        reasoning = None
        if details is not None:
            reasoning = getattr(details, "reasoning_tokens", None)
            if reasoning is None and isinstance(details, dict):
                reasoning = details.get("reasoning_tokens")
        if isinstance(u, dict):
            return {
                "input_tokens": u.get("prompt_tokens"),
                "output_tokens": u.get("completion_tokens"),
                "reasoning_tokens": reasoning if details is not None else (
                    (u.get("completion_tokens_details") or {}).get("reasoning_tokens")
                ),
            }
        return {
            "input_tokens": getattr(u, "prompt_tokens", None),
            "output_tokens": getattr(u, "completion_tokens", None),
            "reasoning_tokens": reasoning,
        }

    def _chat(self, model: str, prompt: str, image_png: bytes | None) -> tuple[str, dict]:
        content = [{"type": "text", "text": prompt}]
        if image_png is not None:
            b64 = base64.b64encode(image_png).decode()
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        kwargs = {}
        if self.effort:
            kwargs["extra_body"] = {"reasoning_effort": self.effort}
        last = None
        for attempt in range(4):
            try:
                r = self.client.chat.completions.create(
                    model=model, messages=[{"role": "user", "content": content}], **kwargs
                )
                return (r.choices[0].message.content or ""), self._usage_from_response(r)
            except Exception as e:  # rate limit / transient
                last = e
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"model call failed: {last}")

    def agent(self, model, case, image_png, condition):
        t = time.time()
        raw, usage = self._chat(model, AGENT_PROMPT.format(question=case["question"]), image_png)
        return raw, time.time() - t, usage

    def judge(self, model, case, proposed, image_png):
        raw, _usage = self._chat(model, JUDGE_PROMPT.format(question=case["question"], proposed=proposed), image_png)
        return raw

    def audio_agent(self, model, case, transcript, condition):
        t = time.time()
        raw, usage = self._chat(
            model, AUDIO_AGENT_PROMPT.format(question=case["question"], transcript=transcript), None
        )
        return raw, time.time() - t, usage

    def audio_judge(self, model, case, proposed, transcript):
        raw, _usage = self._chat(
            model,
            AUDIO_JUDGE_PROMPT.format(question=case["question"], proposed=proposed, transcript=transcript),
            None,
        )
        return raw


class MockBackend:
    """Offline stand-in used to test the pipeline end to end without an API key.
    Behaviour is deliberately imperfect so every code path gets exercised."""

    def __init__(self, seed=0):
        self.rng = random.Random(seed)

    def agent(self, model, case, image_png, condition):
        r = self.rng
        usage = {"input_tokens": 900, "output_tokens": 160}
        if image_png is None:  # blind
            ans = "unknown" if r.random() < 0.7 else case["distractor"]
            return json.dumps({"answer": ans, "box": None, "evidence": "no image"}), 0.01, usage
        p_ok = {"clean": 0.95, "blur": 0.7, "noise": 0.6, "lowres": 0.4}[condition]
        if "1.1" in model:
            p_ok -= 0.15
        ok = r.random() < p_ok
        t = case["truth_box"]
        if r.random() < p_ok:
            box = [t[0] + r.randint(-15, 15), t[1] + r.randint(-15, 15), t[2] + r.randint(-15, 15), t[3] + r.randint(-15, 15)]
        else:
            box = [r.randint(0, 300), r.randint(0, 300), r.randint(400, 700), r.randint(400, 700)]
        ans = case["answer"] if ok else case["distractor"]
        return json.dumps({"answer": ans, "box": box, "evidence": "mock"}), 0.01, usage

    def judge(self, model, case, proposed, image_png):
        r = self.rng
        truth = answer_correct(case, proposed)
        flip = r.random() < 0.1
        verdict = "correct" if (truth != flip) else "incorrect"
        return json.dumps({"verdict": verdict, "reason": "mock"})

    def audio_agent(self, model, case, transcript, condition):
        usage = {"input_tokens": 900, "output_tokens": 160}
        if not transcript:
            return json.dumps({"answer": "unknown", "span_ms": None, "evidence": "no transcript"}), 0.01, usage
        turn = next((t for t in case["turns"] if t["index"] == int(case["answer"])), case["turns"][0])
        if self.rng.random() < (0.92 if condition == "clean" else 0.7):
            answer, span = case["answer"], [turn["start_ms"], turn["end_ms"]]
        else:
            wrong = next(t for t in case["turns"] if str(t["index"]) != case["answer"])
            answer, span = str(wrong["index"]), [wrong["start_ms"], wrong["end_ms"]]
        return json.dumps({"answer": answer, "span_ms": span, "evidence": "mock transcript"}), 0.01, usage

    def audio_judge(self, model, case, proposed, transcript):
        truth = answer_correct(case, proposed)
        return json.dumps({"verdict": "correct" if truth else "incorrect", "reason": "mock"})
