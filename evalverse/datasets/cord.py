"""Real receipts for EvalVerse: CORD v2 (NAVER Clova), licensed CC BY 4.0.

    pip install -r requirements-data.txt
    python -m evalverse.datasets.cord --inspect            # look at the raw structure first
    python -m evalverse.datasets.cord --n 30               # build data/cases_cord.json

CORD gives photographed receipts with word-level boxes and semantic labels, so the answer
(for example the total) and the exact region that proves it come from the dataset, not from us.

Cite: Park et al., "CORD: A Consolidated Receipt Dataset for Post-OCR Parsing", 2019.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from .. import core

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
IMG_DIR = DATA / "images_cord"

# kind -> (valid_line category, path into gt_parse, question)
KINDS = {
    "total": ("total.total_price", ("total", "total_price"),
              "What is the total amount due on this receipt? Answer with the number only."),
    "subtotal": ("sub_total.subtotal_price", ("sub_total", "subtotal_price"),
                 "What is the subtotal on this receipt, before tax and service? Answer with the number only."),
    "tax": ("sub_total.tax_price", ("sub_total", "tax_price"),
            "How much tax was charged on this receipt? Answer with the number only."),
}


def _get(d, path):
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d if isinstance(d, str) and d.strip() else None


def _amounts_on_receipt(gt_parse) -> list[str]:
    """Other amounts printed on the receipt, used as plausible wrong answers."""
    out = []
    for sec in ("total", "sub_total"):
        blk = gt_parse.get(sec)
        if isinstance(blk, dict):
            out += [v for v in blk.values() if isinstance(v, str)]
    menu = gt_parse.get("menu")
    for m in (menu if isinstance(menu, list) else [menu] if isinstance(menu, dict) else []):
        if isinstance(m, dict) and isinstance(m.get("price"), str):
            out.append(m["price"])
    return out


def _union_box(lines, category, size):
    """Union of every word (key and value) on the lines with this category -> normalized 0-1000 box."""
    xs, ys = [], []
    for ln in lines:
        if ln.get("category") != category:
            continue
        for w in ln.get("words", []):
            q = w.get("quad") or {}
            for i in range(1, 5):
                if f"x{i}" in q and f"y{i}" in q:
                    xs.append(float(q[f"x{i}"]))
                    ys.append(float(q[f"y{i}"]))
    if not xs:
        return None
    W, H = size
    return [max(0, round(min(xs) / W * 1000)), max(0, round(min(ys) / H * 1000)),
            min(1000, round(max(xs) / W * 1000)), min(1000, round(max(ys) / H * 1000))]


def build_cases(rows, n=30, seed=7, out_dir=IMG_DIR, verbose=True):
    rng = random.Random(seed)
    rows = list(rows)
    rng.shuffle(rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {k: 0 for k in KINDS}
    cases, skipped = [], 0
    for row in rows:
        if len(cases) >= n:
            break
        try:
            gt = json.loads(row["ground_truth"]) if isinstance(row["ground_truth"], str) else row["ground_truth"]
            parse, lines = gt.get("gt_parse", {}), gt.get("valid_line", [])
            meta_size = (gt.get("meta", {}).get("image_size") or {})
            img = row["image"].convert("RGB")
            size = (meta_size.get("width") or img.width, meta_size.get("height") or img.height)
        except Exception:
            skipped += 1
            continue
        avail = []
        for kind, (cat, path, _q) in KINDS.items():
            val = _get(parse, path)
            box = _union_box(lines, cat, size) if val else None
            if val and box and core._amount(val) is not None:
                avail.append((kind, val, box))
        if not avail:
            skipped += 1
            continue
        kind, val, box = min(avail, key=lambda a: counts[a[0]])        # balance the question types
        correct = core._amount(val)
        distractors = [a for a in _amounts_on_receipt(parse) if core._amount(a) not in (None, correct)]
        if not distractors:
            skipped += 1
            continue
        counts[kind] += 1
        cid = f"cord_{kind}_{len(cases) + 1:02d}"
        im = img.copy()
        im.thumbnail((1280, 1280))
        path = out_dir / f"{cid}.jpg"
        im.save(path, quality=90)
        cases.append(dict(
            id=cid, family="cord_receipt", question=KINDS[kind][2], answer=val, answer_type="number",
            distractor=rng.choice(distractors), truth_box=box, size=list(im.size),
            image=str(path.relative_to(ROOT)), source="CORD v2 (CC BY 4.0)"))
    (DATA / "cases_cord.json").write_text(json.dumps(cases, indent=2))
    if verbose:
        print(f"built {len(cases)} cases ({counts}); skipped {skipped} receipts without usable labels")
        print(f"wrote {DATA / 'cases_cord.json'} and images in {out_dir}")
    return cases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--inspect", action="store_true", help="print the raw structure of one row and exit")
    args = ap.parse_args()
    try:
        from datasets import load_dataset
    except ImportError:
        raise SystemExit("Run: pip install -r requirements-data.txt")
    ds = load_dataset("naver-clova-ix/cord-v2", split="test")
    if args.inspect:
        row = ds[0]
        gt = json.loads(row["ground_truth"])
        print("row keys        :", list(row.keys()))
        print("ground_truth keys:", list(gt.keys()))
        print("meta            :", gt.get("meta"))
        print("gt_parse keys   :", list(gt.get("gt_parse", {}).keys()))
        print("total / sub_total:", gt.get("gt_parse", {}).get("total"), gt.get("gt_parse", {}).get("sub_total"))
        vl = gt.get("valid_line", [])
        print("valid_line count:", len(vl))
        if vl:
            print("first valid_line:", json.dumps(vl[0])[:400])
        print("image size      :", row["image"].size)
        return
    build_cases(ds, n=args.n, seed=args.seed)


if __name__ == "__main__":
    main()
