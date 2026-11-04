"""Meta Model API provider wrapping LiveBackend and ASR."""

from __future__ import annotations

import base64
import time
from typing import Any

from evalverse.providers.base import default_capabilities

# Cached model list: (fetched_at, models)
_MODEL_CACHE: tuple[float, list[str]] | None = None
_CACHE_TTL = 600.0  # 10 minutes

DEFAULT_MODELS = [
    "muse-spark-1.1",
    "muse-spark-1.3",
    "muse-wonder-1.0",
    "muse-voice-transcribe-1.0",
]


class MetaProvider:
    name = "meta"

    def list_models(self) -> list[str]:
        global _MODEL_CACHE
        now = time.time()
        if _MODEL_CACHE and (now - _MODEL_CACHE[0]) < _CACHE_TTL:
            return list(_MODEL_CACHE[1])
        models = list(DEFAULT_MODELS)
        # Live probe is best-effort; keep defaults on failure.
        try:
            import os

            from openai import OpenAI

            from evalverse.core import BASE_URL

            key = os.environ.get("MODEL_API_KEY")
            if key:
                client = OpenAI(base_url=BASE_URL, api_key=key, timeout=15)
                listed = client.models.list()
                ids = [m.id for m in getattr(listed, "data", []) or []]
                if ids:
                    models = sorted(set(ids) | set(DEFAULT_MODELS))
        except Exception:
            pass
        _MODEL_CACHE = (now, models)
        return list(models)

    def capabilities(self, model: str) -> dict[str, bool]:
        m = (model or "").lower()
        if "voice" in m or "transcribe" in m:
            return default_capabilities(
                text=False,
                audio_input=True,
                transcription=True,
                structured_output=False,
            )
        if "spark" in m or "muse" in m:
            return default_capabilities(
                text=True,
                image_input=True,
                grounding=True,
                structured_output=True,
            )
        return default_capabilities(text=True, structured_output=True)

    def generate(
        self,
        model: str,
        content_blocks: list[dict[str, Any]],
        schema: dict[str, Any] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        from evalverse.core import LiveBackend

        backend = LiveBackend()
        prompt_parts: list[str] = []
        images: list[bytes] = []
        for b in content_blocks:
            btype = b.get("type")
            if btype == "text":
                prompt_parts.append(str(b.get("text") or ""))
            elif btype in ("image", "image_url"):
                raw = b.get("bytes") or b.get("data")
                if raw is None and isinstance(b.get("image_url"), dict):
                    url = b["image_url"].get("url") or ""
                    if url.startswith("data:") and "," in url:
                        raw = base64.b64decode(url.split(",", 1)[1])
                if isinstance(raw, str):
                    raw = base64.b64decode(raw)
                if isinstance(raw, (bytes, bytearray)):
                    images.append(bytes(raw))
        prompt = "\n".join(prompt_parts)
        if schema:
            prompt += "\nReply with JSON matching the requested schema."
        if len(images) > 1:
            framed = [(f"Image {i + 1}:", img) for i, img in enumerate(images)]
            return backend.chat_images(model, prompt, framed)
        return backend._chat(model, prompt, images[0] if images else None)

    def transcribe(self, audio: bytes, *, model: str | None = None, **kwargs: Any) -> dict[str, Any]:
        from evalverse import audio as audio_mod

        out = audio_mod.transcribe(audio)
        if model:
            out = {**out, "model": model}
        return out
