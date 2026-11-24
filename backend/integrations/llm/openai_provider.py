"""OpenAI through the Responses API, with structured output parsed into the schema."""
import re
import time

from openai import APIError, APITimeoutError, OpenAI, RateLimitError
from pydantic import ValidationError

from integrations.llm.base import LLMError, LLMSettings, StructuredResult, locations, validated

# Reasoning models (o-series, GPT-5 family) reject sampling parameters such as temperature.
_REASONING_MODEL = re.compile(r"^(?:o\d|gpt-5)", re.I)


def sampling_options(model: str, temperature: float) -> dict[str, float]:
    """A low temperature keeps repeated runs on the same facts close, where the model supports it."""
    return {} if _REASONING_MODEL.match(model.strip()) else {"temperature": temperature}


class OpenAIProvider:
    name = "openai"

    def __init__(self, settings: LLMSettings):
        self.settings = settings

    def sampling(self, temperature: float) -> dict[str, float]:
        return sampling_options(self.settings.model, temperature)

    def generate_structured(self, *, instructions, user, schema, temperature, retries) -> StructuredResult:
        started = time.monotonic()
        try:
            client = OpenAI(api_key=self.settings.api_key, timeout=self.settings.timeout, max_retries=retries)
            response = client.responses.parse(
                model=self.settings.model,
                input=[*({"role": "developer", "content": text} for text in instructions),
                       {"role": "user", "content": user}],
                text_format=schema,
                max_output_tokens=self.settings.max_output_tokens,
                store=False,  # evaluation data must not be kept as application state at the provider
                **self.sampling(temperature),
            )
        except APITimeoutError:
            raise LLMError("timeout") from None
        except RateLimitError:
            raise LLMError("rate_limited") from None
        except ValidationError as error:
            raise LLMError("invalid_output", locations(error)) from None
        except (ValueError, TypeError):
            raise LLMError("invalid_output") from None
        except APIError:
            raise LLMError("unavailable") from None
        except Exception:
            # SDK parsing and transport failures must not expose HR data or provider messages.
            raise LLMError("unavailable") from None
        usage = getattr(response, "usage", None)
        parsed = response.output_parsed
        return StructuredResult(
            parsed=validated(schema, parsed) if parsed is not None else None,
            provider=self.name, model=self.settings.model,
            input_tokens=_count(usage, "input_tokens"), output_tokens=_count(usage, "output_tokens"),
            latency_ms=round((time.monotonic() - started) * 1000),
        )


def _count(usage, name: str) -> int:
    value = getattr(usage, name, None)
    return value if isinstance(value, int) else 0
