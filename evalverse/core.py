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

AGENT_TOOL_PROMPT = (
    "You are a visual-reading agent with tools. Read the receipt image and answer the question.\n"
    "Question: {question}\n\n"
    "Reply with JSON only, no other text:\n"
    '{{"answer": "<your answer>", "box": [x_min, y_min, x_max, y_max], "evidence": "<what you read and where>", '
    '"tool_calls": [{{"name": "check_duplicate", "arguments": {{"amount": "<value>"}}}}, '
    '{{"name": "log_expense", "arguments": {{"amount": "<value>", "currency": "IDR", "category": "meals"}}}}]}}\n'
    "box is the region of the image that shows the answer, on a normalized 0-1000 grid with (0,0) at the "
    "top-left.\n"
    "Only call log_expense if you can actually read the value from the image. "
    "If you cannot read it, set answer to \"unknown\", box to null, and \"tool_calls\": []. "
    "When you do call tools, call check_duplicate before log_expense. "
    "Use currency \"IDR\" and category \"meals\" for log_expense."
)

JUDGE_PROMPT = (
    "You are auditing an answer about the attached image. Look at the image yourself.\n"
    "Question: {question}\n"
    "Proposed answer: {proposed}\n\n"
    "Is the proposed answer correct according to the image? Reply with JSON only:\n"
    '{{"verdict": "correct" or "incorrect", "reason": "<one sentence>"}}'
)

# Same audit task without media; deliberately does not say the image is missing.
JUDGE_PROMPT_NO_MEDIA = (
    "You are auditing an answer.\n"
    "Question: {question}\n"
    "Proposed answer: {proposed}\n\n"
    "Is the proposed answer correct? Reply with JSON only:\n"
    '{{"verdict": "correct" or "incorrect", "reason": "<one sentence>"}}'
)

AUDIO_AGENT_PROMPT = (
    "You are an audio-transcript reading agent. Answer only from the supplied transcript.\n"
    "Question: {question}\n\nTranscript:\n{transcript}\n\n"
    "Reply with JSON only, no other text:\n"
    '{{"answer":"<turn number>", "span_ms":[start_ms, end_ms], "evidence":"<quoted transcript evidence>"}}\n'
    "span_ms is [start_ms, end_ms] in MILLISECONDS, copied exactly from the header of the turn you rely on. "
    "Headers look like [turn 3 | 12400-18900 ms]. "
    "If the transcript is absent or insufficient, use answer \"unknown\" and span_ms null."
)

BLIND_GUESS_LINE = (
    "Even if you cannot hear the audio, give your single best guess of the turn number."
)


def audio_agent_prompt(question: str, transcript: str, condition: str) -> str:
    prompt = AUDIO_AGENT_PROMPT.format(question=question, transcript=transcript)
    if condition == "blind_guess":
        prompt += "\n" + BLIND_GUESS_LINE
    return prompt

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


def _canon_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def parse_menu_answer(pred) -> list[dict] | None:
    """Extract [{name, price}, ...] from a model answer (JSON string or object)."""
    if pred is None:
        return None
    obj = pred
    if isinstance(pred, str):
        text = pred.strip()
        if not text:
            return None
        obj = parse_json(text)
        if obj is None:
            # Sometimes the answer field itself is a JSON string of {"items":...}
            try:
                obj = json.loads(text)
            except json.JSONDecodeError:
                return None
    if isinstance(obj, dict) and "items" in obj:
        items = obj["items"]
    elif isinstance(obj, list):
        items = obj
    else:
        return None
    if not isinstance(items, list):
        return None
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = it.get("name") if it.get("name") is not None else it.get("nm")
        price = it.get("price")
        if name is None or price is None:
            continue
        out.append({"name": str(name), "price": str(price)})
    return out


def match_menu_items(pred_items: list[dict], true_items: list[dict], name_thresh: float = 0.6):
    """Greedy one-to-one match on canonical price and name similarity.

    Returns (matched_pairs, missing_true, fabricated_pred).
    """
    import difflib

    true_left = list(enumerate(true_items))
    matched = []
    fabricated = []
    for pi, pred in enumerate(pred_items):
        p_amt = _amount(pred.get("price"))
        best = None
        best_sim = -1.0
        for ti, true in true_left:
            if p_amt is None or _amount(true.get("price")) is None:
                continue
            if abs(p_amt - _amount(true["price"])) >= 0.0051:
                continue
            sim = difflib.SequenceMatcher(
                None, _canon_name(pred.get("name", "")), _canon_name(true.get("name", ""))
            ).ratio()
            if sim >= name_thresh and sim > best_sim:
                best, best_sim = (ti, true), sim
        if best is None:
            fabricated.append(pred)
        else:
            matched.append((pred, best[1]))
            true_left = [(ti, t) for ti, t in true_left if ti != best[0]]
    missing = [t for _, t in true_left]
    return matched, missing, fabricated


def answer_correct(case: dict, pred: str) -> bool:
    family = case.get("family") or ""
    atype = case.get("answer_type")
    if family == "unanswerable" or atype == "unanswerable":
        return _txt(pred) == "notshown"
    if family == "menu_list" or atype == "menu_list":
        pred_items = parse_menu_answer(pred)
        if pred_items is None:
            return False
        true_items = case.get("menu") or []
        matched, missing, fabricated = match_menu_items(pred_items, true_items)
        return not missing and not fabricated
    if pred is None or _txt(pred) in ("", "unknown"):
        return False
    if atype == "number":
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

    def agent(self, model, case, image_png, condition, prompt: str | None = None):
        t = time.time()
        text = prompt if prompt is not None else AGENT_PROMPT.format(question=case["question"])
        raw, usage = self._chat(model, text, image_png)
        return raw, time.time() - t, usage

    def judge(self, model, case, proposed, image_png):
        prompt_t = JUDGE_PROMPT if image_png is not None else JUDGE_PROMPT_NO_MEDIA
        raw, _usage = self._chat(
            model, prompt_t.format(question=case["question"], proposed=proposed), image_png
        )
        return raw

    def audio_agent(self, model, case, transcript, condition):
        t = time.time()
        raw, usage = self._chat(
            model, audio_agent_prompt(case["question"], transcript, condition), None
        )
        return raw, time.time() - t, usage

    def audio_judge(self, model, case, proposed, transcript):
        raw, _usage = self._chat(
            model,
            AUDIO_JUDGE_PROMPT.format(question=case["question"], proposed=proposed, transcript=transcript),
            None,
        )
        return raw

    def chat_images(
        self,
        model: str,
        prompt: str,
        framed: list[tuple[str, bytes]],
    ) -> tuple[str, dict]:
        """Multi-image chat. `framed` is [(caption, png_bytes), ...] interleaved after the prompt.

        New method — does not change existing call signatures.
        """
        content: list[dict] = [{"type": "text", "text": prompt}]
        for caption, png in framed:
            content.append({"type": "text", "text": caption})
            b64 = base64.b64encode(png).decode()
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
            )
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

    def video_agent(self, model, case, framed: list[tuple[str, bytes]], prompt: str):
        """Video agent over captioned frames. New method — existing signatures unchanged."""
        t = time.time()
        raw, usage = self.chat_images(model, prompt, framed)
        return raw, time.time() - t, usage


class MockBackend:
    """Offline stand-in used to test the pipeline end to end without an API key.
    Behaviour is deliberately imperfect so every code path gets exercised."""

    def __init__(self, seed=0):
        self.rng = random.Random(seed)

    def agent(self, model, case, image_png, condition, prompt: str | None = None):
        r = self.rng
        usage = {"input_tokens": 900, "output_tokens": 160}
        family = case.get("family") or ""
        want_tools = prompt is not None and "tool_calls" in prompt
        if image_png is None:  # blind
            if family == "unanswerable":
                ans = "not shown" if r.random() < 0.5 else case.get("distractor", "0")
            elif family == "menu_list":
                ans = "unknown"
            else:
                ans = "unknown" if r.random() < 0.7 else case["distractor"]
            payload = {"answer": ans, "box": None, "evidence": "no image"}
            if want_tools:
                payload["tool_calls"] = []
            return json.dumps(payload), 0.01, usage
        p_ok = {"clean": 0.95, "blur": 0.7, "noise": 0.6, "lowres": 0.4}.get(condition, 0.5)
        if "1.1" in model:
            p_ok -= 0.15
        ok = r.random() < p_ok
        t = case.get("truth_box")
        if t and r.random() < p_ok:
            box = [t[0] + r.randint(-15, 15), t[1] + r.randint(-15, 15), t[2] + r.randint(-15, 15), t[3] + r.randint(-15, 15)]
        elif t:
            box = [r.randint(0, 300), r.randint(0, 300), r.randint(400, 700), r.randint(400, 700)]
        else:
            box = None
        if family == "unanswerable":
            ans = "not shown" if ok else case.get("distractor", "12.00")
            box = None
        elif family == "menu_list":
            items = list(case.get("menu") or [])
            if ok:
                ans = {"items": items}
            elif items and r.random() < 0.5:
                ans = {"items": items[:-1]}  # incomplete
            else:
                ans = {"items": items + [{"name": "FABRICATED ITEM", "price": "9.99"}]}
            if isinstance(ans, dict):
                ans = json.dumps(ans)
        else:
            ans = case["answer"] if ok else case["distractor"]
        payload = {"answer": ans, "box": box, "evidence": "mock"}
        if want_tools:
            readable = str(ans).lower() not in ("unknown", "not shown", "") and box is not None
            if readable:
                payload["tool_calls"] = [
                    {"name": "check_duplicate", "arguments": {"amount": ans}},
                    {
                        "name": "log_expense",
                        "arguments": {"amount": ans, "currency": "IDR", "category": "meals"},
                    },
                ]
            else:
                payload["tool_calls"] = []
        return json.dumps(payload), 0.01, usage

    def judge(self, model, case, proposed, image_png):
        r = self.rng
        truth = answer_correct(case, proposed)
        # Without media the mock judge is much less reliable.
        flip = r.random() < (0.45 if image_png is None else 0.1)
        verdict = "correct" if (truth != flip) else "incorrect"
        return json.dumps({"verdict": verdict, "reason": "mock"})

    def audio_agent(self, model, case, transcript, condition):
        usage = {"input_tokens": 900, "output_tokens": 160}
        if condition == "blind_guess":
            turn = self.rng.choice(case["turns"])
            return json.dumps({
                "answer": str(turn["index"]),
                "span_ms": [turn["start_ms"], turn["end_ms"]],
                "evidence": "guess",
            }), 0.01, usage
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

    def video_agent(self, model, case, framed: list[tuple[str, bytes]], prompt: str):
        """Offline video agent. New method — existing signatures unchanged."""
        usage = {"input_tokens": 1200, "output_tokens": 180}
        has_frames = bool(framed)
        if not has_frames:
            if "blind_guess" in (prompt or "").lower() or "best guess" in (prompt or "").lower():
                if case.get("answer_type") == "seconds":
                    try:
                        ans = f"{max(0.0, float(case['answer']) + self.rng.choice([-3, -2, 2, 3])):0.1f}"
                    except (TypeError, ValueError):
                        ans = "5.0"
                elif str(case.get("answer", "")).upper() in ("TAX", "TOTAL"):
                    ans = "TAX" if case["answer"].upper() == "TOTAL" else "TOTAL"
                else:
                    ans = "COFFEE" if str(case.get("answer", "")).upper() != "COFFEE" else "TEA"
                return json.dumps(
                    {"answer": ans, "span_ms": [0, 2000], "box": None, "evidence": "guess"}
                ), 0.01, usage
            return json.dumps(
                {"answer": "unknown", "span_ms": None, "box": None, "evidence": "no frames"}
            ), 0.01, usage

        condition = case.get("_condition") or "clean"
        p_ok = {"clean": 0.92, "sparse": 0.75, "blur": 0.65, "noise": 0.6}.get(condition, 0.8)
        if "1.1" in model:
            p_ok -= 0.15
        ok = self.rng.random() < p_ok
        truth_span = case.get("truth_span_ms")
        truth_box = case.get("truth_box")
        if ok and truth_span:
            span = list(truth_span)
        elif truth_span:
            span = [max(0, truth_span[0] - 4000), max(0, truth_span[1] - 4000)]
        else:
            span = None
        if ok and truth_box:
            box = list(truth_box)
        elif truth_box:
            box = [0, 0, 100, 100]
        else:
            box = None
        if ok:
            ans = case["answer"]
        else:
            if case.get("answer_type") == "seconds":
                try:
                    ans = f"{float(case['answer']) + 4.0:0.1f}"
                except (TypeError, ValueError):
                    ans = "0.0"
            elif str(case.get("answer", "")).upper() in ("TAX", "TOTAL"):
                ans = "TAX" if str(case["answer"]).upper() == "TOTAL" else "TOTAL"
            else:
                ans = case.get("distractor") or "UNKNOWN ITEM"
        return json.dumps(
            {"answer": ans, "span_ms": span, "box": box, "evidence": "mock frames"}
        ), 0.01, usage
