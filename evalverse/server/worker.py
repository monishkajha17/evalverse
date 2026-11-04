"""Background evaluation worker pool."""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from evalverse.server.service import Service

log = logging.getLogger("evalverse.server.worker")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class EvalWorkerPool:
    def __init__(
        self,
        service: "Service",
        *,
        size: int | None = None,
        job_timeout_s: float | None = None,
        max_retries: int = 2,
    ):
        self.service = service
        self.size = size if size is not None else int(os.environ.get("EVALVERSE_WORKERS", "4"))
        self.job_timeout_s = (
            job_timeout_s
            if job_timeout_s is not None
            else float(os.environ.get("EVALVERSE_JOB_TIMEOUT", "60"))
        )
        self.max_retries = max_retries
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()
        self.running_count = 0
        self._started = False

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
            for i in range(max(1, self.size)):
                t = threading.Thread(target=self._loop, name=f"eval-worker-{i}", daemon=True)
                t.start()
                self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            job = self.service.claim_next_job()
            if job is None:
                time.sleep(0.05)
                continue
            with self._lock:
                self.running_count += 1
            try:
                self.service.execute_job(job, timeout_s=self.job_timeout_s, max_retries=self.max_retries)
            except Exception as exc:  # noqa: BLE001 — never crash the pool
                log.exception("worker crashed on job %s: %s", job.get("id"), exc)
                try:
                    self.service.fail_job(job["id"], str(exc))
                except Exception:
                    pass
            finally:
                with self._lock:
                    self.running_count -= 1

    def queue_stats(self, project: str | None = None) -> dict[str, int]:
        return self.service.queue_stats(project)
