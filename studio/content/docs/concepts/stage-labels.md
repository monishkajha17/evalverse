---
title: "Stage labels"
description: "Failure-mode labels such as grounded_correct and correct_ungrounded, with one real example each."
order: 15
group: Concepts
---

# Stage labels

A **stage label** names *how* a run failed or succeeded. It sits on the evaluator result as `label` (and often on the suite run row). Missing data is not labelled as a silent zero success — skipped evaluators say so explicitly.

## Image / document labels

| Label | Meaning | Real example (Release 0.1 cord suite) |
| --- | --- | --- |
| `grounded_correct` | Answer correct and the cited region overlaps the truth | `muse-spark-1.3` · `cord_total_01` · `clean` — answer `148,127` with an overlapping box |
| `correct_ungrounded` | Answer correct, but the cited region misses the truth (“right answer, wrong place”) | `muse-spark-1.3` · `cord_total_05` · `clean` — answer `30.000`, truth box `[505,506,750,534]`, claimed `[632,620,708,658]` |
| `mislocated` | Wrong place emphasis when the suite stages a location error | `muse-spark-1.1` · `cord_subtotal_03` · `lowres` — claimed box far from truth `[269,608,593,627]` |
| `misread` | Answer incorrect | Degraded cord runs under blur/noise/lowres where the number does not match |
| `abstained` | Agent declined (`unknown` / empty) instead of guessing | Blind / no-media cord variants answering `unknown` |
| `invalid_output` | Unparseable model output | Rare; appears when JSON / schema parsing fails |

## Audio / video labels

| Label | Meaning | Real example |
| --- | --- | --- |
| `heard_wrong` | Perception / transcript error | Reserved for transcript fidelity failures when the words were wrong |
| `misunderstood` | Reasoning error with an OK transcript | Phone-quality (`bandlimit`) audio: Muse Spark 1.1 got 6/12 right; the 6 misses were `misunderstood`, not mis-heard |
| `mistimed` | Right content, wrong time span | Video temporal alignment failures when the cited window misses the event |

Always read `status`, `score`, `verdict`, and `label` together. See [Evaluators](/docs/concepts/evaluators/) and the [glossary](/docs/concepts/glossary/).
