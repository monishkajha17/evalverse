#!/usr/bin/env python3
"""Replace README / LICENSE placeholders for demo URL, video URL, and author name.

Usage:
  python scripts/fill_readme_links.py --demo URL --video URL --name "Full Name"
"""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "README.md",
    ROOT / "LICENSE",
    ROOT / "pyproject.toml",
]

PLACEHOLDERS = {
    "<DEMO_URL>": "demo",
    "<VIDEO_URL>": "video",
    "<YOUR FULL NAME>": "name",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--demo", required=True, help="Hosted demo base URL (no trailing slash preferred)")
    ap.add_argument("--video", required=True, help="Demo video URL")
    ap.add_argument("--name", required=True, help='Copyright / author full name, e.g. "Ada Lovelace"')
    args = ap.parse_args()

    values = {
        "<DEMO_URL>": args.demo.rstrip("/"),
        "<VIDEO_URL>": args.video,
        "<YOUR FULL NAME>": args.name,
    }

    for path in TARGETS:
        if not path.exists():
            print(f"skip missing {path.relative_to(ROOT)}")
            continue
        text = path.read_text()
        original = text
        for token, value in values.items():
            text = text.replace(token, value)
        if text != original:
            path.write_text(text)
            print(f"updated {path.relative_to(ROOT)}")
        else:
            print(f"unchanged {path.relative_to(ROOT)}")

    # Report any leftovers
    leftover = []
    for path in TARGETS:
        if not path.exists():
            continue
        text = path.read_text()
        for token in PLACEHOLDERS:
            if token in text:
                leftover.append(f"{path.relative_to(ROOT)}: {token}")
    if leftover:
        print("placeholders remaining:")
        for line in leftover:
            print(f"  {line}")
        return 1
    print("all placeholders replaced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
