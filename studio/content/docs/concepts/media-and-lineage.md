---
title: "Media and lineage"
order: 11
group: Concepts
---

# Media and lineage

Media objects are content-addressed per project (`sha256`). Uploading the same bytes twice returns the existing row (`Service.register_media_bytes`).

## Upload and attach

```tabs python|curl
<<<python
with ev.trace(name="receipt") as tr:
    tr.media("data/images_cord/cord_total_01.jpg", role="input", modality="image")
>>>
<<<curl
curl -s -X POST http://127.0.0.1:8000/api/v1/media \
  -H "Authorization: Bearer $EVALVERSE_API_KEY" \
  -H "X-Project: default" \
  -F "file=@data/images_cord/cord_total_01.jpg" \
  -F "modality=image"
>>>
```

Then attach with `media: [{ "media_id", "role", "span_id" }]` on create/patch, or let the SDK enqueue `upload_and_attach`.

## Lineage fields

| Field | Meaning |
| --- | --- |
| `parent_id` | Prior media row (e.g. clean → blurred) |
| `transformation` | JSON or string describing the transform |
| `modality` | `image` \| `audio` \| `video` \| … |
| `url` | `/api/v1/media/{id}/file` |

Offline runs record variant transforms in `VARIANT_TRANSFORM` inside `evalverse/evaluators.py` (`blur` → `gaussian_blur r=5`, `blind` → `remove_media`, …).

## Fetching bytes

Authenticated `GET /api/v1/media/{media_id}/file` streams the file. Studio uses this in Live mode; Snapshot mode serves static files under `/media/`.
