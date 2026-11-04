---
title: Traces
description: Traces endpoints from the EvalVerse OpenAPI document.
order: 132
group: API reference
generated: true
---

# Traces

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/traces

Create Trace

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | null |  |  |
| `session_id` | string | null |  |  |
| `name` | string | null |  |  |
| `agent` | string | null |  |  |
| `status` | enum(running, completed, failed) |  |  |
| `input` | any | null |  |  |
| `output` | any | null |  |  |
| `metadata` | object | null |  |  |
| `tags` | array[string] | null |  |  |
| `source` | enum(sdk, otlp, import) |  |  |
| `started_at` | string | null |  |  |
| `ended_at` | string | null |  |  |
| `spans` | array[object] |  |  |
| `media` | array[object] |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/traces' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "string",
    "source": "string",
    "spans": [],
    "media": []
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/traces

List Traces

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `session_id` | query | string | null |  |  |
| `agent` | query | string | null |  |  |
| `status` | query | string | null |  |  |
| `source` | query | string | null |  |  |
| `q` | query | string | null |  |  |
| `limit` | query | integer |  |  |
| `offset` | query | integer |  |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/traces' \
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

:::endpoint `PATCH` /api/v1/traces/{trace_id}

Patch Trace

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `trace_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `session_id` | string | null |  |  |
| `name` | string | null |  |  |
| `agent` | string | null |  |  |
| `status` | enum(running, completed, failed) | null |  |  |
| `input` | any | null |  |  |
| `output` | any | null |  |  |
| `metadata` | object | null |  |  |
| `tags` | array[string] | null |  |  |
| `ended_at` | string | null |  |  |
| `media` | array[object] | null |  |  |


:::examples

### Request

```bash
curl -s -X PATCH 'http://127.0.0.1:8000/api/v1/traces/{trace_id}' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/traces/{trace_id}

Get Trace

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `trace_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/traces/{trace_id}' \
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

:::endpoint `POST` /api/v1/traces/{trace_id}/spans

Add Spans

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `trace_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `spans` | array[object] |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/traces/{trace_id}/spans' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "spans": []
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `POST` /api/v1/traces/{trace_id}/events

Add Events

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `trace_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `events` | array[object] |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/traces/{trace_id}/events' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "events": []
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/traces/{trace_id}/events

List Trace Events

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `trace_id` | path | string | yes |  |
| `source` | query | string | null |  |  |
| `media_id` | query | string | null |  |  |
| `from_ms` | query | number | null |  |  |
| `to_ms` | query | number | null |  |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/traces/{trace_id}/events' \
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

:::endpoint `POST` /api/v1/traces/{trace_id}/promote

Promote Trace

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `trace_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `dataset_id` | string | yes |  |
| `expectation` | object | object | null |  |  |
| `tags` | array[string] | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/traces/{trace_id}/promote' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "dataset_id": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

