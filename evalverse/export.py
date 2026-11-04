"""Export EvalVerse results + media for Studio.

    python -m evalverse.export --out studio/public/data
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
PAYLOAD_KEYS = (
    "meta",
    "cases",
    "runs",
    "results",
    "dimension_summary",
    "disagreements",
    "registry",
    "judged",
    "traces",
)
WARN_BYTES = 80 * 1024 * 1024
MAX_SIDE = 900
JPEG_QUALITY = 80


def suite_from_results_path(path: Path) -> str:
    stem = path.stem
    if stem == "results":
        return "default"
    if stem.startswith("results_"):
        return stem[len("results_") :]
    return stem


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _human_size(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{int(size)} B" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def _rewrite(obj, mapping: dict[str, str]):
    if isinstance(obj, dict):
        return {k: _rewrite(v, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_rewrite(v, mapping) for v in obj]
    if isinstance(obj, str) and obj in mapping:
        return mapping[obj]
    return obj


def _export_jpeg(src: Path, dest: Path) -> bool:
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        longest = max(w, h)
        if longest > MAX_SIDE:
            scale = MAX_SIDE / longest
            im = im.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )
        im.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return True


def _export_wav(src: Path, dest: Path) -> bool:
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def _resolve(rel: str) -> Path:
    p = Path(rel)
    return p if p.is_absolute() else ROOT / p


def _map_image(rel: str, media_dir: Path, suite: str, mapping: dict[str, str]) -> None:
    if not rel or rel in mapping:
        return
    src = _resolve(rel)
    dest_name = f"{Path(rel).stem}.jpg"
    dest = media_dir / dest_name
    if _export_jpeg(src, dest):
        mapping[rel] = f"/media/{suite}/{dest_name}"


def _map_wav(rel: str, media_dir: Path, suite: str, mapping: dict[str, str]) -> None:
    if not rel or rel in mapping:
        return
    src = _resolve(rel)
    dest_name = Path(rel).name
    dest = media_dir / dest_name
    if _export_wav(src, dest):
        mapping[rel] = f"/media/{suite}/{dest_name}"


def export_suite(results_path: Path, data_dir: Path, media_root: Path) -> dict:
    suite = suite_from_results_path(results_path)
    raw = json.loads(results_path.read_text())
    payload = {k: raw.get(k, [] if k != "meta" else {}) for k in PAYLOAD_KEYS}
    if not isinstance(payload["meta"], dict):
        payload["meta"] = {}

    media_dir = media_root / suite
    media_dir.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}

    cases = payload["cases"] or []
    conditions = list(payload["meta"].get("conditions") or [])

    for case in cases:
        if case.get("image"):
            _map_image(case["image"], media_dir, suite, mapping)
        if case.get("audio"):
            _map_wav(case["audio"], media_dir, suite, mapping)
        for turn in case.get("turns") or []:
            if turn.get("clip"):
                _map_wav(turn["clip"], media_dir, suite, mapping)

        case_id = case.get("id")
        if not case_id:
            continue
        for cond in conditions:
            if cond == "blind":
                continue
            rel = f"out/perturbed/{case_id}_{cond}.png"
            _map_image(rel, media_dir, suite, mapping)

    # Also pick up any asset paths in traces that were not already mapped.
    for tr in payload.get("traces") or []:
        for asset in tr.get("assets") or []:
            path = asset.get("path")
            if not path or path in mapping:
                continue
            if path.lower().endswith((".wav",)):
                _map_wav(path, media_dir, suite, mapping)
            else:
                _map_image(path, media_dir, suite, mapping)

    payload["cases"] = _rewrite(payload["cases"], mapping)
    payload["traces"] = _rewrite(payload["traces"], mapping)

    data_dir.mkdir(parents=True, exist_ok=True)
    out_json = data_dir / f"{suite}.json"
    out_json.write_text(json.dumps(payload, indent=1))

    meta = payload["meta"]
    modality = meta.get("modality")
    if not modality:
        modality = "audio" if any(c.get("modality") == "audio" for c in cases) else "image"

    return {
        "suite": suite,
        "modality": modality,
        "n_cases": len(cases),
        "agents": list(meta.get("agents") or []),
        "variants": list(meta.get("conditions") or []),
        "created": meta.get("created"),
    }


def main():
    ap = argparse.ArgumentParser(description="Export results JSON + media for EvalVerse Studio.")
    ap.add_argument(
        "--out",
        default="studio/public/data",
        help="directory for <suite>.json and index.json (default: studio/public/data)",
    )
    args = ap.parse_args()

    data_dir = Path(args.out)
    if not data_dir.is_absolute():
        data_dir = ROOT / data_dir
    media_root = data_dir.parent / "media"

    results_files = sorted(OUT.glob("results*.json"))
    if not results_files:
        raise SystemExit(f"no results*.json under {OUT}")

    index = []
    for path in results_files:
        entry = export_suite(path, data_dir, media_root)
        index.append(entry)
        print(f"exported suite={entry['suite']}  n_cases={entry['n_cases']}  modality={entry['modality']}")

    (data_dir / "index.json").write_text(json.dumps(index, indent=1))
    print(f"wrote {data_dir / 'index.json'} ({len(index)} suites)")

    total = _dir_size(data_dir) + _dir_size(media_root)
    print(f"total export size: {_human_size(total)} ({total} bytes)")
    if total > WARN_BYTES:
        print(f"WARNING: export exceeds 80 MB ({_human_size(total)})")


if __name__ == "__main__":
    main()
