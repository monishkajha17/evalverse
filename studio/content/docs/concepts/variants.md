---
title: "Variants"
order: 18
group: Concepts
---

# Variants

A **variant** (also called condition) is a controlled corruption or ablation of the input, run with the same case id so paired evaluators can compare.

## Image / shared transforms

From `VARIANT_TRANSFORM` in `evalverse/evaluators.py`:

| Variant | Transform |
| --- | --- |
| `clean` | identity |
| `blur` | gaussian_blur r=5 |
| `noise` | gaussian_noise sigma=70 |
| `lowres` | downscale 0.16 |
| `blind` | remove_media |

`ROBUSTNESS_ORDER = ("blur", "noise", "lowres")` drives `robustness_sweep`.

## Audio

Suites use conditions such as `clean`, `noise`, `bandlimit` (FFT band-limit 300–3400 Hz in the transform table).

## Video

Index metadata lists `clean`, `sparse`, `blur` (and blind-guess style columns in overview helpers). Frames remain the evaluation unit.

## On traces

Store the variant on the trace:

```json
"metadata": { "variant": "blur", "case_id": "cord_total_01" }
```

Offline results key runs as `agent|case_id|variant`.
