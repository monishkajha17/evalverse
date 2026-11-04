"""EvalVerse Python SDK — thin, non-blocking client for the local API."""

from __future__ import annotations

import atexit
import logging
import os
import queue
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx

log = logging.getLogger("evalverse.sdk")

_DEFAULT_URL = "http://127.0.0.1:8000"
_QUEUE_SIZE = 256
_BATCH_SIZE = 16
_FLUSH_INTERVAL = 0.25


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    try:
        return str(obj)
    except Exception:
        return repr(obj)


class _Sender:
    """Background worker: bounded queue, batching, retries with backoff."""

    def __init__(self, client: "EvalVerse"):
        self.client = client
        self.q: queue.Queue = queue.Queue(maxsize=_QUEUE_SIZE)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="evalverse-sender", daemon=True)
        self._thread.start()

    def enqueue(self, item: dict[str, Any]) -> None:
        try:
            self.q.put_nowait(item)
        except queue.Full:
            log.warning("EvalVerse SDK queue full; dropping telemetry event")

    def flush(self, timeout: float = 10.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.q.empty() and not getattr(self, "_busy", False):
                # Give in-flight batch a moment.
                time.sleep(0.05)
                if self.q.empty() and not getattr(self, "_busy", False):
                    return
            time.sleep(0.05)
        log.warning("EvalVerse SDK flush timed out with %s events pending", self.q.qsize())

    def shutdown(self) -> None:
        self.flush(timeout=5)
        self._stop.set()
        self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop.is_set():
            batch: list[dict[str, Any]] = []
            try:
                item = self.q.get(timeout=_FLUSH_INTERVAL)
                batch.append(item)
            except queue.Empty:
                continue
            while len(batch) < _BATCH_SIZE:
                try:
                    batch.append(self.q.get_nowait())
                except queue.Empty:
                    break
            self._busy = True
            try:
                for ev in batch:
                    self._dispatch(ev)
            finally:
                self._busy = False
                for _ in batch:
                    self.q.task_done()

    def _dispatch(self, ev: dict[str, Any]) -> None:
        kind = ev.get("kind")
        try:
            if kind == "create_trace":
                self._with_retries("POST", "/api/v1/traces", json=ev["payload"])
            elif kind == "patch_trace":
                self._with_retries(
                    "PATCH", f"/api/v1/traces/{ev['trace_id']}", json=ev["payload"]
                )
            elif kind == "add_spans":
                self._with_retries(
                    "POST",
                    f"/api/v1/traces/{ev['trace_id']}/spans",
                    json={"spans": ev["spans"]},
                )
            elif kind == "upload_and_attach":
                self._upload_and_attach(ev)
            elif kind == "add_events":
                self._with_retries(
                    "POST",
                    f"/api/v1/traces/{ev['trace_id']}/events",
                    json={"events": ev["events"]},
                )
        except Exception as exc:  # noqa: BLE001 — never raise into caller
            log.warning("EvalVerse SDK send failed (%s): %s", kind, exc)

    def _upload_and_attach(self, ev: dict[str, Any]) -> None:
        path = Path(ev["path"])
        data = path.read_bytes()
        files = {"file": (path.name, data)}
        form = {"modality": ev.get("modality") or "image"}
        if ev.get("parent_id"):
            form["parent_id"] = ev["parent_id"]
        if ev.get("transformation") is not None:
            import json as _json

            form["transformation"] = (
                ev["transformation"]
                if isinstance(ev["transformation"], str)
                else _json.dumps(ev["transformation"])
            )
        media = self._with_retries("POST", "/api/v1/media", files=files, data=form)
        if not media or "id" not in media:
            return
        self._with_retries(
            "PATCH",
            f"/api/v1/traces/{ev['trace_id']}",
            json={
                "media": [
                    {
                        "media_id": media["id"],
                        "role": ev.get("role") or "input",
                        "span_id": ev.get("span_id"),
                    }
                ]
            },
        )

    def _with_retries(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        last: Exception | None = None
        for attempt in range(3):
            try:
                return self.client._request(method, path, json=json, files=files, data=data)
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(0.2 * (2**attempt))
        raise RuntimeError(f"failed after retries: {last}")


class SpanHandle:
    def __init__(
        self,
        trace: "TraceHandle",
        *,
        name: str,
        type: str = "custom",
        model: str | None = None,
        input: Any = None,
        parent_ids: list[str] | None = None,
        span_id: str | None = None,
    ):
        self.trace = trace
        self.id = span_id or uuid.uuid4().hex[:12]
        self.name = name
        self.type = type
        self.model = model
        self.input = input
        self.parent_ids = list(parent_ids) if parent_ids is not None else []
        self.output: Any = None
        self.usage: dict[str, Any] | None = None
        self.status = "running"
        self.error: str | None = None
        self.started_at = _now()
        self.ended_at: str | None = None
        self.latency_ms: float | None = None
        self.attributes: dict[str, Any] = {}
        self._t0 = time.time()

    def set_output(self, output: Any = None, **kwargs: Any) -> None:
        if kwargs and output is None:
            self.output = kwargs
        elif kwargs:
            self.output = {"value": output, **kwargs}
        else:
            self.output = output

    def set_usage(
        self,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        **extra: Any,
    ) -> None:
        usage = dict(self.usage or {})
        if input_tokens is not None:
            usage["input_tokens"] = input_tokens
        if output_tokens is not None:
            usage["output_tokens"] = output_tokens
        usage.update(extra)
        self.usage = usage

    def tool_call(
        self,
        name: str,
        arguments: Any,
        result: Any = None,
    ) -> "SpanHandle":
        child = SpanHandle(
            self.trace,
            name=name,
            type="tool",
            input={"arguments": arguments},
            parent_ids=[self.id],
        )
        child.output = {"result": result} if result is not None else None
        child.status = "completed"
        child.ended_at = _now()
        child.latency_ms = 0.0
        self.trace._register_span(child)
        self.trace._queue_span(child)
        return child

    def event(
        self,
        label: str,
        start_ms: float | int | None,
        end_ms: float | int | None,
        source: str = "sdk",
        media: str | None = None,
        speaker: str | None = None,
        time_base: str = "media",
        payload: Any = None,
    ) -> None:
        """Record a temporal event on this span (queued to the platform)."""
        self.trace._ensure_created()
        self.trace.client._enqueue(
            {
                "kind": "add_events",
                "trace_id": self.trace.id,
                "events": [
                    {
                        "client_id": uuid.uuid4().hex,
                        "span_id": self.id,
                        "media_id": media,
                        "source": source or "sdk",
                        "label": label,
                        "speaker": speaker,
                        "start_ms": float(start_ms) if start_ms is not None else None,
                        "end_ms": float(end_ms) if end_ms is not None else None,
                        "time_base": time_base or "media",
                        "payload": _jsonable(payload) if payload is not None else None,
                    }
                ],
            }
        )

    def _finish(self, *, failed: bool = False, error: str | None = None) -> None:
        self.ended_at = _now()
        self.latency_ms = (time.time() - self._t0) * 1000.0
        if failed:
            self.status = "failed"
            self.error = error
        elif self.status == "running":
            self.status = "completed"

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "parent_ids": self.parent_ids,
            "type": self.type,
            "name": self.name,
            "status": self.status,
            "model": self.model,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "latency_ms": self.latency_ms,
            "usage": self.usage,
            "input": _jsonable(self.input),
            "output": _jsonable(self.output),
            "attributes": self.attributes or None,
            "error": self.error,
        }


class TraceHandle:
    def __init__(
        self,
        client: "EvalVerse",
        *,
        name: str,
        session_id: str | None = None,
        agent: str | None = None,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ):
        self.client = client
        self.id = uuid.uuid4().hex
        self.name = name
        self.session_id = session_id
        self.agent = agent
        self.input = input
        self.metadata = metadata or {}
        self.tags = tags or []
        self.output: Any = None
        self.status = "running"
        self.started_at = _now()
        self.ended_at: str | None = None
        self._span_stack: list[SpanHandle] = []
        self._spans: dict[str, SpanHandle] = {}
        self._created = False

    def set_output(self, output: Any = None, **kwargs: Any) -> None:
        if kwargs and output is None:
            self.output = kwargs
        elif kwargs:
            self.output = {"value": output, **kwargs}
        else:
            self.output = output

    def media(
        self,
        path: str | Path,
        role: str = "input",
        *,
        modality: str = "image",
        parent_id: str | None = None,
        transformation: Any = None,
        span_id: str | None = None,
    ) -> None:
        self._ensure_created()
        self.client._enqueue(
            {
                "kind": "upload_and_attach",
                "trace_id": self.id,
                "path": str(path),
                "role": role,
                "modality": modality,
                "parent_id": parent_id,
                "transformation": transformation,
                "span_id": span_id,
            }
        )

    @contextmanager
    def span(
        self,
        name: str,
        type: str = "custom",
        model: str | None = None,
        input: Any = None,
        parent_ids: list[str] | None = None,
    ) -> Iterator[SpanHandle]:
        self._ensure_created()
        if parent_ids is None:
            parent_ids = [self._span_stack[-1].id] if self._span_stack else []
        handle = SpanHandle(
            self,
            name=name,
            type=type,
            model=model,
            input=input,
            parent_ids=parent_ids,
        )
        self._register_span(handle)
        # Post the span immediately so children can reference it as a parent.
        self._queue_span(handle)
        self._span_stack.append(handle)
        try:
            yield handle
            handle._finish(failed=False)
        except Exception as exc:
            handle._finish(failed=True, error=f"{exc.__class__.__name__}: {exc}")
            self._queue_span(handle)
            raise
        else:
            self._queue_span(handle)
        finally:
            if self._span_stack and self._span_stack[-1] is handle:
                self._span_stack.pop()

    def _register_span(self, span: SpanHandle) -> None:
        self._spans[span.id] = span

    def _queue_span(self, span: SpanHandle) -> None:
        self.client._enqueue(
            {"kind": "add_spans", "trace_id": self.id, "spans": [span.to_payload()]}
        )

    def _ensure_created(self) -> None:
        if self._created:
            return
        self._created = True
        self.client._enqueue(
            {
                "kind": "create_trace",
                "payload": {
                    "id": self.id,
                    "session_id": self.session_id,
                    "name": self.name,
                    "agent": self.agent,
                    "status": "running",
                    "input": _jsonable(self.input),
                    "metadata": self.metadata,
                    "tags": self.tags,
                    "source": "sdk",
                    "started_at": self.started_at,
                },
            }
        )

    def _finalize(self, *, failed: bool = False) -> None:
        self._ensure_created()
        self.ended_at = _now()
        self.status = "failed" if failed else "completed"
        self.client._enqueue(
            {
                "kind": "patch_trace",
                "trace_id": self.id,
                "payload": {
                    "status": self.status,
                    "output": _jsonable(self.output),
                    "ended_at": self.ended_at,
                },
            }
        )


class EvalVerse:
    """Client for the EvalVerse platform API."""

    def __init__(
        self,
        api_url: str = _DEFAULT_URL,
        api_key: str | None = None,
        project: str = "default",
        *,
        client: httpx.Client | None = None,
        transport: httpx.BaseTransport | None = None,
        sync: bool | None = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key if api_key is not None else os.environ.get("EVALVERSE_API_KEY", "dev")
        self.project = project
        self._owns_client = client is None
        self._local = threading.local()
        # sync=True sends on the calling thread (needed for TestClient / ASGI in-process).
        if sync is None:
            sync = os.environ.get("EVALVERSE_SDK_SYNC", "").lower() in ("1", "true", "yes")
        self._sync = bool(sync)
        if client is not None:
            self._http = client
        else:
            kwargs: dict[str, Any] = {"base_url": self.api_url, "timeout": 30.0}
            if transport is not None:
                kwargs["transport"] = transport
            self._http = httpx.Client(**kwargs)
        self._sender = _Sender(self)
        atexit.register(self._atexit)

    def _enqueue(self, item: dict[str, Any]) -> None:
        if self._sync:
            try:
                self._sender._dispatch(item)
            except Exception as exc:  # noqa: BLE001
                log.warning("EvalVerse SDK send failed (%s): %s", item.get("kind"), exc)
        else:
            self._sender.enqueue(item)

    def _push_trace(self, tr: TraceHandle) -> None:
        stack = getattr(self._local, "traces", None)
        if stack is None:
            stack = []
            self._local.traces = stack
        stack.append(tr)

    def _pop_trace(self, tr: TraceHandle) -> None:
        stack = getattr(self._local, "traces", None) or []
        if stack and stack[-1] is tr:
            stack.pop()

    def _ambient_trace(self) -> TraceHandle | None:
        stack = getattr(self._local, "traces", None) or []
        return stack[-1] if stack else None

    def _atexit(self) -> None:
        try:
            self.flush(timeout=5)
        except Exception:
            pass

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "X-Project": self.project,
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        files: Any = None,
        data: Any = None,
    ) -> Any:
        headers = self._headers()
        # Let httpx set multipart Content-Type when files are present.
        r = self._http.request(
            method,
            path if path.startswith("http") else path,
            headers=headers,
            json=json if files is None else None,
            files=files,
            data=data,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    @contextmanager
    def trace(
        self,
        name: str,
        session_id: str | None = None,
        agent: str | None = None,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> Iterator[TraceHandle]:
        handle = TraceHandle(
            self,
            name=name,
            session_id=session_id,
            agent=agent,
            input=input,
            metadata=metadata,
            tags=tags,
        )
        self._push_trace(handle)
        try:
            yield handle
        except Exception:
            handle._finalize(failed=True)
            raise
        else:
            handle._finalize(failed=False)
        finally:
            self._pop_trace(handle)

    def observe(
        self,
        type: str = "custom",
        name: str | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator capturing args, return value and timing as a span."""

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            span_name = name or fn.__name__

            @wraps(fn)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                ambient = self._ambient_trace()
                payload_in = {"args": _jsonable(args), "kwargs": _jsonable(kwargs)}
                if ambient is not None:
                    with ambient.span(span_name, type=type, input=payload_in) as sp:
                        result = fn(*args, **kwargs)
                        sp.set_output(_jsonable(result))
                        return result

                with self.trace(name=span_name, agent=span_name) as tr:
                    with tr.span(span_name, type=type, input=payload_in) as sp:
                        result = fn(*args, **kwargs)
                        sp.set_output(_jsonable(result))
                        return result

            return wrapper

        return decorator

    def flush(self, timeout: float = 10.0) -> None:
        try:
            self._sender.flush(timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            log.warning("EvalVerse SDK flush error: %s", exc)

    def get_trace(self, trace_id: str) -> Any:
        try:
            return self._request("GET", f"/api/v1/traces/{trace_id}")
        except Exception as exc:  # noqa: BLE001
            log.warning("EvalVerse SDK get_trace failed: %s", exc)
            return None

    def evaluate(
        self,
        trace_id: str | None = None,
        evaluators: list[str] | None = None,
        *,
        wait: bool = True,
        timeout: float = 60.0,
        poll: float = 0.2,
        filter: dict[str, Any] | None = None,
        dataset_item_id: str | None = None,
        **kwargs: Any,
    ) -> Any:
        # Back-compat: evaluate(trace=..., evaluators=...)
        if trace_id is None:
            trace_id = kwargs.get("trace") or kwargs.get("trace_id")
        eids = evaluators or kwargs.get("evaluators") or []
        body: dict[str, Any] = {"evaluator_ids": list(eids)}
        if trace_id:
            body["trace_ids"] = [trace_id]
        if filter:
            body["filter"] = filter
        if dataset_item_id:
            body["dataset_item_id"] = dataset_item_id
        try:
            run = self._request("POST", "/api/v1/evaluations", json=body)
        except Exception as exc:  # noqa: BLE001
            log.warning("EvalVerse SDK evaluate failed: %s", exc)
            return None
        if not wait or not run:
            return run
        run_id = run.get("id")
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                detail = self._request("GET", f"/api/v1/evaluations/{run_id}")
            except Exception as exc:  # noqa: BLE001
                log.warning("EvalVerse SDK evaluate poll failed: %s", exc)
                return run
            status = (detail or {}).get("status")
            if status in ("completed", "partial", "failed"):
                return detail
            time.sleep(poll)
        log.warning("EvalVerse SDK evaluate timed out waiting for %s", run_id)
        return detail if "detail" in locals() else run

    def create_evaluator(self, spec: dict[str, Any]) -> Any:
        try:
            return self._request("POST", "/api/v1/evaluators", json=spec)
        except Exception as exc:  # noqa: BLE001
            log.warning("EvalVerse SDK create_evaluator failed: %s", exc)
            return None

    def promote(
        self,
        trace_id: str,
        dataset: str,
        expectation: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> Any:
        try:
            return self._request(
                "POST",
                f"/api/v1/traces/{trace_id}/promote",
                json={"dataset_id": dataset, "expectation": expectation, "tags": tags},
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("EvalVerse SDK promote failed: %s", exc)
            return None

    def results(self, trace_id: str) -> Any:
        try:
            tr = self._request("GET", f"/api/v1/traces/{trace_id}")
            return (tr or {}).get("results") or []
        except Exception as exc:  # noqa: BLE001
            log.warning("EvalVerse SDK results failed: %s", exc)
            return []

    def close(self) -> None:
        try:
            self._sender.shutdown()
        except Exception:
            pass
        if self._owns_client:
            try:
                self._http.close()
            except Exception:
                pass
