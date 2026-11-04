"""Real receipts for EvalVerse: CORD v2 (NAVER Clova), licensed CC BY 4.0.

    pip install -r requirements-data.txt
    python -m evalverse.datasets.cord --inspect            # look at the raw structure first
    python -m evalverse.datasets.cord --n 30               # build data/cases_cord.json
    python -m evalverse.datasets.cord --families menu_list,unanswerable --n 20

CORD gives photographed receipts with word-level boxes and semantic labels, so the answer
(for example the total) and the exact region that proves it come from the dataset, not from us.

Cite: Park et al., "CORD: A Consolidated Receipt Dataset for Post-OCR Parsing", 2019.
"""
from __future__ import annotations

import argparse
import io
import json
import random
from pathlib import Path

from PIL import Image

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

MENU_LIST_QUESTION = (
    'List every purchased item on this receipt with its price. '
    'Reply with answer = a JSON string {"items":[{"name":"...","price":"..."}]}'
)

UNANSWERABLE_FIELDS = (
    ("service_price", "service price"),
    ("discount_price", "discount"),
    ("changeprice", "change"),
    ("emoneyprice", "e-money amount"),
)


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


def _union_box_prefix(lines, prefix: str, size):
    """Union of words whose category starts with `prefix` (e.g. 'menu.')."""
    xs, ys = [], []
    for ln in lines:
        cat = ln.get("category") or ""
        if not cat.startswith(prefix):
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
    return [
        max(0, round(min(xs) / W * 1000)),
        max(0, round(min(ys) / H * 1000)),
        min(1000, round(max(xs) / W * 1000)),
        min(1000, round(max(ys) / H * 1000)),
    ]


def _menu_items(gt_parse) -> list[dict]:
    menu = gt_parse.get("menu")
    raw = menu if isinstance(menu, list) else [menu] if isinstance(menu, dict) else []
    out = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        nm, price = m.get("nm"), m.get("price")
        if isinstance(nm, str) and nm.strip() and isinstance(price, str) and core._amount(price) is not None:
            out.append({"name": nm.strip(), "price": price.strip()})
    return out


def _has_parse_key(obj, key: str) -> bool:
    if isinstance(obj, dict):
        if key in obj:
            return True
        return any(_has_parse_key(v, key) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_parse_key(v, key) for v in obj)
    return False


def _line_has_field(lines, key: str) -> bool:
    for ln in lines:
        cat = ln.get("category") or ""
        if cat == key or cat.endswith("." + key):
            return True
    return False


def _absent_fields(gt_parse, lines) -> list[tuple[str, str]]:
    out = []
    for key, label in UNANSWERABLE_FIELDS:
        if _has_parse_key(gt_parse, key):
            continue
        if _line_has_field(lines, key):
            continue
        out.append((key, label))
    return out


def _row_image(row) -> Image.Image:
    img = row["image"]
    if isinstance(img, Image.Image):
        return img.convert("RGB")
    if isinstance(img, dict) and img.get("bytes"):
        return Image.open(io.BytesIO(img["bytes"])).convert("RGB")
    raise TypeError(f"unsupported image payload: {type(img)}")


def _save_case_image(img: Image.Image, cid: str, out_dir: Path) -> tuple[Path, list[int]]:
    im = img.copy()
    im.thumbnail((1280, 1280))
    path = out_dir / f"{cid}.jpg"
    im.save(path, quality=90)
    return path, list(im.size)


def build_field_cases(rows, n=30, seed=7, out_dir=IMG_DIR, verbose=True):
    """Existing behaviour: total / subtotal / tax field questions -> data/cases_cord.json."""
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
            img = _row_image(row)
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
        path, size_out = _save_case_image(img, cid, out_dir)
        cases.append(dict(
            id=cid, family="cord_receipt", question=KINDS[kind][2], answer=val, answer_type="number",
            distractor=rng.choice(distractors), truth_box=box, size=size_out,
            image=str(path.relative_to(ROOT)), source="CORD v2 (CC BY 4.0)"))
    out_path = DATA / "cases_cord.json"
    out_path.write_text(json.dumps(cases, indent=2))
    if verbose:
        print(f"built {len(cases)} cases ({counts}); skipped {skipped} receipts without usable labels")
        print(f"wrote {out_path} and images in {out_dir}")
    return cases


def build_list_cases(rows, n=20, seed=7, families=("menu_list", "unanswerable"), out_dir=IMG_DIR, verbose=True):
    """menu_list and/or unanswerable families -> data/cases_cord_lists.json."""
    rng = random.Random(seed)
    rows = list(rows)
    rng.shuffle(rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    want = set(families)
    targets = {f: max(1, n // len(want)) for f in want}
    # Distribute remainder
    rem = n - sum(targets.values())
    for f in list(targets):
        if rem <= 0:
            break
        targets[f] += 1
        rem -= 1
    counts = {f: 0 for f in want}
    cases, skipped = [], 0
    for row in rows:
        if all(counts[f] >= targets[f] for f in want):
            break
        try:
            gt = json.loads(row["ground_truth"]) if isinstance(row["ground_truth"], str) else row["ground_truth"]
            parse, lines = gt.get("gt_parse", {}), gt.get("valid_line", [])
            meta_size = (gt.get("meta", {}).get("image_size") or {})
            img = _row_image(row)
            size = (meta_size.get("width") or img.width, meta_size.get("height") or img.height)
        except Exception:
            skipped += 1
            continue

        made = False
        if "menu_list" in want and counts["menu_list"] < targets["menu_list"]:
            items = _menu_items(parse)
            box = _union_box_prefix(lines, "menu.", size) if items else None
            if items and 1 <= len(items) <= 12 and box:
                counts["menu_list"] += 1
                cid = f"cord_menu_{counts['menu_list']:02d}"
                path, size_out = _save_case_image(img, cid, out_dir)
                answer_obj = {"items": items}
                cases.append(dict(
                    id=cid,
                    family="menu_list",
                    question=MENU_LIST_QUESTION,
                    answer=json.dumps(answer_obj, ensure_ascii=False),
                    answer_type="menu_list",
                    distractor=json.dumps({"items": items[:1]}, ensure_ascii=False),
                    truth_box=box,
                    menu=items,
                    size=size_out,
                    image=str(path.relative_to(ROOT)),
                    source="CORD v2 (CC BY 4.0)",
                ))
                made = True

        if not made and "unanswerable" in want and counts["unanswerable"] < targets["unanswerable"]:
            absent = _absent_fields(parse, lines)
            if absent:
                key, label = rng.choice(absent)
                counts["unanswerable"] += 1
                cid = f"cord_unans_{counts['unanswerable']:02d}"
                path, size_out = _save_case_image(img, cid, out_dir)
                # A number that appears on the receipt, to tempt fabrication.
                amounts = [a for a in _amounts_on_receipt(parse) if core._amount(a) is not None]
                distractor = rng.choice(amounts) if amounts else "0"
                cases.append(dict(
                    id=cid,
                    family="unanswerable",
                    question=(
                        f"What is the {label} on this receipt? "
                        'Answer with the number only, or "not shown" if the receipt does not print it.'
                    ),
                    answer="not shown",
                    answer_type="unanswerable",
                    distractor=distractor,
                    truth_box=None,
                    unanswerable_field=key,
                    size=size_out,
                    image=str(path.relative_to(ROOT)),
                    source="CORD v2 (CC BY 4.0)",
                ))
                made = True

        if not made:
            skipped += 1

    # Interleave families so --limit N still sees both types.
    by_fam: dict[str, list] = {}
    for c in cases:
        by_fam.setdefault(c["family"], []).append(c)
    interleaved = []
    fams = [f for f in ("menu_list", "unanswerable") if f in by_fam]
    while any(by_fam[f] for f in fams):
        for f in fams:
            if by_fam[f]:
                interleaved.append(by_fam[f].pop(0))
    cases = interleaved

    out_path = DATA / "cases_cord_lists.json"
    out_path.write_text(json.dumps(cases, indent=2))
    if verbose:
        print(f"built {len(cases)} list/unanswerable cases ({counts}); skipped {skipped}")
        print(f"wrote {out_path} and images in {out_dir}")
    return cases


def build_cases(rows, n=30, seed=7, out_dir=IMG_DIR, verbose=True, families=("fields",)):
    families = tuple(families) or ("fields",)
    if set(families) == {"fields"}:
        return build_field_cases(rows, n=n, seed=seed, out_dir=out_dir, verbose=verbose)
    # list families (ignore "fields" if mixed with list types)
    list_fams = tuple(f for f in families if f in ("menu_list", "unanswerable"))
    if not list_fams:
        list_fams = ("menu_list", "unanswerable")
    return build_list_cases(rows, n=n, seed=seed, families=list_fams, out_dir=out_dir, verbose=verbose)


def _load_cord_rows():
    """Load CORD test split; fall back to reading the cached arrow stream if HF lock fails."""
    try:
        from datasets import load_dataset
        return load_dataset("naver-clova-ix/cord-v2", split="test")
    except Exception as e:
        import pyarrow as pa

        cache = (
            Path.home()
            / ".cache/huggingface/datasets/naver-clova-ix___cord-v2/default/0.0.0"
        )
        arrow = next(cache.glob("**/cord-v2-test.arrow"), None)
        if arrow is None:
            raise SystemExit(f"Could not load CORD dataset ({e})") from e
        with pa.memory_map(str(arrow), "r") as source:
            tbl = pa.ipc.open_stream(source).read_all()
        rows = []
        for i in range(tbl.num_rows):
            rows.append(
                {
                    "ground_truth": tbl.column("ground_truth")[i].as_py(),
                    "image": tbl.column("image")[i].as_py(),
                }
            )
        return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument(
        "--families",
        default="fields",
        help="comma-separated: fields (default), menu_list, unanswerable",
    )
    ap.add_argument("--inspect", action="store_true", help="print the raw structure of one row and exit")
    args = ap.parse_args()
    families = tuple(f.strip() for f in args.families.split(",") if f.strip()) or ("fields",)
    try:
        rows = _load_cord_rows()
    except SystemExit:
        raise
    except ImportError:
        raise SystemExit("Run: pip install -r requirements-data.txt")
    if args.inspect:
        row = rows[0]
        gt = json.loads(row["ground_truth"]) if isinstance(row["ground_truth"], str) else row["ground_truth"]
        print("row keys        :", list(row.keys()))
        print("ground_truth keys:", list(gt.keys()))
        print("meta            :", gt.get("meta"))
        print("gt_parse keys   :", list(gt.get("gt_parse", {}).keys()))
        print("total / sub_total:", gt.get("gt_parse", {}).get("total"), gt.get("gt_parse", {}).get("sub_total"))
        vl = gt.get("valid_line", [])
        print("valid_line count:", len(vl))
        if vl:
            print("first valid_line:", json.dumps(vl[0])[:400])
        img = _row_image(row)
        print("image size      :", img.size)
        return
    build_cases(rows, n=args.n, seed=args.seed, families=families)


if __name__ == "__main__":
    main()
