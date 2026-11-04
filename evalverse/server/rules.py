"""Safe declarative rule evaluator — no code execution."""

from __future__ import annotations

import re
from typing import Any

_SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SAFE_INDEX = re.compile(r"^[0-9]+$")
_FORBIDDEN = re.compile(
    r"(__|`|\(|\)|\[|\]|;|\n|\r|\t|import|exec|eval|os\.|sys\.|builtins|class\s)",
    re.IGNORECASE,
)


class RulePathError(ValueError):
    pass


def validate_path(path: str) -> None:
    if not path or not isinstance(path, str):
        raise RulePathError("path must be a non-empty string")
    if _FORBIDDEN.search(path):
        raise RulePathError(f"malicious or unsafe path rejected: {path!r}")
    if ".." in path:
        raise RulePathError(f"malicious or unsafe path rejected: {path!r}")
    for part in path.split("."):
        if not part:
            raise RulePathError(f"empty path segment in {path!r}")
        if not (_SAFE_KEY.match(part) or _SAFE_INDEX.match(part)):
            raise RulePathError(f"unsafe path segment {part!r} in {path!r}")


def dotted_get(root: Any, path: str) -> Any:
    validate_path(path)
    cur = root
    for part in path.split("."):
        if cur is None:
            raise KeyError(path)
        if _SAFE_INDEX.match(part):
            idx = int(part)
            if not isinstance(cur, (list, tuple)) or idx < 0 or idx >= len(cur):
                raise KeyError(path)
            cur = cur[idx]
        elif isinstance(cur, dict):
            if part not in cur:
                raise KeyError(path)
            cur = cur[part]
        else:
            raise KeyError(path)
    return cur


def _check_equals(actual: Any, expected: Any) -> tuple[bool, str]:
    ok = actual == expected
    return ok, f"equals: got {actual!r} expected {expected!r}"


def _check_contains(actual: Any, expected: Any) -> tuple[bool, str]:
    if actual is None:
        return False, "contains: value is None"
    try:
        ok = expected in actual
    except TypeError:
        return False, f"contains: cannot test membership of {expected!r} in {type(actual).__name__}"
    return ok, f"contains: {expected!r} in {actual!r} -> {ok}"


def _check_regex(actual: Any, pattern: str) -> tuple[bool, str]:
    if actual is None:
        return False, "regex: value is None"
    try:
        ok = re.search(pattern, str(actual)) is not None
    except re.error as exc:
        return False, f"regex: invalid pattern ({exc})"
    return ok, f"regex: /{pattern}/ on {actual!r} -> {ok}"


def _check_number_within(actual: Any, expected: Any, tol: float) -> tuple[bool, str]:
    try:
        a = float(actual)
        e = float(expected)
        t = float(tol)
    except (TypeError, ValueError):
        return False, f"number_within: non-numeric actual={actual!r} expected={expected!r}"
    ok = abs(a - e) <= t
    return ok, f"number_within: |{a}-{e}| <= {t} -> {ok}"


def _check_json_schema(actual: Any, schema: dict) -> tuple[bool, str]:
    """Minimal subset: type, required, properties (object), items (array of objects)."""
    try:
        _validate_schema(actual, schema)
        return True, "json_schema: ok"
    except ValueError as exc:
        return False, f"json_schema: {exc}"


def _validate_schema(value: Any, schema: dict) -> None:
    t = schema.get("type")
    if t == "object":
        if not isinstance(value, dict):
            raise ValueError(f"expected object, got {type(value).__name__}")
        for req in schema.get("required") or []:
            if req not in value:
                raise ValueError(f"missing required field {req!r}")
        props = schema.get("properties") or {}
        for k, sub in props.items():
            if k in value:
                _validate_schema(value[k], sub)
    elif t == "array":
        if not isinstance(value, list):
            raise ValueError(f"expected array, got {type(value).__name__}")
        item_schema = schema.get("items")
        if item_schema:
            for i, item in enumerate(value):
                try:
                    _validate_schema(item, item_schema)
                except ValueError as exc:
                    raise ValueError(f"items[{i}]: {exc}") from exc
    elif t == "string":
        if not isinstance(value, str):
            raise ValueError(f"expected string, got {type(value).__name__}")
    elif t == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"expected number, got {type(value).__name__}")
    elif t == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"expected boolean, got {type(value).__name__}")
    elif t == "null":
        if value is not None:
            raise ValueError("expected null")


def _check_field_present(root: Any, path: str) -> tuple[bool, str]:
    try:
        dotted_get(root, path)
        return True, f"field_present: {path}"
    except (KeyError, RulePathError):
        return False, f"field_present: missing {path}"


def run_rules(checks: list[dict], context: dict[str, Any]) -> dict[str, Any]:
    """Execute declarative checks. Returns a result-shaped dict."""
    details = []
    all_ok = True
    for i, check in enumerate(checks or []):
        if not isinstance(check, dict):
            details.append({"index": i, "ok": False, "message": "check must be an object"})
            all_ok = False
            continue
        ctype = check.get("op") or check.get("type") or check.get("check")
        try:
            if ctype == "equals":
                path = check["path"]
                actual = dotted_get(context, path)
                ok, msg = _check_equals(actual, check.get("value"))
            elif ctype == "contains":
                path = check["path"]
                actual = dotted_get(context, path)
                ok, msg = _check_contains(actual, check.get("value"))
            elif ctype == "regex":
                path = check["path"]
                actual = dotted_get(context, path)
                ok, msg = _check_regex(actual, check.get("pattern") or check.get("value") or "")
            elif ctype == "number_within":
                path = check["path"]
                actual = dotted_get(context, path)
                ok, msg = _check_number_within(actual, check.get("value"), check.get("tol", 0))
            elif ctype == "json_schema":
                path = check.get("path")
                actual = dotted_get(context, path) if path else context
                ok, msg = _check_json_schema(actual, check.get("schema") or {})
            elif ctype == "field_present":
                path = check.get("path") or check.get("value")
                ok, msg = _check_field_present(context, path)
            elif ctype == "max_latency_ms":
                path = check.get("path") or "trace.latency_ms"
                try:
                    actual = dotted_get(context, path)
                except KeyError:
                    actual = None
                limit = float(check.get("value") if check.get("value") is not None else check.get("max", 0))
                if actual is None:
                    ok, msg = False, "max_latency_ms: latency missing"
                else:
                    ok = float(actual) <= limit
                    msg = f"max_latency_ms: {actual} <= {limit} -> {ok}"
            else:
                ok, msg = False, f"unknown check op: {ctype!r}"
                # Reject malicious path-like ops early via validate if path present
            if "path" in check and ctype != "json_schema":
                validate_path(str(check["path"]))
        except RulePathError as exc:
            ok, msg = False, str(exc)
            all_ok = False
            details.append({"index": i, "op": ctype, "ok": ok, "message": msg})
            # Malicious path: fail the whole evaluation as error-ish via ok=False
            continue
        except KeyError:
            ok, msg = False, f"path not found: {check.get('path')}"
        except Exception as exc:  # noqa: BLE001
            ok, msg = False, f"check error: {exc}"
        details.append({"index": i, "op": ctype, "ok": ok, "message": msg})
        if not ok:
            all_ok = False

    score = 1.0 if all_ok else 0.0
    return {
        "status": "completed",
        "score": score,
        "verdict": "pass" if all_ok else "fail",
        "label": "pass" if all_ok else "fail",
        "explanation": "; ".join(d["message"] for d in details) or "no checks",
        "evidence": details,
    }


def rules_need_reference(checks: list[dict]) -> bool:
    for check in checks or []:
        if not isinstance(check, dict):
            continue
        path = str(check.get("path") or check.get("value") or "")
        if "expectation" in path.split(".") or path.startswith("expectation"):
            return True
        if "expected" in path.split("."):
            return True
    return False
