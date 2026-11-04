---
title: "Glossary"
description: "Short definitions for the terms used across EvalVerse docs and Studio."
order: 21
group: Concepts
---

# Glossary

**Trace** — The full record of one agent run, including every step and any media it used.

**Span** — One step inside a trace, such as a model call, a tool call, or a media transform. Spans form a graph; a span may list several parents.

**Evaluator** — A check that scores one thing about a run, often against the evidence in the input.

**Evidence** — The place in the input (region, time, or text) that should support the answer.

**Judge** — Another AI that grades answers a simple rule cannot check.

**Offline evaluation** — Running a fixed set of examples against each version of your agent before you ship.

**Online evaluation** — Checking traces from a running agent, usually under a sampling policy.

**Policy** — A rule that picks which live traces to check and which evaluators to run.

**UMS** — Unified Multimodal Score: one number from 0 to 1 that combines the dimensions you choose.

**Confidence interval** — A range that shows how much to trust a score given the sample size.

**Gate** — A pass or fail rule for a release, based on the score and its evidence.

**Variant** — A controlled change to the input (blur, noise, blind / no-media, …) used in offline suites.

**Stage label** — A failure-mode tag such as `grounded_correct` or `correct_ungrounded`. See [Stage labels](/docs/concepts/stage-labels/).

**Dimension** — One scored aspect of a run (perception, groundedness, …). See [Evaluation dimensions](/docs/concepts/evaluation-dimensions/).
