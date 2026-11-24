"""A provider-independent way to ask a language model for structured output.

The services describe what they need (instructions, the user message and a Pydantic schema);
an adapter per provider turns that into the provider's own API call. Exactly one provider is
active in a deployment, chosen by configuration, so evaluation data only ever goes to the
provider the organization approved. A benchmark may run a single call with other settings
through `override`, without touching that configuration.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import math
import os
from typing import Protocol

from pydantic import BaseModel, ValidationError

PROVIDERS = ("openai", "openai_compatible", "anthropic", "gemini")
JSON_MODES = ("schema", "object")


class LLMError(Exception):
    """A provider call failed in one of a few known ways.

    Never carries the provider's own message: it may echo the HR data that was sent.
    `detail` only names the schema locations of invalid output, so a retry can be told what to fix.
    """

    CATEGORIES = ("not_configured", "invalid_configuration", "timeout", "rate_limited",
                  "unavailable", "invalid_output", "refused")

    def __init__(self, category: str, detail: list[str] | None = None):
        if category not in self.CATEGORIES:
            raise ValueError(f"Unknown LLM error category: {category}")
        self.category = category
        self.detail = detail or []
        super().__init__(category)


@dataclass(frozen=True)
class LLMSettings:
    provider: str
    model: str
    api_key: str
    base_url: str | None = None
    timeout: float = 30.0
    max_output_tokens: int = 2048
    # Only for openai_compatible: "schema" sends a JSON schema; "object" asks for any JSON object
    # and puts the schema in the instructions, for servers that support only that (e.g. DeepSeek).
    json_mode: str = "schema"

    def __repr__(self) -> str:  # never print the key
        return f"LLMSettings(provider={self.provider!r}, model={self.model!r}, base_url={self.base_url!r})"


@dataclass
class StructuredResult:
    parsed: BaseModel | None
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0


class LLMProvider(Protocol):
    name: str
    settings: LLMSettings

    def sampling(self, temperature: float) -> dict[str, float]:
        """The sampling parameters this model accepts; recorded with each result."""

    def generate_structured(self, *, instructions: list[str], user: str, schema: type[BaseModel],
                            temperature: float, retries: int) -> StructuredResult:
        """Ask for one response that follows `schema`; raise LLMError on any failure."""


def validated(schema: type[BaseModel], data) -> BaseModel:
    """Every provider's answer is checked against our own schema, whatever the provider promised."""
    try:
        if isinstance(data, (str, bytes)):
            return schema.model_validate_json(data)
        return schema.model_validate(data.model_dump() if isinstance(data, BaseModel) else data)
    except ValidationError as error:
        raise LLMError("invalid_output", locations(error)) from None
    except (TypeError, ValueError):
        raise LLMError("invalid_output") from None


def locations(error: ValidationError) -> list[str]:
    return [".".join(str(part) for part in item["loc"] if isinstance(part, (str, int))) for item in error.errors()[:3]]


_override: ContextVar[LLMSettings | None] = ContextVar("llm_settings_override", default=None)


@contextmanager
def override(settings: LLMSettings):
    """Run the calls inside with these settings instead of the deployment's (used by the benchmark)."""
    token = _override.set(settings)
    try:
        yield
    finally:
        _override.reset(token)


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def configured_provider() -> str:
    return _env("AI_PROVIDER", default="openai").lower()


def configured_model() -> str | None:
    return _env("AI_MODEL", "OPENAI_ANALYSIS_MODEL") or None


def api_key_configured() -> bool:
    return bool(_api_key(configured_provider()))


def _api_key(provider: str) -> str:
    # OPENAI_API_KEY keeps existing OpenAI deployments working without new settings.
    return _env("AI_API_KEY", *(("OPENAI_API_KEY",) if provider == "openai" else ()))


def settings(model: str | None = None) -> LLMSettings:
    """The deployment's settings; `model` (the workspace's choice) replaces the configured model."""
    active = _override.get()
    if active is not None:
        return active
    provider = configured_provider()
    if provider not in PROVIDERS:
        raise LLMError("invalid_configuration")
    key, chosen = _api_key(provider), (model or configured_model() or "").strip()
    base_url = _env("AI_BASE_URL") or None
    json_mode = _env("AI_JSON_MODE", default="schema").lower()
    if not key or not chosen or (provider == "openai_compatible" and not base_url):
        raise LLMError("not_configured")
    try:
        timeout = float(_env("AI_TIMEOUT_SECONDS", "OPENAI_ANALYSIS_TIMEOUT_SECONDS", default="30"))
        max_tokens = int(_env("AI_MAX_OUTPUT_TOKENS", "OPENAI_ANALYSIS_MAX_OUTPUT_TOKENS", default="2048"))
    except ValueError:
        raise LLMError("invalid_configuration") from None
    if not math.isfinite(timeout) or not 5 <= timeout <= 120 or not 256 <= max_tokens <= 4096 or json_mode not in JSON_MODES:
        raise LLMError("invalid_configuration")
    return LLMSettings(provider=provider, model=chosen, api_key=key, base_url=base_url, timeout=timeout,
                       max_output_tokens=max_tokens, json_mode=json_mode)
