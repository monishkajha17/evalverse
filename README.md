# EvalVerse

**Did the agent actually look at the image?**

Most agent evals grade the final text. For a multimodal agent that is not enough:
a fluent answer can come from a guess, a prior, or the wrong part of the image.
EvalVerse checks the answer *and* the evidence behind it, then tells you where a failure came from.

Built for the Meta Global AI Developer Hackathon on the Meta Model API (Muse Spark).
Everything in this repository was written during the hackathon.

## Three checks

| Check | How it works | Why it matters |
|---|---|---|
| **Evidence check** | The agent must return a box showing where it found the answer. EvalVerse compares it with the known region. | Separates "read the right place wrong" from "looked in the wrong place". |
| **Blind test** | The same question is asked again with no image. Test values are random, so a right answer without the image is luck or leakage. | Shows whether the image was needed at all. |
| **Judge audit** | A vision judge rules on planted answers, some right and some plausible but wrong, where truth is known. | A judge is only useful if you have measured how often it is wrong. |

Every answer lands in one bucket:

- `grounded_correct` right answer, right place
- `correct_ungrounded` right answer, wrong place (suspicious)
- `misread` right place, wrong value (a perception error)
- `mislocated` looked in the wrong place

The same cases are also run on blurred, noisy and low-resolution copies, so you can see
which failure appears first as the image degrades, and compare two model versions side by side.

## Test data

Two suites, used together.

**Controlled suite (synthetic).** 21 images drawn from scratch (receipts, bar charts, pricing cards). Because we draw them,
the answer and the exact region that proves it are known by construction, so they are ideal for controlled experiments
such as blur, noise and the no-image rerun. Rebuild with `python -m evalverse.dataset` from a seed.

**Real suite (CORD receipts).** Photographed restaurant receipts from CORD v2 (NAVER Clova, CC BY 4.0), with word-level boxes
and semantic labels. The answer (total, subtotal, tax) and the region it sits in come from the dataset, not from us.

> CORD: Park et al., "CORD: A Consolidated Receipt Dataset for Post-OCR Parsing", 2019. License: CC BY 4.0.

```bash
pip install -r requirements-data.txt
python -m evalverse.datasets.cord --inspect      # look at the raw structure
python -m evalverse.datasets.cord --n 30         # writes data/cases_cord.json
```

## Run it

```bash
pip install -r requirements.txt
export MODEL_API_KEY="your-key"          # Meta Model API dashboard -> API keys

python -m evalverse.check                                                       # models, text, image, grounding
python -m evalverse.run --limit 2 --conditions clean --agents muse-spark-1.3   # cheap first run
python -m evalverse.run --agents muse-spark-1.1,muse-spark-1.3 --judge muse-spark-1.3
python -m evalverse.report                # writes out/report.html

# real receipts
python -m evalverse.run --cases data/cases_cord.json --tag cord
python -m evalverse.report --tag cord     # writes out/report_cord.html
```

`python -m evalverse.run --mock` runs the whole pipeline offline with fake model behaviour,
which is how the code was tested before spending credits. Mock numbers mean nothing.

Optional: `EVALVERSE_REASONING_EFFORT=low` is passed through to the API if you want faster runs.

## Layout

```
evalverse/dataset.py   draws the controlled images and ground truth
evalverse/datasets/    loaders for real public datasets (CORD receipts)
evalverse/check.py     live API check
evalverse/core.py      prompts, Meta Model API backend, perturbations, checks
evalverse/run.py       agent runs, blind runs, judge runs, judge audit
evalverse/report.py    builds the single-file HTML report
```

## Limits

- 21 cases is a demonstration, not a benchmark. The point is the method.
- Images only for now. Audio and video would add time-aligned evidence (timestamps instead of boxes).
- Boxes come from the model itself, so a box can be right while the reading is wrong; that is exactly the `misread` bucket.
