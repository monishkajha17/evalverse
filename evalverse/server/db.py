"""SQLite persistence for the EvalVerse platform core."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    name TEXT PRIMARY KEY,
    description TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS traces (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    session_id TEXT,
    name TEXT,
    agent TEXT,
    status TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    metadata_json TEXT,
    tags_json TEXT,
    source TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE INDEX IF NOT EXISTS idx_traces_project ON traces(project);
CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(project, session_id);
CREATE INDEX IF NOT EXISTS idx_traces_agent ON traces(project, agent);
CREATE INDEX IF NOT EXISTS idx_traces_status ON traces(project, status);
CREATE INDEX IF NOT EXISTS idx_traces_source ON traces(project, source);

CREATE TABLE IF NOT EXISTS spans (
    id TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    parent_ids_json TEXT,
    type TEXT NOT NULL,
    name TEXT,
    status TEXT,
    model TEXT,
    started_at TEXT,
    ended_at TEXT,
    latency_ms REAL,
    usage_json TEXT,
    input_json TEXT,
    output_json TEXT,
    attributes_json TEXT,
    error TEXT,
    PRIMARY KEY (trace_id, id),
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);

CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    path TEXT NOT NULL,
    mime TEXT,
    size INTEGER,
    modality TEXT,
    parent_id TEXT,
    transformation_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (project, sha256),
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE INDEX IF NOT EXISTS idx_media_project_sha ON media(project, sha256);

CREATE TABLE IF NOT EXISTS trace_media (
    trace_id TEXT NOT NULL,
    span_id TEXT,
    media_id TEXT NOT NULL,
    role TEXT,
    PRIMARY KEY (trace_id, media_id, role),
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media(id)
);

CREATE TABLE IF NOT EXISTS datasets (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (project, name),
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE TABLE IF NOT EXISTS dataset_versions (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    version TEXT NOT NULL,
    content_hash TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (dataset_id, version),
    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dataset_items (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    input_json TEXT,
    expected_json TEXT,
    tags_json TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (version_id) REFERENCES dataset_versions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evaluators (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    dimension TEXT,
    config_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (project, name, version),
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    name TEXT,
    status TEXT,
    config_json TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE TABLE IF NOT EXISTS eval_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    trace_id TEXT,
    evaluator_id TEXT,
    evaluator_version TEXT,
    dimension TEXT,
    status TEXT,
    score REAL,
    verdict TEXT,
    label TEXT,
    explanation TEXT,
    evidence_json TEXT,
    meta_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES eval_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_trace ON eval_results(trace_id);

CREATE TABLE IF NOT EXISTS online_policies (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (project, name),
    FOREIGN KEY (project) REFERENCES projects(name)
);
"""


class Database:
    """Thread-local SQLite connections against a shared file."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._lock = threading.RLock()
        self.init_schema()

    def connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self.path), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            self._local.conn = conn
        return conn

    def init_schema(self) -> None:
        with self._lock:
            conn = self.connect()
            conn.executescript(SCHEMA)
            conn.commit()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self.connect().execute(sql, tuple(params))
            self.connect().commit()
            return cur

    def executemany(self, sql: str, seq: Iterable[Iterable[Any]]) -> sqlite3.Cursor:
        with self._lock:
            cur = self.connect().executemany(sql, list(seq))
            self.connect().commit()
            return cur

    def fetchone(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self.connect().execute(sql, tuple(params)).fetchone()

    def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.connect().execute(sql, tuple(params)).fetchall())

    def transaction(self):
        return _Transaction(self)


class _Transaction:
    def __init__(self, db: Database):
        self.db = db

    def __enter__(self) -> sqlite3.Connection:
        self.db._lock.acquire()
        self.conn = self.db.connect()
        return self.conn

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            if exc_type is None:
                self.conn.commit()
            else:
                self.conn.rollback()
        finally:
            self.db._lock.release()
