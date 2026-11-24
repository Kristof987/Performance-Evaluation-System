"""Language model providers behind one interface; see base.py for the design."""
from importlib import import_module

from integrations.llm.base import (
    PROVIDERS, LLMError, LLMProvider, LLMSettings, StructuredResult,
    api_key_configured, configured_model, configured_provider, override, settings,
)

# Imported on first use, so a deployment only needs the SDK of the provider it uses.
_ADAPTERS = {
    "openai": ("integrations.llm.openai_provider", "OpenAIProvider"),
    "openai_compatible": ("integrations.llm.openai_compatible", "OpenAICompatibleProvider"),
    "anthropic": ("integrations.llm.anthropic_provider", "AnthropicProvider"),
    "gemini": ("integrations.llm.gemini_provider", "GeminiProvider"),
}


def provider_for(llm_settings: LLMSettings) -> LLMProvider:
    if llm_settings.provider not in _ADAPTERS:
        raise LLMError("invalid_configuration")
    module, name = _ADAPTERS[llm_settings.provider]
    try:
        adapter = getattr(import_module(module), name)
    except ImportError:
        raise LLMError("not_configured") from None
    return adapter(llm_settings)


__all__ = ["PROVIDERS", "LLMError", "LLMProvider", "LLMSettings", "StructuredResult", "api_key_configured",
           "configured_model", "configured_provider", "override", "provider_for", "settings"]
