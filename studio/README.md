# EvalVerse Studio

Static Next.js (App Router) UI for browsing EvalVerse evaluation exports.

Stack: TypeScript, Tailwind CSS, shadcn-style Radix primitives, lucide-react, recharts.  
No backend — reads only `/data/*.json` and `/media/*` from `public/`.

## Prerequisites

Export evaluation payloads first (from the repo root):

```bash
python -m evalverse.export --out studio/public/data
```

This writes `public/data/index.json`, `public/data/<suite>.json`, and compressed media under `public/media/<suite>/`.

## Run locally

```bash
cd studio
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Route | What you see |
|---|---|
| `/` | Overview KPIs, dimension table, outcome bars, grounded line chart, judge trust |
| `/traces` | Filterable run/trace table |
| `/traces/[id]` | Span waterfall + media / evaluations / prompt tabs |
| `/experiments` | Side-by-side agent comparison + outcome diffs |
| `/datasets` | Case table with drawer detail |
| `/evaluators` | Registry + rubric cards with worked examples |
| `/judge` | Audit stats + disagreements → traces |

## Production build (static export)

```bash
cd studio
npm run build
```

Output is written to `studio/out/` (`output: "export"`). Serve that folder with any static host.

## Deploy on Vercel

1. Push the repo (or just the `studio/` app) to GitHub.
2. In Vercel: **Add New Project** → import the repo.
3. Set **Root Directory** to `studio`.
4. Build command: `npm run build` (default). Output directory: `out`.
5. Before deploy, ensure `public/data` and `public/media` are populated (`python -m evalverse.export --out studio/public/data`).
6. Deploy. No serverless functions or env vars are required for the static UI.

CLI alternative:

```bash
cd studio
npx vercel --prod
```

## Notes

- Suite selection is stored in `localStorage` (`evalverse.suite`).
- Trace ids can collide across suites; switch the suite in the top bar if a detail page looks empty.
- Footer credit: Evaluation data: CORD v2 (CC BY 4.0).
