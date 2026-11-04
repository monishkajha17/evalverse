---
title: Datasets
description: Datasets endpoints from the EvalVerse OpenAPI document.
order: 115
group: API reference
generated: true
---

# Datasets

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/datasets

Create Dataset

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `description` | string | null |  |  |
| `metadata` | object | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/datasets' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `GET` /api/v1/datasets

List Datasets

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/datasets' \
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

:::endpoint `GET` /api/v1/datasets/{dataset_id}

Get Dataset

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/datasets/{dataset_id}' \
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

:::endpoint `POST` /api/v1/datasets/{dataset_id}/versions

Create Version

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `version` | string | null |  |  |
| `metadata` | object | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/datasets/{dataset_id}/versions' \
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

:::endpoint `POST` /api/v1/datasets/{dataset_id}/items

Add Item

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | path | string | yes |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |

### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | any | yes |  |
| `expectation` | object | object | null |  |  |
| `tags` | array[string] | null |  |  |
| `metadata` | object | null |  |  |
| `version_id` | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/datasets/{dataset_id}/items' \
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

:::endpoint `GET` /api/v1/datasets/{dataset_id}/items

List Items

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | path | string | yes |  |
| `version_id` | query | string | null |  |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/datasets/{dataset_id}/items' \
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

:::endpoint `GET` /api/v1/datasets/{dataset_id}/export

Export Dataset

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | path | string | yes |  |
| `version_id` | query | string | null |  |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/datasets/{dataset_id}/export' \
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

:::endpoint `POST` /api/v1/datasets/{dataset_id}/import

Import Dataset

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | path | string | yes |  |
| `version_id` | query | string | null |  |  |
| `authorization` | header | string | null |  |  |
| `X-Project` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/datasets/{dataset_id}/import' \
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

