# EvalVerse Studio

Light, dense Langfuse-style UI for EvalVerse — **Live API** or **Snapshot** (`/data/*.json`).

Stack: Next.js App Router, TypeScript, Tailwind, Radix/shadcn-style primitives, lucide-react, recharts.  
Static export (`output: "export"`). Dynamic ids use query routes (`/traces/view?id=…`).

## Env

```bash
# studio/.env.local
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_KEY=dev
NEXT_PUBLIC_MODE=live          # or snapshot
```

- **live** — talks to the EvalVerse server (`Authorization: Bearer …`). If the API is unreachable, Studio falls back to Snapshot and shows a **Snapshot** badge.
- **snapshot** — only `/data/index.json`, `/data/<suite>.json`, `/media/*` (from `python -m evalverse.export`).

Typed client: [`src/lib/api.ts`](src/lib/api.ts) (also re-exported at [`lib/api.ts`](lib/api.ts)).

## Run locally

```bash
# terminal 1 — API
python -m evalverse.server

# terminal 2 — optional snapshot data
python -m evalverse.export --out studio/public/data

# terminal 3 — Studio
cd studio
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Emit a live trace:

```bash
python examples/receipt_agent.py --mock
```

Then open **Traces** with the Live toggle on.

## Routes

| Route | Purpose |
|---|---|
| `/` | Overview (live KPIs or snapshot suite charts) |
| `/sessions/` | Session table |
| `/sessions/view?id=` | Session timeline + thumbnails |
| `/traces/` | Live/snapshot trace table (3s poll) |
| `/traces/view?id=` | Multimodal trace (lineage, evidence, tools, evals) |
| `/evaluators/` | Registry + rubric/rule builder |
| `/evaluations/` | Eval runs + progress |
| `/evaluations/view?id=` | Run detail |
| `/policies/` | Online policies, alerts, queue |
| `/review/` | Review queue + calibration |
| `/datasets/` | Datasets / items / import-export |
| `/experiments/` | Experiments + compare |
| `/judge/` | Snapshot judge audit |

Sidebar: Observe · Evaluate · Data · Judge.

## Production build

```bash
cd studio
npm run build   # writes studio/out/
```

## Vercel

1. Root directory: `studio`
2. Build: `npm run build` → output `out`
3. Set env vars (`NEXT_PUBLIC_API_URL` to your API origin, key, mode)
4. For pure static snapshot hosting, set `NEXT_PUBLIC_MODE=snapshot` and commit `public/data` + `public/media`

## Notes

- Evaluation list endpoint is not in OpenAPI; Studio remembers run ids from Evaluate actions and experiment `eval_run_id`s.
- Footer: Evaluation data: CORD v2 (CC BY 4.0).
