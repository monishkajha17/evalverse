---
title: "Outcome labels"
order: 71
group: Reference
---

# Outcome labels

Labels used in Studio (`studio/src/lib/labels.ts`) and produced by stage / perception evaluators.

| Label | Display | Typical meaning |
| --- | --- | --- |
| `grounded_correct` | grounded correct | Answer and evidence agree with truth |
| `correct_ungrounded` | correct, ungrounded | Answer right; evidence missing or weak |
| `misread` | misread | Answer wrong |
| `mislocated` | mislocated | Answer right; box elsewhere |
| `mistimed` | mistimed | Right content; wrong time span |
| `heard_wrong` | heard wrong | Audio perception error |
| `misunderstood` | misunderstood | Semantic error |
| `abstained` | abstained | Empty / unknown without evidence |
| `invalid_output` | invalid output | Unparseable model output |
| `skipped` | skipped | Evaluator did not run (missing expectation, no tools, …) |

Always read `status` with the label. `skipped` is not a soft pass.
