"""Anthropic Claude through the Messages API, with structured output parsed into the schema."""
import time

import anthropic
from pydantic import ValidationError

from integrations.llm.base import LLMError, LLMSettings, StructuredResult, locations, validated


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: LLMSettings):
        self.settings = settings

    def sampling(self, temperature: float) -> dict[str, float]:
        # Current Claude models choose their own sampling; the Messages API takes no temperature.
        return {}

    def generate_structured(self, *, instructions, user, schema, temperature, retries) -> StructuredResult:
        started = time.monotonic()
        try:
            client = anthropic.Anthropic(api_key=self.settings.api_key, timeout=self.settings.timeout,
                                         max_retries=retries)
            response = client.messages.parse(
                model=self.settings.model,
                max_tokens=self.settings.max_output_tokens,
                system="\n\n".join(instructions),
                messages=[{"role": "user", "content": user}],
                output_format=schema,
            )
        except anthropic.APITimeoutError:
            raise LLMError("timeout") from None
        except anthropic.RateLimitError:
            raise LLMError("rate_limited") from None
        except ValidationError as error:
            raise LLMError("invalid_output", locations(error)) from None
        except (ValueError, TypeError):
            raise LLMError("invalid_output") from None
        except anthropic.APIError:
            raise LLMError("unavailable") from None
        except Exception:
            raise LLMError("unavailable") from None
        if response.stop_reason == "refusal":
            raise LLMError("refused")
        if response.stop_reason == "max_tokens":
            raise LLMError("invalid_output", ["output was cut off at the token limit"])
        parsed = response.parsed_output
        usage = response.usage
        return StructuredResult(
            parsed=validated(schema, parsed) if parsed is not None else None,
            provider=self.name, model=self.settings.model,
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
            latency_ms=round((time.monotonic() - started) * 1000),
        )
