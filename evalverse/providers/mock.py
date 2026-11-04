"""Offline mock provider for tests and --mock experiment runs."""

from __future__ import annotations

import json
from typing import Any

from evalverse.providers.base import default_capabilities


class MockProvider:
    name = "mock"

    MODELS = [
        "muse-spark-1.1",
        "muse-spark-1.3",
        "muse-wonder-1.0",
        "muse-voice-transcribe-1.0",
    ]

    def list_models(self) -> list[str]:
        return list(self.MODELS)

    def capabilities(self, model: str) -> dict[str, bool]:
        if "voice" in model or "transcribe" in model:
            return default_capabilities(
                text=False,
                audio_input=True,
                transcription=True,
                structured_output=False,
            )
        return default_capabilities(
            text=True,
            image_input=True,
            grounding=True,
            structured_output=True,
        )

    def generate(
        self,
        model: str,
        content_blocks: list[dict[str, Any]],
        schema: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        text = ""
        n_images = 0
        for b in content_blocks:
            if b.get("type") == "text":
                text += str(b.get("text") or "")
            elif b.get("type") in ("image", "image_url"):
                n_images += 1
        lower = text.lower()
        # Playground / Q&A style prompts
        if "question:" in lower or "transcript" in lower or "video frames" in lower:
            if "total" in lower:
                ans = "12.00"
            elif "describe" in lower:
                ans = "A receipt showing purchased items."
            elif n_images > 1:
                ans = "Event visible across sampled frames."
            elif "transcript" in lower:
                ans = "mock transcript answer"
            else:
                ans = "12.00"
            payload = {"answer": ans, "evidence": "mock", "box": [100, 100, 200, 200]}
            return json.dumps(payload), {"input_tokens": 10, "output_tokens": 5}
        # Tiny deterministic answer for tests.
        payload = {"answer": "12.00", "box": [100, 100, 200, 200], "evidence": "mock"}
        if schema:
            return json.dumps(payload), {"input_tokens": 10, "output_tokens": 5}
        return json.dumps(payload), {"input_tokens": 10, "output_tokens": 5}

    def transcribe(self, audio: bytes, *, model: str | None = None, **kwargs: Any) -> dict[str, Any]:
        # Claim-shaped text so cross_modal_judge / claim_grounding demos extract real claims.
        return {
            "text": "The total on my receipt is 148,127 rupiah.",
            "words": [],
            "model": model or "muse-voice-transcribe-1.0",
        }
