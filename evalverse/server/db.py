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
    updated_at TEXT,
    UNIQUE (project, name),
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE TABLE IF NOT EXISTS evaluator_defs (
    project TEXT NOT NULL,
    evaluator_id TEXT NOT NULL,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT,
    dimension TEXT,
    description TEXT,
    modalities_json TEXT,
    needs_reference INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project, evaluator_id, version)
);

CREATE TABLE IF NOT EXISTS eval_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    project TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    evaluator_id TEXT NOT NULL,
    evaluator_version TEXT NOT NULL,
    dataset_item_id TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    UNIQUE (run_id, trace_id, evaluator_id, evaluator_version),
    FOREIGN KEY (run_id) REFERENCES eval_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_status ON eval_jobs(status);
CREATE INDEX IF NOT EXISTS idx_eval_jobs_run ON eval_jobs(run_id);

CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    policy_id TEXT,
    trace_id TEXT,
    run_id TEXT,
    result_id TEXT,
    dimension TEXT,
    evaluator_id TEXT,
    score REAL,
    threshold REAL,
    webhook_url TEXT,
    webhook_status TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (policy_id, result_id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project);

CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE TABLE IF NOT EXISTS experiment_runs (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL,
    agent TEXT,
    variant TEXT,
    eval_run_id TEXT,
    manifest_json TEXT,
    status TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_experiment_runs_exp ON experiment_runs(experiment_id);

CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    result_id TEXT NOT NULL,
    verdict TEXT NOT NULL,
    label TEXT,
    notes TEXT,
    reviewer TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project);
CREATE INDEX IF NOT EXISTS idx_reviews_result ON reviews(result_id);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS project_members (
    project TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (project, user_id),
    FOREIGN KEY (project) REFERENCES projects(name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

CREATE TABLE IF NOT EXISTS temporal_events (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    span_id TEXT,
    media_id TEXT,
    source TEXT NOT NULL,
    label TEXT,
    speaker TEXT,
    start_ms REAL,
    end_ms REAL,
    time_base TEXT NOT NULL DEFAULT 'media',
    confidence REAL,
    payload_json TEXT,
    client_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_temporal_events_trace ON temporal_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_temporal_events_media_start ON temporal_events(media_id, start_ms);
CREATE UNIQUE INDEX IF NOT EXISTS idx_temporal_events_client
    ON temporal_events(trace_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS playground_runs (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    question TEXT NOT NULL,
    agent_model TEXT,
    judge_model TEXT,
    evaluator_ids_json TEXT,
    conditions_json TEXT,
    mock INTEGER NOT NULL DEFAULT 0,
    files_meta_json TEXT,
    answer_json TEXT,
    trace_ids_json TEXT,
    eval_run_id TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    FOREIGN KEY (project) REFERENCES projects(name)
);

CREATE INDEX IF NOT EXISTS idx_playground_runs_project_created
    ON playground_runs(project, created_at);
CREATE INDEX IF NOT EXISTS idx_playground_runs_status ON playground_runs(status);
"""


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


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
            _ensure_column(conn, "dataset_versions", "locked", "INTEGER NOT NULL DEFAULT 0")
            _ensure_column(conn, "online_policies", "updated_at", "TEXT")
            _ensure_column(conn, "eval_runs", "progress_json", "TEXT")
            _ensure_column(conn, "dataset_items", "expectation_json", "TEXT")
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
