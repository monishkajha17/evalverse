---
title: "Evidence"
order: 12
group: Concepts
---

# Evidence

Evidence answers: *where did the agent look (or listen) for this answer?*

## Image regions (0–1000)

Boxes are normalised to a 0–1000 coordinate space on the media, independent of pixel size. Convention used across cases and evaluators:

```json
"truth_box": [170, 965, 819, 995]
```

Order is `[x0, y0, x1, y1]` in that normalised space (see CORD cases in `data/cases_cord.json`).

Model spans typically put the claimed box on the span output:

```json
{ "answer": "148,127", "box": [56, 400, 300, 460], "evidence": "total line" }
```

`extract_model_run` in `evalverse/server/engine.py` reads `answer`, `box`, and `evidence` from the first completed model span.

## Structured expectation evidence

Expectations may embed typed evidence:

```json
{
  "answer": "148,127",
  "evidence": {
    "type": "image_region",
    "locator": [170, 965, 819, 995]
  }
}
```

or a list of such objects. `expectation_to_case` maps `image_region` → `truth_box` and `time_span` → `truth_span`.

## Time spans

Audio/video grounding uses time locators (seconds or sample-relative spans depending on the suite). Video Release 0.1 evaluates **timestamped frames**; temporal evaluators such as `temporal_alignment_video` and `event_order` read those annotations from the case/expectation.

## Comparison

`evidence_grounding` compares the claimed box to the truth box (with an optional margin). Right number + wrong box becomes a stage label such as `mislocated`, not a silent pass.
