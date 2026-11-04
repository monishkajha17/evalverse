#!/usr/bin/env python3
"""Fill README / LICENSE / pyproject placeholders.

Usage:
  python scripts/fill_readme_links.py --demo URL --name "Full Name"
  python scripts/fill_readme_links.py --demo URL --video URL --name "Full Name"

If --video is omitted, removes the "Demo video" link item and any video
thumbnail / watch-demo block marked with <!-- VIDEO_SECTION --> ... <!-- /VIDEO_SECTION -->.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "README.md",
    ROOT / "LICENSE",
    ROOT / "pyproject.toml",
]


def _strip_video_sections(text: str) -> str:
    # Remove HTML comment-delimited video blocks
    text = re.sub(
        r"<!--\s*VIDEO_SECTION\s*-->.*?<!--\s*/VIDEO_SECTION\s*-->\s*",
        "",
        text,
        flags=re.S | re.I,
    )
    # Remove " · Demo video (...)" or "Demo video (...) · " from link rows
    text = re.sub(
        r"\s*·\s*<a[^>]*>Demo video</a>",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(
        r"<a[^>]*>Demo video</a>\s*·\s*",
        "",
        text,
        flags=re.I,
    )
    # Bare markdown / placeholder forms
    text = re.sub(
        r"\s*·\s*\[Demo video\]\([^)]*\)",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(
        r"\s*·\s*Demo video\s*\(<VIDEO_URL>\)",
        "",
        text,
        flags=re.I,
    )
    text = text.replace("<VIDEO_URL>", "")
    return text


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--demo", required=True, help="Hosted demo base URL")
    ap.add_argument("--video", default=None, help="Demo video URL (optional)")
    ap.add_argument("--name", required=True, help='Copyright / author full name')
    args = ap.parse_args()

    values = {
        "<DEMO_URL>": args.demo.rstrip("/"),
        "<YOUR FULL NAME>": args.name,
    }
    if args.video:
        values["<VIDEO_URL>"] = args.video

    for path in TARGETS:
        if not path.exists():
            print(f"skip missing {path.relative_to(ROOT)}")
            continue
        text = path.read_text()
        original = text
        if not args.video and path.name == "README.md":
            text = _strip_video_sections(text)
        for token, value in values.items():
            text = text.replace(token, value)
        if text != original:
            path.write_text(text)
            print(f"updated {path.relative_to(ROOT)}")
        else:
            print(f"unchanged {path.relative_to(ROOT)}")

    leftover = []
    for path in TARGETS:
        if not path.exists():
            continue
        text = path.read_text()
        for token in ("<DEMO_URL>", "<VIDEO_URL>", "<YOUR FULL NAME>"):
            if token in text:
                leftover.append(f"{path.relative_to(ROOT)}: {token}")
    if leftover:
        print("placeholders remaining:")
        for line in leftover:
            print(f"  {line}")
        return 1
    print("all placeholders replaced" + ("" if args.video else " (video sections stripped)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
