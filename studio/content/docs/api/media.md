---
title: Media
description: Media endpoints from the EvalVerse OpenAPI document.
order: 121
group: API reference
generated: true
---

# Media

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/media

Upload Media

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

_Non-JSON or multipart body (see OpenAPI)._


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/media' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/media/{media_id}/file

Get Media File

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `media_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/media/{media_id}/file' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/media/{media_id}/events

List Media Events

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `media_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/media/{media_id}/events' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default'
```

### Response

```json
{
  "status": "ok"
}
```

:::

