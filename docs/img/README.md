# README images

Screenshots, charts and the optional demo GIF used by the root README.

## Regenerate

From the repository root:

```bash
chmod +x scripts/readme_assets/build.sh
./scripts/readme_assets/build.sh
```

What the build does:

1. **Wordmark / cover** — static SVGs in `assets/wordmark.svg` and `assets/banner.svg`, plus PNGs rendered with Playwright from `scripts/readme_assets/wordmark.html` (`assets/banner.png`, `assets/social-preview.png`).
2. **Charts** — `scripts/readme_assets/charts.py` reads `out/results_*.json` (skips `meta.mock`) and writes `failure-mix.svg`, `audio-stage.svg`, `video-chance.svg`.
3. **Screenshots** — `scripts/readme_assets/capture.mjs` starts Studio with `NEXT_PUBLIC_MODE=snapshot`, light theme, signed out, viewport 1440×900 @2x, and saves PNGs into this folder. Trace IDs are chosen from demo suite labels (`correct_ungrounded`, `mistimed`, parallel audio/video graphs). `cross-modal.png` is only captured when the crossmodal suite has at least 30 cases.
4. **Optional GIF** — `demo.gif` (≤12 s, ≤6 MB) of a trace page (graph → evidence → timeline), recorded with Playwright and converted via `imageio-ffmpeg`.

Requirements: Node deps in `studio/` (including the `playwright` devDependency), Chromium (`npx playwright install chromium`), and the project `.venv` with `imageio-ffmpeg` for the GIF step.

## Inventory

| File | Source |
|---|---|
| `landing-hero.png` | Marketing `/` |
| `home.png` | Studio `/overview/` |
| `trace-evidence.png` | Receipt trace, label `correct_ungrounded` |
| `trace-graph.png` | Audio/video trace with parallel spans → model call |
| `trace-video.png` | Mistimed video trace with timeline |
| `cross-modal.png` | Only if crossmodal suite ≥ 30 cases |
| `evaluators.png` | `/evaluators/` |
| `judge-trust.png` | Judge trust tab |
| `online-evaluation.png` | `/online-evaluation/` |
| `score.png` | Overview scores |
| `playground.png` | `/playground/` |
| `docs.png` | `/docs/overview/` |
| `failure-mix.svg` | Receipt blur/noise/lowres mix |
| `audio-stage.svg` | Phone-band audio labels |
| `video-chance.svg` | Video question types vs chance |
| `demo.gif` | Optional short trace tour |

Do not commit screenshots that show emails, API keys, or live error banners (`error` / `401` / `unreachable` / `Server`). The capture script fails if those appear in page text.
