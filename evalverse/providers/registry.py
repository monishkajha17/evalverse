"""Provider registry and `provider:model` reference parsing."""

from __future__ import annotations

from typing import Any

from evalverse.providers.meta import MetaProvider
from evalverse.providers.mock import MockProvider

_PROVIDERS = {
    "meta": MetaProvider(),
    "mock": MockProvider(),
}


def get_provider(name: str):
    key = (name or "meta").lower()
    if key not in _PROVIDERS:
        raise KeyError(f"unknown provider: {name}")
    return _PROVIDERS[key]


def list_providers() -> list[dict[str, Any]]:
    out = []
    for name, prov in _PROVIDERS.items():
        models = []
        for mid in prov.list_models():
            models.append({"id": mid, "capabilities": prov.capabilities(mid)})
        out.append({"id": name, "name": name, "models": models})
    return out


def resolve_model_ref(ref: str) -> tuple[str, str]:
    """Parse `provider:model` or bare model (defaults to meta)."""
    if not ref:
        raise ValueError("empty model ref")
    if ":" in ref:
        provider, model = ref.split(":", 1)
        return provider.strip(), model.strip()
    return "meta", ref.strip()
