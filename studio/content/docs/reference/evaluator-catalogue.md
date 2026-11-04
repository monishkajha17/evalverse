---
title: "Evaluator catalogue"
description: "Built-in evaluators from evalverse/evaluators.py with dimension, scope, modalities and version."
order: 70
group: Reference
---

# Evaluator catalogue

Built from the in-process `REGISTRY` in `evalverse/evaluators.py` (Release 0.1). When inputs are missing, evaluators skip or mark not_applicable — missing is never silent zero success.

| ID | Dimension | Scope | Modalities | Version | Needs reference |
| --- | --- | --- | --- | --- | --- |
| `action_despite_abstention` | Tool use | run | image, text | 1.0.0 |  |
| `answer_correctness` | Perception | run | image, video | 1.0.0 | yes |
| `audio_stage_attribution` | Failure analysis | run | audio | 1.0.0 | yes |
| `claim_grounding` | Groundedness | run | image, audio, video | 1.0.0 |  |
| `event_order` | Reasoning | run | video | 1.0.0 | yes |
| `evidence_grounding` | Groundedness | run | image | 1.0.0 | yes |
| `fabrication_check` | Hallucination | run | image | 1.0.0 | yes |
| `item_recall` | Completeness | run | image | 1.0.0 | yes |
| `judge_audit` | Judge trust | suite | image, audio, video | 1.0.0 | yes |
| `judge_media_dependence` | Judge trust | suite | image | 1.0.0 | yes |
| `media_dependence` | Media dependence | pair | image, audio, video | 1.0.0 |  |
| `media_dependence_guess` | Media dependence | pair | audio, video | 1.0.0 |  |
| `perception_judge` | Perception | run | image, video | 1.0.0 |  |
| `robustness_sweep` | Robustness | pair | image, audio, video | 1.0.0 | yes |
| `stage_attribution` | Failure analysis | run | image, video | 1.0.0 | yes |
| `temporal_alignment` | Groundedness | run | audio | 1.0.0 | yes |
| `temporal_alignment_video` | Temporal grounding | run | video | 1.0.0 | yes |
| `tool_args_correct` | Tool use | run | image, text | 1.0.0 | yes |
| `tool_args_grounded` | Tool use | run | image, text | 1.0.0 | yes |
| `tool_order_policy` | Tool use | run | image, text | 1.0.0 |  |
| `tool_schema_valid` | Tool use | run | image, text | 1.0.0 |  |
| `transcript_fidelity` | Perception | run | audio | 1.0.0 | yes |

See [Evaluation dimensions](/docs/concepts/evaluation-dimensions/) and [Create an evaluator](/docs/guides/create-evaluator/).
