"""The provider layer: configuration, and each adapter's request, parsing and error mapping against fake SDKs."""
import json
from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ConfigDict, Field

from integrations import llm
from integrations.llm import anthropic_provider, gemini_provider, openai_compatible, openai_provider


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: str
    score: int


GOOD = {"verdict": "ok", "score": 4}


def settings(provider, **extra):
    return llm.LLMSettings(provider=provider, model="test-model", api_key="secret-key", timeout=30,
                           max_output_tokens=1024, **extra)


def ask(provider):
    return provider.generate_structured(instructions=["Rule one.", "Rule two."], user="Facts", schema=Answer,
                                        temperature=0.2, retries=1)


def fails_with(category, provider):
    with pytest.raises(llm.LLMError) as error:
        ask(provider)
    assert error.value.category == category
    return error.value


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ("AI_PROVIDER", "AI_MODEL", "AI_API_KEY", "AI_BASE_URL", "AI_JSON_MODE", "AI_TIMEOUT_SECONDS",
                 "AI_MAX_OUTPUT_TOKENS", "OPENAI_API_KEY", "OPENAI_ANALYSIS_MODEL",
                 "OPENAI_ANALYSIS_TIMEOUT_SECONDS", "OPENAI_ANALYSIS_MAX_OUTPUT_TOKENS"):
        monkeypatch.delenv(name, raising=False)


# --- Configuration ---------------------------------------------------------------------------

def test_existing_openai_settings_keep_working(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "old-key")
    monkeypatch.setenv("OPENAI_ANALYSIS_MODEL", "gpt-old")
    active = llm.settings()
    assert (active.provider, active.model, active.api_key) == ("openai", "gpt-old", "old-key")
    assert llm.settings("workspace-model").model == "workspace-model"


def test_another_provider_is_chosen_by_configuration(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "anthropic")
    monkeypatch.setenv("AI_MODEL", "claude-test")
    monkeypatch.setenv("OPENAI_API_KEY", "an-openai-key")
    with pytest.raises(llm.LLMError) as error:  # an OpenAI key is never sent to another provider
        llm.settings()
    assert error.value.category == "not_configured"
    monkeypatch.setenv("AI_API_KEY", "anthropic-key")
    assert (llm.settings().provider, llm.settings().api_key) == ("anthropic", "anthropic-key")
    assert isinstance(llm.provider_for(llm.settings()), anthropic_provider.AnthropicProvider)


@pytest.mark.parametrize("variables, category", [
    ({"AI_PROVIDER": "unknown", "AI_API_KEY": "k", "AI_MODEL": "m"}, "invalid_configuration"),
    ({"AI_PROVIDER": "openai_compatible", "AI_API_KEY": "k", "AI_MODEL": "m"}, "not_configured"),
    ({"AI_API_KEY": "k", "AI_MODEL": "m", "AI_TIMEOUT_SECONDS": "500"}, "invalid_configuration"),
    ({"AI_PROVIDER": "openai_compatible", "AI_API_KEY": "k", "AI_MODEL": "m", "AI_BASE_URL": "https://x",
      "AI_JSON_MODE": "xml"}, "invalid_configuration"),
])
def test_incomplete_or_invalid_configuration_is_reported(monkeypatch, variables, category):
    for name, value in variables.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(llm.LLMError) as error:
        llm.settings()
    assert error.value.category == category


def test_override_replaces_the_deployment_settings_and_hides_the_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "old-key")
    monkeypatch.setenv("OPENAI_ANALYSIS_MODEL", "gpt-old")
    benchmark = settings("gemini")
    with llm.override(benchmark):
        assert llm.settings() is benchmark
    assert llm.settings().provider == "openai"
    assert "secret-key" not in repr(benchmark)


# --- OpenAI ---------------------------------------------------------------------------------

def test_openai_sends_developer_messages_and_never_stores_requests(monkeypatch):
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            self.responses = SimpleNamespace(parse=self.parse)

        def parse(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(output_parsed=Answer(**GOOD), usage=SimpleNamespace(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(openai_provider, "OpenAI", FakeClient)
    result = ask(llm.provider_for(settings("openai")))
    client, request = calls
    assert client["max_retries"] == 1 and request["store"] is False and request["text_format"] is Answer
    assert [message["role"] for message in request["input"]] == ["developer", "developer", "user"]
    assert (result.parsed, result.provider, result.input_tokens, result.output_tokens) == (Answer(**GOOD), "openai", 10, 5)


# --- OpenAI-compatible (DeepSeek, Mistral, local servers) -----------------------------------

def compatible_client(monkeypatch, content, *, refusal=None, finish="stop"):
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            calls.append(kwargs)
            message = SimpleNamespace(content=content, refusal=refusal)
            return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish)],
                                   usage=SimpleNamespace(prompt_tokens=12, completion_tokens=7))

    monkeypatch.setattr(openai_compatible, "OpenAI", FakeClient)
    return calls


def test_compatible_server_gets_a_strict_schema_at_its_own_address(monkeypatch):
    calls = compatible_client(monkeypatch, json.dumps(GOOD))
    result = ask(llm.provider_for(settings("openai_compatible", base_url="https://api.example.com")))
    client, request = calls
    assert client["base_url"] == "https://api.example.com"
    assert request["response_format"]["type"] == "json_schema" and request["response_format"]["json_schema"]["strict"]
    assert [message["role"] for message in request["messages"]] == ["system", "system", "user"]
    assert (result.parsed, result.input_tokens, result.output_tokens) == (Answer(**GOOD), 12, 7)


def test_json_object_mode_puts_the_schema_in_the_instructions(monkeypatch):
    calls = compatible_client(monkeypatch, json.dumps(GOOD))
    ask(llm.provider_for(settings("openai_compatible", base_url="https://x", json_mode="object")))
    request = calls[1]
    assert request["response_format"] == {"type": "json_object"}
    assert '"verdict"' in request["messages"][2]["content"]


@pytest.mark.parametrize("content, refusal, finish, category", [
    (None, "I can't help with that", "stop", "refused"),
    ("", None, "stop", "refused"),
    ('{"verdict": "ok"', None, "length", "invalid_output"),
    (None, None, "length", "invalid_output"),  # a reasoning model that thought until the limit
    ("", None, "length", "invalid_output"),
    ('{"verdict": "ok", "score": "high"}', None, "stop", "invalid_output"),
])
def test_compatible_server_failures_are_categorised(monkeypatch, content, refusal, finish, category):
    compatible_client(monkeypatch, content, refusal=refusal, finish=finish)
    error = fails_with(category, llm.provider_for(settings("openai_compatible", base_url="https://x")))
    if content and "high" in content:
        assert error.detail == ["score"]  # names the field to fix, never the content


# --- Anthropic ------------------------------------------------------------------------------

class FakeAnthropicErrors:
    class APIError(Exception):
        pass

    class APITimeoutError(APIError):
        pass

    class RateLimitError(APIError):
        pass


def anthropic_sdk(monkeypatch, *, response=None, error=None):
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            self.messages = SimpleNamespace(parse=self.parse)

        def parse(self, **kwargs):
            calls.append(kwargs)
            if error is not None:
                raise error
            return response

    monkeypatch.setattr(anthropic_provider, "anthropic", SimpleNamespace(
        Anthropic=FakeClient, APIError=FakeAnthropicErrors.APIError,
        APITimeoutError=FakeAnthropicErrors.APITimeoutError, RateLimitError=FakeAnthropicErrors.RateLimitError))
    return calls


def test_anthropic_joins_the_instructions_into_the_system_prompt(monkeypatch):
    calls = anthropic_sdk(monkeypatch, response=SimpleNamespace(
        stop_reason="end_turn", parsed_output=Answer(**GOOD), usage=SimpleNamespace(input_tokens=20, output_tokens=8)))
    provider = llm.provider_for(settings("anthropic"))
    result = ask(provider)
    request = calls[1]
    assert request["system"] == "Rule one.\n\nRule two." and request["output_format"] is Answer
    assert request["messages"] == [{"role": "user", "content": "Facts"}] and "temperature" not in request
    assert provider.sampling(0.2) == {}
    assert (result.parsed, result.provider, result.output_tokens) == (Answer(**GOOD), "anthropic", 8)


@pytest.mark.parametrize("response, error, category", [
    (SimpleNamespace(stop_reason="refusal", parsed_output=None, usage=None), None, "refused"),
    (SimpleNamespace(stop_reason="max_tokens", parsed_output=None, usage=None), None, "invalid_output"),
    (None, FakeAnthropicErrors.APITimeoutError(), "timeout"),
    (None, FakeAnthropicErrors.RateLimitError(), "rate_limited"),
    (None, FakeAnthropicErrors.APIError(), "unavailable"),
    (None, RuntimeError("provider said: <HR data>"), "unavailable"),
])
def test_anthropic_failures_are_categorised(monkeypatch, response, error, category):
    anthropic_sdk(monkeypatch, response=response, error=error)
    raised = fails_with(category, llm.provider_for(settings("anthropic")))
    assert "HR data" not in str(raised)


# --- Gemini ---------------------------------------------------------------------------------

class FakeGeminiAPIError(Exception):
    def __init__(self, code):
        self.code = code


def gemini_sdk(monkeypatch, *, text=None, finish="STOP", block=None, error=None):
    calls = []

    class FakeModels:
        def generate_content(self, **kwargs):
            calls.append(kwargs)
            if error is not None:
                raise error
            return SimpleNamespace(
                text=text, prompt_feedback=SimpleNamespace(block_reason=block),
                candidates=[SimpleNamespace(finish_reason=finish)],
                usage_metadata=SimpleNamespace(prompt_token_count=30, candidates_token_count=6, thoughts_token_count=4))

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            self.models = FakeModels()

    monkeypatch.setattr(gemini_provider, "genai", SimpleNamespace(Client=FakeClient))
    monkeypatch.setattr(gemini_provider, "errors", SimpleNamespace(APIError=FakeGeminiAPIError))
    return calls


def test_gemini_asks_for_json_that_follows_the_schema(monkeypatch):
    calls = gemini_sdk(monkeypatch, text=json.dumps(GOOD))
    result = ask(llm.provider_for(settings("gemini")))
    client, request = calls
    config = request["config"]
    assert client["http_options"].timeout == 30_000
    assert config.response_mime_type == "application/json" and config.response_json_schema["required"] == ["verdict", "score"]
    assert config.system_instruction == "Rule one.\n\nRule two." and config.temperature == 0.2
    assert (result.parsed, result.input_tokens, result.output_tokens) == (Answer(**GOOD), 30, 10)  # thinking counts as output


@pytest.mark.parametrize("options, category", [
    ({"error": FakeGeminiAPIError(429)}, "rate_limited"),
    ({"error": FakeGeminiAPIError(504)}, "timeout"),
    ({"error": FakeGeminiAPIError(500)}, "unavailable"),
    ({"error": FakeGeminiAPIError(400)}, "invalid_configuration"),  # e.g. a schema Gemini cannot serve
    ({"error": FakeGeminiAPIError(403)}, "invalid_configuration"),
    ({"error": FakeGeminiAPIError(404)}, "invalid_configuration"),
    ({"error": type("ReadTimeout", (Exception,), {})()}, "timeout"),
    ({"text": None, "block": "SAFETY"}, "refused"),
    ({"text": '{"verdict"', "finish": "MAX_TOKENS"}, "invalid_output"),
    ({"text": '{"verdict": "ok"}'}, "invalid_output"),
])
def test_gemini_failures_are_categorised(monkeypatch, options, category):
    gemini_sdk(monkeypatch, **options)
    fails_with(category, llm.provider_for(settings("gemini")))


class Limited(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[str] = Field(max_length=2)
    label: str = Field(min_length=1, max_length=5)


def test_gemini_gets_the_schema_without_size_limits_but_the_response_is_still_checked(monkeypatch):
    calls = gemini_sdk(monkeypatch, text=json.dumps({"items": ["a", "b", "c"], "label": "ok"}))
    provider = llm.provider_for(settings("gemini"))
    with pytest.raises(llm.LLMError) as error:
        provider.generate_structured(instructions=["x"], user="y", schema=Limited, temperature=0.2, retries=0)
    sent = json.dumps(calls[1]["config"].response_json_schema)
    assert not any(word in sent for word in ("maxItems", "minItems", "maxLength", "minLength"))
    assert error.value.category == "invalid_output"  # three items: the limit still applies to the answer


def test_the_analysis_schemas_lose_only_their_size_limits():
    from services.ai_analysis_models import GeneratedAnalysis
    original = GeneratedAnalysis.model_json_schema()
    relaxed = gemini_provider.serving_schema(original)
    assert relaxed["required"] == original["required"] and relaxed["$defs"].keys() == original["$defs"].keys()
    assert "maxItems" not in json.dumps(relaxed) and "enum" in json.dumps(relaxed)


@pytest.mark.parametrize("status, category", [(400, "invalid_configuration"), (401, "invalid_configuration"),
                                              (404, "invalid_configuration"), (503, "unavailable")])
def test_compatible_server_status_errors_are_categorised(monkeypatch, status, category):
    import httpx
    from openai import APIStatusError

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

        def create(self, **kwargs):
            request = httpx.Request("POST", "https://x/chat/completions")
            raise APIStatusError("failed", response=httpx.Response(status, request=request), body=None)

    monkeypatch.setattr(openai_compatible, "OpenAI", FakeClient)
    fails_with(category, llm.provider_for(settings("openai_compatible", base_url="https://x")))


def test_unknown_providers_are_rejected():
    with pytest.raises(llm.LLMError) as error:
        llm.provider_for(settings("carrier-pigeon"))
    assert error.value.category == "invalid_configuration"
