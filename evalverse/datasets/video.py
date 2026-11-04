"""Synthetic register-screen videos for EvalVerse.

    python -m evalverse.datasets.video --n 12 --seed 7

Draws 640x400 "REGISTER" screens at 10 fps for 20 s. Five item lines appear one
by one at known times, then TAX and TOTAL. Writes data/video/vid_XX.mp4 and
data/cases_video.json (3 questions per video → 36 cases when --n 12).
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
VIDEO_DIR = DATA / "video"

WIDTH, HEIGHT = 640, 400
FPS = 10
DURATION_S = 20.0
N_FRAMES = int(DURATION_S * FPS)

ITEM_POOL = [
    ("MILK 1L", 2.49),
    ("BREAD", 1.80),
    ("EGGS 12pk", 3.25),
    ("BUTTER", 2.10),
    ("CHEESE", 4.50),
    ("APPLES", 2.75),
    ("BANANAS", 1.20),
    ("COFFEE", 6.99),
    ("TEA BOX", 3.40),
    ("SUGAR", 1.55),
    ("RICE 1kg", 2.30),
    ("PASTA", 1.90),
    ("TOMATOES", 2.05),
    ("ONIONS", 1.15),
    ("YOGURT", 1.75),
    ("JUICE", 2.60),
    ("CEREAL", 3.80),
    ("SOAP", 1.40),
]


def _font(size: int = 22):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        try:
            return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", size)
        except OSError:
            return ImageFont.load_default()


def _to_grid_box(x0, y0, x1, y1) -> list[int]:
    return [
        int(round(1000 * x0 / WIDTH)),
        int(round(1000 * y0 / HEIGHT)),
        int(round(1000 * x1 / WIDTH)),
        int(round(1000 * y1 / HEIGHT)),
    ]


def _line_geometry(row_index: int) -> tuple[int, int, int, int]:
    """Pixel box for a register line. row 0 = header, then items/tax/total."""
    top = 48 + row_index * 36
    return 40, top, WIDTH - 40, top + 30


def _draw_frame(visible_lines: list[tuple[str, int]], font) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), color=(18, 22, 28))
    draw = ImageDraw.Draw(img)
    draw.rectangle([16, 16, WIDTH - 16, HEIGHT - 16], outline=(80, 180, 120), width=2)
    for text, row in visible_lines:
        x0, y0, x1, y1 = _line_geometry(row)
        draw.rectangle([x0 - 4, y0 - 2, x1 + 4, y1 + 2], fill=(28, 36, 44))
        draw.text((x0, y0), text, fill=(220, 240, 220), font=font)
    return img


def _write_mp4(path: Path, frames: list[Image.Image]) -> None:
    import imageio.v2 as imageio

    path.parent.mkdir(parents=True, exist_ok=True)
    with imageio.get_writer(str(path), fps=FPS, codec="libx264", quality=8) as writer:
        for fr in frames:
            writer.append_data(np.asarray(fr.convert("RGB")))


def build_video(vid_index: int, rng: random.Random) -> tuple[dict, list[dict]]:
    """Return (video_meta_for_events, list_of_3_cases)."""
    items = rng.sample(ITEM_POOL, 5)
    # Keep event schedule inside the clip (DURATION_S may be shortened in tests).
    item_hi = min(9.0, max(2.0, DURATION_S * 0.45))
    item_lo = min(1.5, item_hi - 0.2)
    item_times = sorted(rng.uniform(item_lo, item_hi) for _ in range(5))
    last_item = max(item_times)
    total_hi = min(16.0, DURATION_S * 0.85)
    total_lo = min(last_item + 0.5, total_hi - 0.2)
    if total_lo >= total_hi:
        total_lo = max(last_item + 0.1, total_hi - 0.3)
    total_t = rng.uniform(total_lo, total_hi)
    tax_before = (vid_index % 2) == 0
    if tax_before:
        tax_hi = max(last_item + 0.2, total_t - 0.2)
        tax_t = rng.uniform(last_item + 0.15, tax_hi)
        if tax_t >= total_t:
            tax_t = max(last_item + 0.1, total_t - 0.2)
    else:
        tax_lo = min(total_t + 0.2, DURATION_S - 0.4)
        tax_hi = max(tax_lo + 0.1, DURATION_S - 0.2)
        tax_t = rng.uniform(tax_lo, tax_hi)

    subtotal = round(sum(p for _, p in items), 2)
    tax = round(subtotal * 0.08, 2)
    total = round(subtotal + tax, 2)

    # Row layout: 0 header, 1..5 items, 6/7 tax & total (order of appearance ≠ row).
    # Keep stable rows: items rows 1-5, tax row 6, total row 7.
    events = []
    for i, ((name, price), t) in enumerate(zip(items, item_times)):
        text = f"{name:<12} {price:6.2f}"
        x0, y0, x1, y1 = _line_geometry(1 + i)
        events.append(
            {
                "type": "item",
                "text": text,
                "name": name,
                "price": price,
                "t_ms": int(round(t * 1000)),
                "box": _to_grid_box(x0, y0, x1, y1),
                "row": 1 + i,
            }
        )
    tax_text = f"TAX          {tax:6.2f}"
    tx0, ty0, tx1, ty1 = _line_geometry(6)
    events.append(
        {
            "type": "tax",
            "text": tax_text,
            "t_ms": int(round(tax_t * 1000)),
            "box": _to_grid_box(tx0, ty0, tx1, ty1),
            "row": 6,
        }
    )
    total_text = f"TOTAL        {total:6.2f}"
    ox0, oy0, ox1, oy1 = _line_geometry(7)
    events.append(
        {
            "type": "total",
            "text": total_text,
            "t_ms": int(round(total_t * 1000)),
            "box": _to_grid_box(ox0, oy0, ox1, oy1),
            "row": 7,
        }
    )

    font = _font(22)
    header = ("REGISTER", 0)
    frames = []
    for fi in range(N_FRAMES):
        t_ms = int(round(1000 * fi / FPS))
        visible = [header]
        for ev in events:
            if ev["t_ms"] <= t_ms:
                visible.append((ev["text"], ev["row"]))
        frames.append(_draw_frame(visible, font))

    vid_id = f"vid_{vid_index:02d}"
    rel = f"data/video/{vid_id}.mp4"
    _write_mp4(VIDEO_DIR / f"{vid_id}.mp4", frames)

    total_ev = next(e for e in events if e["type"] == "total")
    tax_ev = next(e for e in events if e["type"] == "tax")
    third = next(e for e in events if e["type"] == "item" and e["row"] == 3)
    first_of_tax_total = "TAX" if tax_ev["t_ms"] < total_ev["t_ms"] else "TOTAL"
    order_span = [
        min(tax_ev["t_ms"], total_ev["t_ms"]),
        max(tax_ev["t_ms"], total_ev["t_ms"]) + 1500,
    ]

    base = {
        "modality": "video",
        "family": "register_video",
        "video": rel,
        "duration_ms": int(DURATION_S * 1000),
        "fps": FPS,
        "events": [
            {k: v for k, v in e.items() if k in ("type", "text", "t_ms", "box")}
            for e in events
        ],
        "source": "synthetic",
    }

    total_s = total_ev["t_ms"] / 1000.0
    cases = [
        {
            **base,
            "id": f"{vid_id}_time",
            "question": (
                "At what time in seconds does the TOTAL line appear on screen? "
                "Answer with the number only."
            ),
            "answer": f"{total_s:.1f}",
            "answer_type": "seconds",
            "tolerance_s": 1.0,
            "truth_span_ms": [total_ev["t_ms"], total_ev["t_ms"] + 1500],
            "truth_box": list(total_ev["box"]),
            "distractor": f"{max(0.0, total_s - 3.0):.1f}",
        },
        {
            **base,
            "id": f"{vid_id}_order",
            "question": (
                "Which appears first on screen, the TAX line or the TOTAL line? "
                "Answer TAX or TOTAL."
            ),
            "answer": first_of_tax_total,
            "answer_type": "text",
            "truth_span_ms": order_span,
            "truth_box": None,
            "distractor": "TOTAL" if first_of_tax_total == "TAX" else "TAX",
        },
        {
            **base,
            "id": f"{vid_id}_third",
            "question": (
                "What is the name of the third item that appears on screen? "
                "Answer with the item name only."
            ),
            "answer": third["name"],
            "answer_type": "text",
            "truth_span_ms": [third["t_ms"], third["t_ms"] + 1500],
            "truth_box": list(third["box"]),
            "distractor": items[0][0] if items[0][0] != third["name"] else items[1][0],
        },
    ]
    return {"id": vid_id, "path": rel, "tax_before_total": tax_before}, cases


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=12, help="number of videos")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)

    rng = random.Random(args.seed)
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    all_cases = []
    for i in range(1, args.n + 1):
        meta, cases = build_video(i, rng)
        all_cases.extend(cases)
        print(f"wrote {meta['path']}  tax_before_total={meta['tax_before_total']}")

    out = DATA / "cases_video.json"
    out.write_text(json.dumps(all_cases, indent=2))
    print(f"wrote {out} ({len(all_cases)} cases)")


if __name__ == "__main__":
    main()
