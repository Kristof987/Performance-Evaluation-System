"""Google Gemini through the google-genai SDK, with a JSON schema for the response."""
import time

from google import genai
from google.genai import errors, types

from integrations.llm.base import LLMError, LLMSettings, StructuredResult, validated


class GeminiProvider:
    name = "gemini"

    def __init__(self, settings: LLMSettings):
        self.settings = settings

    def sampling(self, temperature: float) -> dict[str, float]:
        return {"temperature": temperature}

    def generate_structured(self, *, instructions, user, schema, temperature, retries) -> StructuredResult:
        started = time.monotonic()
        try:
            client = genai.Client(api_key=self.settings.api_key, http_options=types.HttpOptions(
                timeout=int(self.settings.timeout * 1000),
                retry_options=types.HttpRetryOptions(attempts=retries + 1)))
            response = client.models.generate_content(
                model=self.settings.model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction="\n\n".join(instructions),
                    response_mime_type="application/json",
                    response_json_schema=schema.model_json_schema(),
                    max_output_tokens=self.settings.max_output_tokens,
                    **self.sampling(temperature),
                ),
            )
        except errors.APIError as error:
            if error.code == 429:
                raise LLMError("rate_limited") from None
            raise LLMError("timeout" if error.code in (408, 504) else "unavailable") from None
        except Exception as error:
            # The SDK's transport raises its HTTP library's timeout types.
            raise LLMError("timeout" if "timeout" in type(error).__name__.lower() else "unavailable") from None
        candidate = response.candidates[0] if response.candidates else None
        finish = str(getattr(candidate, "finish_reason", "") or "")
        if getattr(response.prompt_feedback, "block_reason", None) or "SAFETY" in finish or "PROHIBITED" in finish:
            raise LLMError("refused")
        if "MAX_TOKENS" in finish:
            raise LLMError("invalid_output", ["output was cut off at the token limit"])
        text = response.text
        if not text:
            raise LLMError("refused")
        usage = response.usage_metadata
        return StructuredResult(
            parsed=validated(schema, text), provider=self.name, model=self.settings.model,
            input_tokens=getattr(usage, "prompt_token_count", 0) or 0,
            # Thinking tokens are billed as output, so they count toward the cost.
            output_tokens=(getattr(usage, "candidates_token_count", 0) or 0) + (getattr(usage, "thoughts_token_count", 0) or 0),
            latency_ms=round((time.monotonic() - started) * 1000),
        )
