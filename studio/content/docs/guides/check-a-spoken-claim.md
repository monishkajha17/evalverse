---
title: "Check a spoken claim"
description: "Build a cross-modal dataset, run the suite, read the result, and use the playground cross_check mode."
order: 58
group: Guides
---

# Check a spoken claim

Use this when the agent must decide whether a **spoken or typed claim** matches an **image or video** (for example, a customer reading a receipt total aloud).

## 1. Dataset build

Each case needs:

- `image` (or video) and optional `truth_box`
- `claim_text`, `claim_value`, `claim_channel` (`voice` or `text`)
- `audio` when the channel is voice
- `receipt_value`, `expected_verdict` (`consistent` | `inconsistent`)

See `data/cases_crossmodal.json` and the exported Studio suite `crossmodal`.

## 2. Run

Offline, run the cross-modal plan / agents so each case has a clean run and a `no_image` control. Evaluators on the plan typically include:

- `cross_modal_consistency`
- `cross_modal_perception`
- `cross_modal_stage_attribution`
- `cross_modal_media_dependence`

Export into Studio:

```bash
python -m evalverse.export
```

Then open the **crossmodal** suite in Overview and Traces.

## 3. Read the result

On a trace Media tab:

- **Verdict banner** — agent verdict vs expected, error chip, stage sentence  
- **What was said** — audio or claim text, transcript, said vs heard values  
- **What the receipt shows** — image with teal truth box and crimson agent box  
- **Span DAG** — two roots joining at the model call  

On Overview: verdict accuracy, missed contradictions, false alarms, abstentions; by-variant table; “Where it failed” stack; no-image control with a 50% chance line.

## 4. Playground

In Studio open [/try/](/try/) (redirects to the playground) and switch to **Check voice against image**:

1. Drop an image or video  
2. Drop audio **or** type the claim  
3. POST goes to `/api/v1/playground/runs` with `mode=cross_check`  
4. Results show claims with `supported` / `contradicted` / `not_found` chips and boxes on the image for contradictions  

Recorded example media lives under `/media/crossmodal/` (from `/data`).

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/playground/runs' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -F 'mode=cross_check' \
  -F 'judge_model=muse-wonder-1.0' \
  -F 'text=The total on my receipt is 100,000 rupiah.' \
  -F 'files=@path/to/receipt.jpg'
```
