"""Any server that speaks the OpenAI Chat Completions protocol: DeepSeek, Mistral, or a local vLLM/Ollama.

Support for JSON schemas varies between these servers, so `json_mode` chooses between sending
the schema itself and asking for a plain JSON object with the schema in the instructions.
Either way the answer is validated against our own schema.
"""
import json
import logging
import time

from openai import APIError, APIStatusError, APITimeoutError, OpenAI, RateLimitError
from openai.lib._pydantic import to_strict_json_schema

from integrations.llm.base import LLMError, LLMSettings, StructuredResult, validated

logger = logging.getLogger(__name__)
# The request itself is wrong (format, key, permission, model name): retrying cannot help.
_CONFIGURATION_CODES = frozenset({400, 401, 403, 404})


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, settings: LLMSettings):
        self.settings = settings

    def sampling(self, temperature: float) -> dict[str, float]:
        return {"temperature": temperature}

    def generate_structured(self, *, instructions, user, schema, temperature, retries) -> StructuredResult:
        strict_schema = to_strict_json_schema(schema)
        if self.settings.json_mode == "schema":
            response_format = {"type": "json_schema",
                               "json_schema": {"name": schema.__name__, "strict": True, "schema": strict_schema}}
            system = list(instructions)
        else:
            response_format = {"type": "json_object"}
            system = [*instructions, "Respond with one JSON object that follows this JSON schema exactly:\n"
                      + json.dumps(strict_schema, ensure_ascii=False)]
        started = time.monotonic()
        try:
            client = OpenAI(api_key=self.settings.api_key, base_url=self.settings.base_url,
                            timeout=self.settings.timeout, max_retries=retries)
            response = client.chat.completions.create(
                model=self.settings.model,
                messages=[*({"role": "system", "content": text} for text in system),
                          {"role": "user", "content": user}],
                response_format=response_format,
                max_tokens=self.settings.max_output_tokens,
                **self.sampling(temperature),
            )
        except APITimeoutError:
            raise LLMError("timeout") from None
        except RateLimitError:
            raise LLMError("rate_limited") from None
        except APIStatusError as error:
            # Only the status code is logged: the server's message may echo the evaluation data sent.
            logger.warning("OpenAI-compatible request failed: code=%s model=%s", error.status_code, self.settings.model)
            raise LLMError("invalid_configuration" if error.status_code in _CONFIGURATION_CODES else "unavailable") from None
        except APIError:
            raise LLMError("unavailable") from None
        except Exception:
            raise LLMError("unavailable") from None
        choice = response.choices[0] if response.choices else None
        message = choice.message if choice is not None else None
        # Checked first: a reasoning model can spend the whole budget thinking and return no content at all.
        if choice is not None and choice.finish_reason == "length":
            raise LLMError("invalid_output", ["output was cut off at the token limit"])
        if message is None or getattr(message, "refusal", None) or not message.content:
            raise LLMError("refused")
        usage = response.usage
        return StructuredResult(
            parsed=validated(schema, message.content), provider=self.name, model=self.settings.model,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
            latency_ms=round((time.monotonic() - started) * 1000),
        )
