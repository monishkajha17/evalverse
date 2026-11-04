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


def rewrite_media_paths(obj, mapping: dict[str, str]):
    """Recursively replace exact path strings using *mapping* (old -> new)."""
    if isinstance(obj, dict):
        return {k: rewrite_media_paths(v, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [rewrite_media_paths(v, mapping) for v in obj]
    if isinstance(obj, str) and obj in mapping:
        return mapping[obj]
    return obj


# Back-compat alias used internally.
_rewrite = rewrite_media_paths


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


def _export_mp4(src: Path, dest: Path) -> bool:
    if not src.is_file():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True


def _map_video(rel: str, media_dir: Path, suite: str, mapping: dict[str, str]) -> None:
    if not rel or rel in mapping:
        return
    src = _resolve(rel)
    dest_name = Path(rel).name
    dest = media_dir / dest_name
    if _export_mp4(src, dest):
        mapping[rel] = f"/media/{suite}/{dest_name}"


FRAME_THUMB_SIDE = 320


def _frame_at_ms(video_path: Path, t_ms: int) -> Image.Image | None:
    """Grab the frame nearest to t_ms from an mp4."""
    try:
        import imageio.v2 as imageio
    except ImportError:
        return None
    if not video_path.is_file():
        return None
    reader = imageio.get_reader(str(video_path))
    try:
        meta = reader.get_meta_data()
        fps = float(meta.get("fps") or 10.0)
        idx = max(0, int(round((t_ms / 1000.0) * fps)))
        # Clamp to last frame if needed.
        try:
            n = reader.count_frames()
            if n and idx >= n:
                idx = n - 1
        except Exception:
            pass
        arr = reader.get_data(idx)
        return Image.fromarray(arr).convert("RGB")
    except Exception:
        return None
    finally:
        reader.close()


def _export_frame_thumb(img: Image.Image, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    w, h = img.size
    longest = max(w, h)
    if longest > FRAME_THUMB_SIDE:
        scale = FRAME_THUMB_SIDE / longest
        img = img.resize(
            (max(1, int(w * scale)), max(1, int(h * scale))),
            Image.Resampling.LANCZOS,
        )
    img.save(dest, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return True


def _export_video_frame_thumbs(
    payload: dict,
    media_dir: Path,
    suite: str,
    mapping: dict[str, str],
) -> None:
    """Write JPEG thumbs for every sampled-frame span into media/<suite>/frames/."""
    frames_dir = media_dir / "frames"
    cases_by_id = {c.get("id"): c for c in (payload.get("cases") or []) if c.get("id")}
    for tr in payload.get("traces") or []:
        case_id = tr.get("case_id")
        case = cases_by_id.get(case_id) or {}
        video_rel = case.get("video")
        if not video_rel:
            # Fall back to first video asset on the trace.
            for asset in tr.get("assets") or []:
                if (asset.get("modality") == "video") or str(asset.get("path", "")).endswith(".mp4"):
                    video_rel = asset.get("path")
                    break
        if not video_rel:
            continue
        src = _resolve(video_rel)
        for sp in tr.get("spans") or []:
            name = sp.get("name") or ""
            attrs = sp.get("attributes") or {}
            if not name.startswith("sample frame") and attrs.get("t_ms") is None:
                continue
            t_ms = attrs.get("t_ms")
            if t_ms is None:
                continue
            t_ms = int(t_ms)
            thumb_name = f"{case_id}_{t_ms}.jpg"
            dest = frames_dir / thumb_name
            # Stable synthetic key so traces can reference the thumb if desired.
            key = f"video_frame:{case_id}:{t_ms}"
            if key in mapping and dest.is_file():
                continue
            img = _frame_at_ms(src, t_ms)
            if img is None:
                continue
            if _export_frame_thumb(img, dest):
                mapping[key] = f"/media/{suite}/frames/{thumb_name}"
                # Also stash path on the span for Studio without requiring rewrite.
                attrs = dict(attrs)
                attrs["thumb"] = mapping[key]
                sp["attributes"] = attrs


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
        if case.get("video"):
            _map_video(case["video"], media_dir, suite, mapping)
        for turn in case.get("turns") or []:
            if turn.get("clip"):
                _map_wav(turn["clip"], media_dir, suite, mapping)

        case_id = case.get("id")
        if not case_id:
            continue
        for cond in conditions:
            if cond in ("blind", "blind_guess"):
                continue
            rel = f"out/perturbed/{case_id}_{cond}.png"
            _map_image(rel, media_dir, suite, mapping)

    # Also pick up any asset paths in traces that were not already mapped.
    for tr in payload.get("traces") or []:
        for asset in tr.get("assets") or []:
            path = asset.get("path")
            if not path or path in mapping:
                continue
            lower = path.lower()
            if lower.endswith((".wav",)):
                _map_wav(path, media_dir, suite, mapping)
            elif lower.endswith((".mp4", ".webm", ".mov")):
                _map_video(path, media_dir, suite, mapping)
            else:
                _map_image(path, media_dir, suite, mapping)

    if (payload.get("meta") or {}).get("modality") == "video" or any(
        (c or {}).get("modality") == "video" for c in cases
    ):
        _export_video_frame_thumbs(payload, media_dir, suite, mapping)

    payload["cases"] = _rewrite(payload["cases"], mapping)
    payload["traces"] = _rewrite(payload["traces"], mapping)

    data_dir.mkdir(parents=True, exist_ok=True)
    out_json = data_dir / f"{suite}.json"
    out_json.write_text(json.dumps(payload, indent=1))

    meta = payload["meta"]
    # Default to image unless meta.modality says otherwise.
    modality = meta.get("modality") or "image"

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
