#!/usr/bin/env bash
# Regenerate README visual assets (wordmarks, charts, screenshots, optional GIF).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> EvalVerse README assets"
echo "    root: $ROOT"

mkdir -p assets docs/img scripts/readme_assets

# Playwright (devDependency of studio)
if [[ ! -d studio/node_modules/playwright ]]; then
  echo "==> Installing studio deps (playwright)"
  (cd studio && npm install)
fi

# Ensure Chromium is available
(cd studio && npx playwright install chromium >/dev/null)

echo "==> Wordmark / banner SVGs already in assets/ (static)"
echo "==> Rendering PNGs from HTML template"
node scripts/readme_assets/render_wordmark.mjs

echo "==> Charts from out/results_*.json"
if [[ -x .venv/bin/python ]]; then
  .venv/bin/python scripts/readme_assets/charts.py
else
  python3 scripts/readme_assets/charts.py
fi

echo "==> Screenshots (NEXT_PUBLIC_MODE=snapshot, light, signed out)"
node scripts/readme_assets/capture.mjs

echo "==> Inventory"
python3 - <<'PY'
from pathlib import Path
import struct, zlib, re

root = Path(".")
paths = []
for p in sorted(Path("assets").glob("*")) + sorted(Path("docs/img").glob("*")):
    if p.is_file() and p.name != ".capture-skipped.json" and not p.name.startswith("."):
        paths.append(p)

def png_size(path: Path):
    try:
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    except Exception:
        return None

def svg_size(path: Path):
    text = path.read_text(errors="ignore")
    m = re.search(r'width="(\d+)"[^>]*height="(\d+)"', text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', text)
    if m:
        return int(float(m.group(1))), int(float(m.group(2)))
    return None

total = 0
print(f"{'file':<42} {'dims':>14} {'size':>10}")
print("-" * 70)
for p in paths:
    size = p.stat().st_size
    total += size
    dims = None
    if p.suffix.lower() == ".png":
        dims = png_size(p)
    elif p.suffix.lower() == ".svg":
        dims = svg_size(p)
    elif p.suffix.lower() == ".gif":
        dims = ("gif",)
    dim_s = f"{dims[0]}×{dims[1]}" if dims and len(dims) == 2 else (dims[0] if dims else "—")
    print(f"{str(p):<42} {dim_s:>14} {size/1024:8.1f} KB")
print("-" * 70)
print(f"{'TOTAL':<42} {'':>14} {total/1024/1024:8.2f} MB")
if total > 8 * 1024 * 1024:
    raise SystemExit("ERROR: total assets exceed 8 MB")
skipped = Path("docs/img/.capture-skipped.json")
if skipped.exists():
    import json
    items = json.loads(skipped.read_text())
    if items:
        print("\nNot captured:")
        for s in items:
            print(" -", s)
PY

echo "==> Done"
