---
title: "Modalities"
order: 20
group: Concepts
---

# Modalities

Release 0.1 treats three modalities with shared trace/evaluator contracts and modality-specific evaluators.

## Image

Receipts, charts, menus. Primary evidence: 0–1000 boxes. Core evaluators: `answer_correctness`, `evidence_grounding`, `stage_attribution`, tool-use set, list completeness (`item_recall`, `fabrication_check`).

## Audio

Multi-turn conversations with transcripts. Evaluators: `transcript_fidelity`, `temporal_alignment`, `audio_stage_attribution`. Media files are audio assets on the trace; turns appear as spans.

## Video

Stored and judged as **timestamped frames** (plus suite JSON). Evaluators: `temporal_alignment_video`, `event_order`, plus shared perception/robustness where registered. Do not assume a single contiguous video tensor in the judge prompt for 0.1.

## Declaring modality

- Media upload: `modality=image|audio|video`
- Evaluator registry: `modalities: [...]` on each builtin
- Suite index: `studio/public/data/index.json` → `modality` per suite
