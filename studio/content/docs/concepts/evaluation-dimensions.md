---
title: "Evaluation dimensions"
description: "The six questions EvalVerse asks about every run, plus extra dimensions, and which evaluators measure them."
order: 13
group: Concepts
---

# Evaluation dimensions

A **dimension** is one scored aspect of a run. Scores in a dimension are numbers from 0 to 1 when data exists. If an evaluator cannot run (no tool calls, wrong modality, missing expectation), the dimension stays **unavailable**. Missing is never silently written as zero success.

## The six questions

| Dimension | Question | Typical media |
| --- | --- | --- |
| Perception | Did it read or hear the input correctly? | image, video, voice, text |
| Groundedness | Is the answer backed by a specific place in the input? | image, video, voice, text |
| Temporal grounding | Did it point to the right moment in audio or video? | video, voice |
| Hallucination | Did it say things that are not in the input? | image, video, voice, text |
| Completeness | Did it leave out things it should have mentioned? | image, video, voice, text |
| Reasoning | Given what it saw, did it reach the right conclusion? | image, video, voice, text |

## Extra dimensions tracked in Release 0.1

| Dimension | Question |
| --- | --- |
| Media dependence | Did the agent need the file, or could it guess blind? |
| Robustness | What happens when quality drops (blur, noise, lowres)? |
| Honesty / confident errors | Declining vs confidently wrong |
| Tool use | Schema, args, order, and action-despite-abstention |
| Judge trust | False-accept / false-reject and with-image vs without |
| Failure analysis | Stage labels that explain *how* it failed |

## Which evaluators measure which dimension

Builtins live in `evalverse/evaluators.py`. The important mappings:

| Dimension | Evaluators |
| --- | --- |
| Perception | `answer_correctness`, `perception_judge`, `transcript_fidelity` |
| Groundedness | `evidence_grounding`, `temporal_alignment`, `temporal_alignment_video` |
| Temporal grounding | `temporal_alignment`, `temporal_alignment_video` |
| Hallucination | `fabrication_check` |
| Completeness | `item_recall` |
| Reasoning | `event_order` |
| Media dependence | `media_dependence`, `media_dependence_guess` |
| Robustness | `robustness_sweep` |
| Tool use | `tool_schema_valid`, `tool_args_correct`, `tool_args_grounded`, `tool_order_policy`, `action_despite_abstention` |
| Judge trust | `judge_audit`, `judge_media_dependence` |
| Failure analysis | `stage_attribution`, `audio_stage_attribution` |

See the [evaluator catalogue](/docs/reference/evaluator-catalogue/) for the full list and the [glossary](/docs/concepts/glossary/) for term definitions.

## UMS and missing dimensions

[UMS](/docs/concepts/scores/) (Unified Multimodal Score) combines available dimensions with weights you choose. Dimensions with no data are left out and the weights re-balance. Studio shows the renormalised weights next to the gauge.
