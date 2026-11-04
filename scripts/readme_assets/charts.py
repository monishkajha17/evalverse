#!/usr/bin/env python3
"""Build plain-SVG README charts from out/results_*.json (skips meta.mock)."""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "out"
IMG = ROOT / "docs" / "img"

# Chart colours (readable on white; also fine on GitHub dark via white card)
TEAL = "#0F766E"
CRIMSON = "#BE123C"
INK = "#0F172A"
MUTED = "#64748B"
GRID = "#E2E8F0"
ACCENT = "#0369A1"
AMBER = "#B45309"
PURPLE = "#6D28D9"


def load_suites() -> dict[str, dict]:
    suites: dict[str, dict] = {}
    for path in sorted(OUT.glob("results_*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            continue
        meta = data.get("meta") or {}
        if meta.get("mock") is True:
            print(f"skip mock {path.name}", file=sys.stderr)
            continue
        tag = path.stem.replace("results_", "", 1)
        suites[tag] = data
    return suites


def esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def svg_card(width: int, height: int, body: str, title: str, subtitle: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(title)}">
  <rect width="{width}" height="{height}" rx="16" fill="#FFFFFF" stroke="{GRID}" stroke-width="1"/>
  <text x="28" y="36" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="{INK}">{esc(title)}</text>
  <text x="28" y="56" font-family="Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="{MUTED}">{esc(subtitle)}</text>
  {body}
</svg>
"""


def grouped_bars(
    *,
    groups: list[str],
    series: list[tuple[str, str, list[int]]],
    sample_n: int,
    chart_x: int = 28,
    chart_y: int = 78,
    chart_w: int = 740,
    chart_h: int = 220,
) -> str:
    """series: list of (label, color, values aligned to groups)."""
    n_groups = len(groups)
    n_series = len(series)
    if not n_groups or not n_series:
        return f'<text x="{chart_x}" y="{chart_y + 40}" fill="{MUTED}" font-size="13">No data</text>'

    max_v = max((v for _, _, vals in series for v in vals), default=1) or 1
    gap = 28
    cluster_w = (chart_w - gap * (n_groups - 1)) / n_groups
    bar_gap = 4
    bar_w = max(8.0, (cluster_w - bar_gap * (n_series - 1)) / n_series)

    parts: list[str] = []
    # grid lines
    for i in range(5):
        y = chart_y + chart_h - (chart_h * i / 4)
        val = int(round(max_v * i / 4))
        parts.append(
            f'<line x1="{chart_x}" y1="{y:.1f}" x2="{chart_x + chart_w}" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{chart_x - 8}" y="{y + 4:.1f}" text-anchor="end" font-size="11" fill="{MUTED}" font-family="Inter, sans-serif">{val}</text>'
        )

    for gi, g in enumerate(groups):
        cx = chart_x + gi * (cluster_w + gap)
        for si, (label, color, vals) in enumerate(series):
            v = vals[gi] if gi < len(vals) else 0
            h = (v / max_v) * chart_h if max_v else 0
            x = cx + si * (bar_w + bar_gap)
            y = chart_y + chart_h - h
            parts.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{h:.1f}" rx="3" fill="{color}"/>'
            )
            if v > 0:
                parts.append(
                    f'<text x="{x + bar_w / 2:.1f}" y="{y - 6:.1f}" text-anchor="middle" font-size="11" font-weight="600" fill="{INK}" font-family="Inter, sans-serif">{v}</text>'
                )
        parts.append(
            f'<text x="{cx + cluster_w / 2:.1f}" y="{chart_y + chart_h + 22}" text-anchor="middle" font-size="12" fill="{INK}" font-family="Inter, sans-serif">{esc(g)}</text>'
        )

    # legend
    lx = chart_x
    ly = chart_y + chart_h + 48
    for label, color, _ in series:
        parts.append(f'<rect x="{lx}" y="{ly - 9}" width="10" height="10" rx="2" fill="{color}"/>')
        parts.append(
            f'<text x="{lx + 16}" y="{ly}" font-size="12" fill="{MUTED}" font-family="Inter, sans-serif">{esc(label)}</text>'
        )
        lx += 18 + 7 * len(label) + 28

    parts.append(
        f'<text x="{chart_x + chart_w}" y="{ly}" text-anchor="end" font-size="11" fill="{MUTED}" font-family="Inter, sans-serif">n = {sample_n} per model × condition</text>'
    )
    return "\n  ".join(parts)


def failure_mix(suites: dict[str, dict]) -> str:
    """Receipts under blur / noise / lowres: correct, confidently wrong, could not read."""
    data = suites.get("cord") or suites.get("generated")
    if not data:
        raise SystemExit("need cord or generated results for failure-mix")

    conditions = ["blur", "noise", "lowres"]
    agents = sorted({r["agent"] for r in data["runs"] if r.get("condition") in conditions})
    # Buckets from studio metrics: correct; confidently wrong = incorrect & not abstained; could not read = abstained
    series_defs = [
        ("correct", TEAL),
        ("confidently wrong", CRIMSON),
        ("could not read", AMBER),
    ]
    groups: list[str] = []
    buckets: dict[str, list[int]] = {name: [] for name, _ in series_defs}
    sample_n = 0

    for agent in agents:
        for cond in conditions:
            runs = [r for r in data["runs"] if r["agent"] == agent and r["condition"] == cond]
            if not runs:
                continue
            sample_n = max(sample_n, len(runs))
            short = agent.replace("muse-spark-", "ms")
            groups.append(f"{short} · {cond}")
            correct = sum(1 for r in runs if r.get("correct") is True)
            could = sum(1 for r in runs if r.get("label") == "abstained")
            wrong = sum(1 for r in runs if r.get("correct") is False and r.get("label") != "abstained")
            buckets["correct"].append(correct)
            buckets["confidently wrong"].append(wrong)
            buckets["could not read"].append(could)

    series = [(name, color, buckets[name]) for name, color in series_defs]
    width = max(820, 28 + len(groups) * 110)
    body = grouped_bars(groups=groups, series=series, sample_n=sample_n, chart_w=width - 80)
    suite = "cord" if "cord" in suites else "generated"
    return svg_card(
        width,
        360,
        body,
        "Receipts under blur, noise and low resolution",
        f"Counts per model × condition from results_{suite}.json (skipping blind).",
    )


def audio_stage(suites: dict[str, dict]) -> str:
    data = suites.get("audio")
    if not data:
        raise SystemExit("need audio results for audio-stage")

    agents = sorted({r["agent"] for r in data["runs"] if r.get("condition") == "bandlimit"})
    # Collect all failure labels under bandlimit
    label_set: list[str] = []
    seen = set()
    for agent in agents:
        runs = [r for r in data["runs"] if r["agent"] == agent and r["condition"] == "bandlimit"]
        for r in runs:
            lab = r.get("label") or "other"
            if lab == "grounded_correct":
                lab = "correct"
            if lab not in seen:
                seen.add(lab)
                label_set.append(lab)

    # Prefer stable order: correct first, then failures
    preferred = ["correct", "misunderstood", "mistimed", "abstained", "misread", "other"]
    labels = [l for l in preferred if l in seen] + [l for l in label_set if l not in preferred]
    colors = {
        "correct": TEAL,
        "misunderstood": CRIMSON,
        "mistimed": PURPLE,
        "abstained": AMBER,
        "misread": ACCENT,
        "other": MUTED,
    }

    groups = [a.replace("muse-spark-", "ms") for a in agents]
    series = []
    sample_n = 0
    for lab in labels:
        vals = []
        for agent in agents:
            runs = [r for r in data["runs"] if r["agent"] == agent and r["condition"] == "bandlimit"]
            sample_n = max(sample_n, len(runs))
            key = "grounded_correct" if lab == "correct" else lab
            vals.append(sum(1 for r in runs if (r.get("label") or "other") == key))
        series.append((lab.replace("_", " "), colors.get(lab, MUTED), vals))

    body = grouped_bars(groups=groups, series=series, sample_n=sample_n, chart_w=520)
    return svg_card(
        640,
        340,
        body,
        "Phone-band audio (bandlimit)",
        "Correct and each failure label per model · results_audio.json",
    )


def video_chance(suites: dict[str, dict]) -> str:
    data = suites.get("video")
    if not data:
        raise SystemExit("need video results for video-chance")

    def qkind(cid: str) -> str | None:
        part = (cid or "").split("_")[-1]
        return part if part in ("time", "order", "third") else None

    kinds = ["time", "order", "third"]
    kind_labels = {"time": "time", "order": "event order", "third": "third item"}
    cols = [("clean", "with frames"), ("blind_guess", "no frames (forced guess)")]

    # Accuracy rates 0–100 for grouped bars, plus chance line for order
    groups: list[str] = []
    with_frames: list[int] = []
    no_frames: list[int] = []
    totals_note: list[str] = []
    sample_n = 0

    for kind in kinds:
        for col_id, col_label in cols:
            rs = [
                r
                for r in data["runs"]
                if qkind(r.get("case_id", "")) == kind and r.get("condition") == col_id
            ]
            if not rs:
                continue
            sample_n = max(sample_n, len(rs))
            correct = sum(1 for r in rs if r.get("correct"))
            groups.append(f"{kind_labels[kind]}\n{col_label}" if False else f"{kind_labels[kind]} · {col_label}")
            # Store as percentage counts for readability: print correct/total on bars
            # Use correct count; annotate with % in label via separate text
            if col_id == "clean":
                with_frames.append(correct)
                no_frames.append(0)  # placeholder filled below
            else:
                pass
        # rebuild properly
    groups = []
    series_vals = {"with frames": [], "no frames (forced guess)": []}
    for kind in kinds:
        groups.append(kind_labels[kind])
        for col_id, col_label in cols:
            rs = [
                r
                for r in data["runs"]
                if qkind(r.get("case_id", "")) == kind and r.get("condition") == col_id
            ]
            sample_n = max(sample_n, len(rs))
            correct = sum(1 for r in rs if r.get("correct"))
            series_vals[col_label].append(correct)
            totals_note.append(f"{kind}:{col_id}={correct}/{len(rs)}")

    series = [
        ("with frames (clean)", TEAL, series_vals["with frames"]),
        ("no frames (forced guess)", CRIMSON, series_vals["no frames (forced guess)"]),
    ]

    chart_x, chart_y, chart_w, chart_h = 40, 78, 640, 200
    max_v = max(
        (v for _, _, vals in series for v in vals),
        default=1,
    ) or 1
    # Prefer scale to sample size so 50% chance is meaningful
    max_v = max(max_v, sample_n)

    n_groups = len(groups)
    n_series = 2
    gap = 48
    cluster_w = (chart_w - gap * (n_groups - 1)) / max(n_groups, 1)
    bar_gap = 6
    bar_w = max(16.0, (cluster_w - bar_gap) / n_series)

    parts: list[str] = []
    for i in range(5):
        y = chart_y + chart_h - (chart_h * i / 4)
        val = int(round(max_v * i / 4))
        parts.append(
            f'<line x1="{chart_x}" y1="{y:.1f}" x2="{chart_x + chart_w}" y2="{y:.1f}" stroke="{GRID}" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{chart_x - 8}" y="{y + 4:.1f}" text-anchor="end" font-size="11" fill="{MUTED}" font-family="Inter, sans-serif">{val}</text>'
        )

    # 50% chance line for event order (middle group index 1)
    chance_y = chart_y + chart_h - (0.5 * sample_n / max_v) * chart_h
    # Draw dashed chance across the event-order cluster only
    order_i = groups.index("event order") if "event order" in groups else 1
    ox = chart_x + order_i * (cluster_w + gap)
    parts.append(
        f'<line x1="{ox:.1f}" y1="{chance_y:.1f}" x2="{ox + cluster_w:.1f}" y2="{chance_y:.1f}" stroke="{PURPLE}" stroke-width="1.5" stroke-dasharray="5 4"/>'
    )
    parts.append(
        f'<text x="{ox + cluster_w + 6:.1f}" y="{chance_y + 4:.1f}" font-size="11" fill="{PURPLE}" font-family="Inter, sans-serif">chance 50%</text>'
    )

    for gi, g in enumerate(groups):
        cx = chart_x + gi * (cluster_w + gap)
        for si, (label, color, vals) in enumerate(series):
            v = vals[gi]
            h = (v / max_v) * chart_h
            x = cx + si * (bar_w + bar_gap)
            y = chart_y + chart_h - h
            parts.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w:.1f}" height="{max(h, 0):.1f}" rx="3" fill="{color}"/>'
            )
            parts.append(
                f'<text x="{x + bar_w / 2:.1f}" y="{y - 6:.1f}" text-anchor="middle" font-size="11" font-weight="600" fill="{INK}" font-family="Inter, sans-serif">{v}/{sample_n}</text>'
            )
        parts.append(
            f'<text x="{cx + cluster_w / 2:.1f}" y="{chart_y + chart_h + 22}" text-anchor="middle" font-size="12" fill="{INK}" font-family="Inter, sans-serif">{esc(g)}</text>'
        )

    lx = chart_x
    ly = chart_y + chart_h + 48
    for label, color, _ in series:
        parts.append(f'<rect x="{lx}" y="{ly - 9}" width="10" height="10" rx="2" fill="{color}"/>')
        parts.append(
            f'<text x="{lx + 16}" y="{ly}" font-size="12" fill="{MUTED}" font-family="Inter, sans-serif">{esc(label)}</text>'
        )
        lx += 18 + 7 * len(label) + 24
    parts.append(
        f'<text x="{chart_x + chart_w}" y="{ly}" text-anchor="end" font-size="11" fill="{MUTED}" font-family="Inter, sans-serif">correct / n · n = {sample_n} per type</text>'
    )

    body = "\n  ".join(parts)
    return svg_card(
        760,
        340,
        body,
        "Video questions by type — frames vs forced guess",
        "with frames (clean) vs no frames (blind_guess); dashed chance line at 50% for event order",
    )


def main() -> None:
    IMG.mkdir(parents=True, exist_ok=True)
    suites = load_suites()
    if not suites:
        raise SystemExit(f"no results_*.json found under {OUT}")

    mapping = {
        "failure-mix.svg": failure_mix,
        "audio-stage.svg": audio_stage,
        "video-chance.svg": video_chance,
    }
    for name, fn in mapping.items():
        svg = fn(suites)
        path = IMG / name
        path.write_text(svg)
        print(f"wrote {path.relative_to(ROOT)} ({len(svg.encode())} bytes)")


if __name__ == "__main__":
    main()
