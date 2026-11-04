---
title: "Human review and calibration"
order: 55
group: Guides
---

# Human review and calibration

## Review queue

```bash
curl -s http://127.0.0.1:8000/api/v1/reviews/queue \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default"
```

Submit a review:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/reviews \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default" \
  -H "Content-Type: application/json" \
  -d '{
    "result_id": "RESULT_ID",
    "verdict": "agree",
    "label": "grounded_correct",
    "notes": "box overlaps total line",
    "reviewer": "you"
  }'
```

Studio → Review.

## Calibration

```bash
curl -s "http://127.0.0.1:8000/api/v1/calibration?evaluator_id=evidence_grounding" \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default"
```

Returns agreement / kappa style summaries when enough human labels exist (`Calibration` schema in OpenAPI).
