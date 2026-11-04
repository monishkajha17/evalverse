"""Pydantic v2 request/response models for the EvalVerse API."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TraceStatus(str, Enum):
    running = "running"
    completed = "completed"
    failed = "failed"


class SpanType(str, Enum):
    agent = "agent"
    model = "model"
    tool = "tool"
    retrieval = "retrieval"
    media = "media"
    evaluation = "evaluation"
    custom = "custom"


class SpanStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class TraceSource(str, Enum):
    sdk = "sdk"
    otlp = "otlp"
    import_ = "import"

    @classmethod
    def _missing_(cls, value):  # noqa: ANN001
        if value == "import":
            return cls.import_
        return None


class MediaAttach(BaseModel):
    model_config = ConfigDict(extra="ignore")

    media_id: str
    role: Optional[str] = "input"
    span_id: Optional[str] = None


class SpanIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    parent_ids: list[str] = Field(default_factory=list)
    type: SpanType = SpanType.custom
    name: str
    status: SpanStatus = SpanStatus.completed
    model: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    latency_ms: Optional[float] = None
    usage: Optional[dict[str, Any]] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    attributes: Optional[dict[str, Any]] = None
    error: Optional[str] = None

    @field_validator("parent_ids", mode="before")
    @classmethod
    def _coerce_parents(cls, v):  # noqa: ANN001
        if v is None:
            return []
        return list(v)


class TraceCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    session_id: Optional[str] = None
    name: Optional[str] = None
    agent: Optional[str] = None
    status: TraceStatus = TraceStatus.running
    input: Optional[Any] = None
    output: Optional[Any] = None
    metadata: Optional[dict[str, Any]] = None
    tags: Optional[list[str]] = None
    source: TraceSource = TraceSource.sdk
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    spans: list[SpanIn] = Field(default_factory=list)
    media: list[MediaAttach] = Field(default_factory=list)


class TracePatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    session_id: Optional[str] = None
    name: Optional[str] = None
    agent: Optional[str] = None
    status: Optional[TraceStatus] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    metadata: Optional[dict[str, Any]] = None
    tags: Optional[list[str]] = None
    ended_at: Optional[str] = None
    media: Optional[list[MediaAttach]] = None


class SpansCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    spans: list[SpanIn] = Field(default_factory=list)


class ScoreSummary(BaseModel):
    count: int = 0
    mean: Optional[float] = None
    by_dimension: dict[str, Any] = Field(default_factory=dict)


class TraceListItem(BaseModel):
    id: str
    project: str
    session_id: Optional[str] = None
    name: Optional[str] = None
    agent: Optional[str] = None
    status: str
    source: str
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    span_count: int = 0
    tool_call_count: int = 0
    latency_ms: Optional[float] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    score_summary: ScoreSummary = Field(default_factory=ScoreSummary)


class SpanOut(BaseModel):
    id: str
    trace_id: str
    parent_ids: list[str] = Field(default_factory=list)
    type: str
    name: Optional[str] = None
    status: Optional[str] = None
    model: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    latency_ms: Optional[float] = None
    usage: Optional[dict[str, Any]] = None
    input: Optional[Any] = None
    output: Optional[Any] = None
    attributes: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class MediaOut(BaseModel):
    id: str
    project: str
    sha256: str
    path: str
    mime: Optional[str] = None
    size: Optional[int] = None
    modality: Optional[str] = None
    parent_id: Optional[str] = None
    transformation: Optional[Any] = None
    created_at: str
    url: Optional[str] = None
    role: Optional[str] = None
    span_id: Optional[str] = None
    created: bool = True


class EvalResultOut(BaseModel):
    id: str
    run_id: str
    trace_id: Optional[str] = None
    evaluator_id: Optional[str] = None
    evaluator_version: Optional[str] = None
    dimension: Optional[str] = None
    status: Optional[str] = None
    score: Optional[float] = None
    verdict: Optional[str] = None
    label: Optional[str] = None
    explanation: Optional[str] = None
    evidence: Optional[Any] = None
    meta: Optional[Any] = None
    created_at: str


class TraceDetail(BaseModel):
    id: str
    project: str
    session_id: Optional[str] = None
    name: Optional[str] = None
    agent: Optional[str] = None
    status: str
    input: Optional[Any] = None
    output: Optional[Any] = None
    metadata: Optional[dict[str, Any]] = None
    tags: list[str] = Field(default_factory=list)
    source: str
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    spans: list[SpanOut] = Field(default_factory=list)
    media: list[MediaOut] = Field(default_factory=list)
    results: list[EvalResultOut] = Field(default_factory=list)
    span_count: int = 0
    tool_call_count: int = 0
    latency_ms: Optional[float] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    score_summary: ScoreSummary = Field(default_factory=ScoreSummary)


class SessionSummary(BaseModel):
    session_id: str
    trace_count: int = 0
    started: Optional[str] = None
    ended: Optional[str] = None
    agents: list[str] = Field(default_factory=list)
    tool_call_count: int = 0
    error_count: int = 0


class SessionDetail(SessionSummary):
    traces: list[TraceListItem] = Field(default_factory=list)


class EvalResultIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    run_id: str
    trace_id: Optional[str] = None
    evaluator_id: Optional[str] = None
    evaluator_version: Optional[str] = None
    dimension: Optional[str] = None
    status: Optional[str] = None
    score: Optional[float] = None
    verdict: Optional[str] = None
    label: Optional[str] = None
    explanation: Optional[str] = None
    evidence: Optional[Any] = None
    meta: Optional[Any] = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[Any] = Field(default_factory=list)


class DatasetCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    description: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class DatasetVersionCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    version: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class EvidenceSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str  # image_region | time_span
    locator: Any
    role: Optional[str] = None


class ExpectationSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")
    answer: Optional[Any] = None
    answer_type: Optional[str] = None
    evidence: Optional[Any] = None
    tolerance: Optional[float] = None
    family: Optional[str] = None
    menu: Optional[Any] = None


class DatasetItemCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    input: Any
    expectation: Optional[ExpectationSpec | dict[str, Any]] = None
    tags: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None
    version_id: Optional[str] = None


class PromoteRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    dataset_id: str
    expectation: Optional[ExpectationSpec | dict[str, Any]] = None
    tags: Optional[list[str]] = None


class EvaluatorCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: str
    name: str
    id: Optional[str] = None
    version: Optional[str] = None
    dimension: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    modalities: Optional[list[str]] = None
    # rubric
    prompt: Optional[str] = None
    attach_media: Optional[bool] = False
    judge_model: Optional[str] = None
    scale: Optional[str] = "pass_fail"
    labels: Optional[list[str]] = None
    pass_threshold: Optional[float] = None
    # rule
    checks: Optional[list[dict[str, Any]]] = None
    rules: Optional[list[dict[str, Any]]] = None


class EvaluatorTestRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    trace_id: str


class EvaluationCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    trace_ids: Optional[list[str]] = None
    filter: Optional[dict[str, Any]] = None
    evaluator_ids: list[str]
    dataset_item_id: Optional[str] = None
    dataset_version_id: Optional[str] = None


class PolicyCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    id: Optional[str] = None
    filter: Optional[dict[str, Any]] = None
    sample_rate: float = 1.0
    evaluator_ids: list[str] = Field(default_factory=list)
    enabled: bool = True
    alert: Optional[dict[str, Any]] = None


class PolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    filter: Optional[dict[str, Any]] = None
    sample_rate: Optional[float] = None
    evaluator_ids: Optional[list[str]] = None
    enabled: Optional[bool] = None
    alert: Optional[dict[str, Any]] = None


class ExperimentAgent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    model: str
    prompt_version: Optional[str] = None


class ExperimentCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    dataset_version_id: str
    agents: list[ExperimentAgent | dict[str, Any] | str]
    variants: list[str] = Field(default_factory=lambda: ["clean"])
    evaluator_ids: list[str] = Field(default_factory=list)
    judge_model: Optional[str] = "muse-spark-1.3"
    mock: bool = False


class ExperimentRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mock: Optional[bool] = None


class ReviewCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    result_id: str
    verdict: str
    label: Optional[str] = None
    notes: Optional[str] = None
    reviewer: Optional[str] = None
