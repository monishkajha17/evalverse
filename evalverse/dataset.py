"""Generate the EvalVerse test set.

Every image is drawn from scratch, so the ground truth (answer + the exact
region of the image that proves it) is known by construction. No scraped data,
no annotation work, no licensing questions.

Boxes are stored on the same normalized 0-1000 grid Muse Spark uses for
grounding: (0, 0) top-left, (1000, 1000) bottom-right, [x_min, y_min, x_max, y_max].
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMG_DIR = DATA / "images"

INK = (24, 32, 46)
PAPER = (253, 253, 251)
BACKDROP = (222, 226, 232)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = (
        ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf"]
        if bold
        else ["DejaVuSans.ttf", "LiberationSans-Regular.ttf", "Arial.ttf", "arial.ttf"]
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def norm_box(box, size):
    w, h = size
    x0, y0, x1, y1 = box
    return [
        max(0, round(x0 / w * 1000)),
        max(0, round(y0 / h * 1000)),
        min(1000, round(x1 / w * 1000)),
        min(1000, round(y1 / h * 1000)),
    ]


# --------------------------------------------------------------------------- receipts
STORES = ["Marigold Cafe", "Juniper Hardware", "Lantern Books", "Saffron Kitchen",
          "Harbor Bike Shop", "Willow Pharmacy", "Copper Kettle", "Orchard Market"]
ITEMS = ["Flat white", "Almond croissant", "Sourdough loaf", "USB-C cable", "Notebook",
         "Basil plant", "Cold brew", "Garden gloves", "Tea tin", "Pencil set",
         "Sparkling water", "Granola bar", "Candle", "Tote bag"]


def make_receipt(rng: random.Random, ask: str, path: Path) -> dict:
    size = (700, 900)
    img = Image.new("RGB", size, BACKDROP)
    d = ImageDraw.Draw(img)
    d.rectangle([50, 30, 650, 870], fill=PAPER, outline=(200, 204, 210))
    store = rng.choice(STORES)
    d.text((350, 78), store, font=font(34, True), fill=INK, anchor="mm")
    d.text((350, 118), f"Order #{rng.randint(1000, 9999)}", font=font(20), fill=(90, 100, 115), anchor="mm")

    n = rng.randint(4, 6)
    items = rng.sample(ITEMS, n)
    prices = [round(rng.randint(250, 1900) / 100, 2) for _ in items]
    y = 170
    f = font(24)
    for name, p in zip(items, prices):
        d.text((90, y), name, font=f, fill=INK)
        d.text((610, y), f"{p:.2f}", font=f, fill=INK, anchor="ra")
        y += 46
    subtotal = round(sum(prices), 2)
    tax = round(subtotal * 0.08, 2)
    total = round(subtotal + tax, 2)
    y += 8
    d.line([90, y, 610, y], fill=(150, 156, 166), width=2)
    y += 26
    rows = {}
    for key, label, val, bold in [("subtotal", "Subtotal", subtotal, False),
                                  ("tax", "Tax (8%)", tax, False),
                                  ("total", "TOTAL", total, True)]:
        ff = font(30 if bold else 24, bold)
        d.text((90, y), label, font=ff, fill=INK)
        d.text((610, y), f"{val:.2f}", font=ff, fill=INK, anchor="ra")
        rows[key] = (84, y - 6, 616, y + (46 if bold else 40))
        y += 58 if bold else 46
    d.text((350, y + 50), "Thank you - see you soon", font=font(20), fill=(110, 118, 130), anchor="mm")
    img.save(path)

    if ask == "total":
        q = "What is the total amount due on this receipt? Answer with the number only."
        ans, distract, box = total, subtotal, rows["total"]
    else:
        q = "How much tax was charged on this receipt? Answer with the number only."
        ans, distract, box = tax, prices[0], rows["tax"]
    return dict(family="receipt", question=q, answer=f"{ans:.2f}", answer_type="number",
                distractor=f"{distract:.2f}", truth_box=norm_box(box, size), size=list(size))


# --------------------------------------------------------------------------- bar charts
CAT_SETS = [["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
            ["Alpha", "Bravo", "Cedar", "Delta", "Ember", "Fjord"],
            ["North", "South", "East", "West", "Central", "Coastal"]]
TITLES = ["Weekly signups", "Units shipped", "Support tickets closed", "Store visits", "Newsletter opens"]
BAR_COLORS = [(66, 120, 180), (214, 110, 80), (80, 160, 120), (170, 120, 190), (220, 170, 60), (90, 170, 190)]


def make_chart(rng: random.Random, ask: str, path: Path) -> dict:
    size = (900, 600)
    img = Image.new("RGB", size, PAPER)
    d = ImageDraw.Draw(img)
    cats = rng.choice(CAT_SETS)[: rng.randint(5, 6)]
    vals = rng.sample(range(12, 96), len(cats))
    d.text((60, 28), rng.choice(TITLES), font=font(30, True), fill=INK)
    left, right, top, bottom = 110, 850, 100, 500

    def y_of(v):
        return bottom - (v / 100) * (bottom - top)

    for tick in range(0, 101, 20):
        yy = y_of(tick)
        d.line([left, yy, right, yy], fill=(222, 226, 232), width=2)
        d.text((left - 14, yy), str(tick), font=font(20), fill=(90, 100, 115), anchor="rm")
    slot = (right - left) / len(cats)
    boxes = []
    for i, (c, v) in enumerate(zip(cats, vals)):
        x0 = left + i * slot + slot * 0.18
        x1 = left + (i + 1) * slot - slot * 0.18
        d.rectangle([x0, y_of(v), x1, bottom], fill=BAR_COLORS[i % len(BAR_COLORS)])
        d.text(((x0 + x1) / 2, bottom + 28), c, font=font(22), fill=INK, anchor="mm")
        boxes.append((x0, y_of(v), x1, bottom))
        if ask == "value":
            d.text(((x0 + x1) / 2, y_of(v) - 16), str(v), font=font(22, True), fill=INK, anchor="mm")

    if ask == "highest":
        order = sorted(range(len(vals)), key=lambda k: -vals[k])
        i, j = order[0], order[1]
        q = "Which category has the highest value in this chart? Answer with the category label only."
        ans, distract, answer_type = cats[i], cats[j], "text"
    else:
        i = rng.randrange(len(cats))
        j = (i + 1) % len(cats)
        q = f"What is the value of {cats[i]} in this chart? Answer with the number only."
        ans, distract, answer_type = str(vals[i]), str(vals[j]), "number"
    img.save(path)
    return dict(family="chart", question=q, answer=ans, answer_type=answer_type,
                distractor=distract, truth_box=norm_box(boxes[i], size), size=list(size))


# --------------------------------------------------------------------------- pricing cards
PLANS = ["Starter", "Basic", "Pro", "Team", "Studio", "Scale", "Business"]
PRICES = [9, 12, 15, 19, 24, 29, 39, 49, 59, 79, 99, 149]
PERKS = ["5 projects", "Email support", "Custom domain", "10 seats", "Analytics", "Priority support",
         "API access", "Single sign-on", "Audit log", "50 GB storage"]


def make_pricing(rng: random.Random, ask: str, path: Path) -> dict:
    size = (900, 560)
    img = Image.new("RGB", size, (240, 243, 247))
    d = ImageDraw.Draw(img)
    names = rng.sample(PLANS, 3)
    prices = rng.sample(PRICES, 3)
    card_w, gap = 250, 40
    x = (size[0] - (3 * card_w + 2 * gap)) // 2
    price_boxes = []
    for name, price in zip(names, prices):
        d.rounded_rectangle([x, 60, x + card_w, 500], radius=18, fill=(255, 255, 255), outline=(205, 211, 220), width=2)
        d.text((x + card_w / 2, 112), name, font=font(30, True), fill=INK, anchor="mm")
        pf = font(60, True)
        ptxt = f"${price}"
        cx = x + card_w / 2 - 22
        d.text((cx, 200), ptxt, font=pf, fill=INK, anchor="mm")
        bb = d.textbbox((cx, 200), ptxt, font=pf, anchor="mm")
        d.text((bb[2] + 6, bb[3] - 8), "/mo", font=font(22), fill=(100, 110, 125), anchor="ls")
        price_boxes.append((bb[0] - 14, bb[1] - 14, bb[2] + 62, bb[3] + 14))
        yy = 290
        for perk in rng.sample(PERKS, 3):
            d.text((x + 26, yy), "- " + perk, font=font(21), fill=(70, 80, 95))
            yy += 44
        x += card_w + gap
    i = rng.randrange(3)
    j = (i + 1) % 3
    img.save(path)
    return dict(family="pricing", question=f"What is the monthly price of the {names[i]} plan? Answer with the number only.",
                answer=str(prices[i]), answer_type="number", distractor=str(prices[j]),
                truth_box=norm_box(price_boxes[i], size), size=list(size))


def build(seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    plan = (
        [("receipt", "total")] * 4 + [("receipt", "tax")] * 3
        + [("chart", "highest")] * 4 + [("chart", "value")] * 3
        + [("pricing", "price")] * 7
    )
    makers = {"receipt": make_receipt, "chart": make_chart, "pricing": make_pricing}
    cases = []
    for k, (family, ask) in enumerate(plan, start=1):
        cid = f"{family}_{k:02d}"
        path = IMG_DIR / f"{cid}.png"
        case = makers[family](rng, ask, path)
        case.update(id=cid, image=f"data/images/{cid}.png")
        cases.append(case)
    (DATA / "cases.json").write_text(json.dumps(cases, indent=2))
    return cases


if __name__ == "__main__":
    cs = build()
    print(f"wrote {len(cs)} cases to {DATA}")
