---
title: "Core concepts"
description: "One page that sketches the EvalVerse picture: traces, evidence, evaluators, judges, policies, and scores."
order: 3
group: Start
---

# Core concepts

EvalVerse records what an agent did, checks the answer against the file it was given, and scores the result so you can ship with eyes open.

```
inputs (image / audio / video / text)
        │
        ▼
   your agent ──► Trace (spans + media lineage)
                        │
                        ▼
                 Evaluators (+ optional judge)
                        │
                        ▼
              Results → dimensions → UMS / gate
```

## Trace and spans

A **trace** is one agent run. Inside it, a **span** is one step (model, tool, media, evaluation). Spans form a DAG: a span may list several `parent_ids` when parallel work joins. Details: [Traces and spans](/docs/concepts/traces-and-spans/).

## Media and lineage

EvalVerse keeps the file itself, a hash, and transforms (blur, noise, frame sample). Lineage answers “what did the model actually see?”. Details: [Media and lineage](/docs/concepts/media-and-lineage/).

## Evidence

**Evidence** is a locator: a 0–1000 image region, a time span, or a text span. Evaluators compare claimed evidence to ground truth with documented defaults. Details: [Evidence](/docs/concepts/evidence/).

## Evaluators and results

An **evaluator** returns `status`, `score`, `verdict`, `label`, `explanation`, and `evidence`. Missing data is skipped or marked invalid — never silently scored as zero success. Details: [Evaluators](/docs/concepts/evaluators/).

## Dimensions

We ask six questions (perception, groundedness, temporal grounding, hallucination, completeness, reasoning) plus extras (media dependence, robustness, honesty, tool use, judge trust). Details: [Evaluation dimensions](/docs/concepts/evaluation-dimensions/).

## Judges

A **judge** is a separate model that grades what rules cannot. EvalVerse audits it with planted wrong answers and a no-image control. Details: [Judges](/docs/concepts/judges/).

## Offline vs online

**Offline evaluation** runs a fixed suite before you ship. **Online evaluation** samples live traces under a **policy**. Details: [Offline vs online](/docs/concepts/offline-vs-online/).

## Scores

**UMS** combines available dimensions, always with a **confidence interval** and a release **gate**. Details: [Scores](/docs/concepts/scores/).

## Glossary

Short definitions live in the [glossary](/docs/concepts/glossary/).
