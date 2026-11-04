---
title: Auth
description: Auth endpoints from the EvalVerse OpenAPI document.
order: 113
group: API reference
generated: true
---

# Auth

Generated from `content/openapi.json` (EvalVerse 0.1.0). Every example includes `Authorization` and `X-Project`.

:::endpoint `POST` /api/v1/auth/register

Register

### Parameters

_None._
### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `password` | string | yes |  |
| `name` | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/auth/register' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "string",
    "password": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `POST` /api/v1/auth/login

Login

### Parameters

_None._
### Request body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `password` | string | yes |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/auth/login' \
  -H 'Authorization: Bearer $EVALVERSE_API_KEY' \
  -H 'X-Project: default' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "string",
    "password": "string"
  }'
```

### Response

```json
{
  "status": "ok"
}
```

:::

:::endpoint `POST` /api/v1/auth/logout

Logout

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X POST 'http://127.0.0.1:8000/api/v1/auth/logout' \
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

:::endpoint `GET` /api/v1/auth/me

Auth Me

### Parameters

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `authorization` | header | string | null |  |  |


:::examples

### Request

```bash
curl -s -X GET 'http://127.0.0.1:8000/api/v1/auth/me' \
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

