---
title: "Cross-modal consistency"
description: "Whether a spoken or typed claim agrees with what the image or video shows."
order: 35
group: Concepts
---

# Cross-modal consistency

Cross-modal consistency asks: **do the voice, the text and the image agree?** A case pairs a claim (audio or typed text) with a visual (usually a receipt image). The agent must say whether they are `consistent`, `inconsistent`, or `cannot_tell`.

## What is scored

| Evaluator | Role |
| --- | --- |
| `cross_modal_consistency` | Verdict vs expected (`correct_verdict`, `missed_contradiction`, `false_alarm`, `abstained`) |
| `cross_modal_perception` | Did it hear the claim value and read the receipt value? |
| `cross_modal_stage_attribution` | Failure stage: `heard_wrong`, `misread_image`, `comparison_error`, `abstained`, or `cross_modal_correct` |
| `cross_modal_media_dependence` | Clean vs `no_image` — a control near 50% means the receipt was needed |
| `cross_modal_judge` | Online / playground judge: claims graded `supported`, `contradicted`, or `not_found` |

## Trace shape

A typical cross-modal span graph has **two roots** that join:

1. attach receipt image  
2. attach voice clip → transcribe  
3. model call (parents: image + transcript)  
4. evaluation  

Studio’s Media tab shows both sides: what was said (audio / claim text / transcript) and what the receipt shows (image with truth and agent boxes), plus a verdict banner.

## Suite data

Exported snapshot: `studio/public/data/crossmodal.json` (`modality: cross_modal`). See [Check a spoken claim](/docs/guides/check-a-spoken-claim/) for dataset build, run, and playground use.
