"""Provider protocol and shared types."""

from __future__ import annotations

from typing import Any, Optional, Protocol, runtime_checkable


@runtime_checkable
class ModelProvider(Protocol):
    name: str

    def list_models(self) -> list[str]:
        ...

    def capabilities(self, model: str) -> dict[str, bool]:
        """Return modality / feature flags for *model*."""
        ...

    def generate(
        self,
        model: str,
        content_blocks: list[dict[str, Any]],
        schema: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """Return (text, usage)."""
        ...

    def transcribe(
        self,
        audio: bytes,
        *,
        model: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        ...


def default_capabilities(
    *,
    text: bool = True,
    image_input: bool = False,
    audio_input: bool = False,
    video_input: bool = False,
    transcription: bool = False,
    grounding: bool = False,
    segmentation: bool = False,
    structured_output: bool = True,
) -> dict[str, bool]:
    return {
        "text": text,
        "image_input": image_input,
        "audio_input": audio_input,
        "video_input": video_input,
        "transcription": transcription,
        "grounding": grounding,
        "segmentation": segmentation,
        "structured_output": structured_output,
    }
