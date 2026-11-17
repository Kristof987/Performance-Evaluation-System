from types import SimpleNamespace

import pytest

import ai_generation_service
import ai_workflow_service


class _StopAfterCall(Exception):
    pass


def test_analysis_requests_are_not_stored_at_the_provider(monkeypatch):
    calls = []

    class FakeResponses:
        def parse(self, **kwargs):
            calls.append(kwargs)
            raise _StopAfterCall

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append({"client": kwargs})
            self.responses = FakeResponses()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_ANALYSIS_MODEL", "test-model")
    monkeypatch.setattr(ai_generation_service, "OpenAI", FakeClient)
    with pytest.raises(Exception):
        ai_generation_service._request_analysis({"scope": "employee", "facts": []})
    client, request = calls
    assert request["store"] is False
    assert client["client"]["max_retries"] == 2  # background job: retry transient provider errors
    assert request["temperature"] == 0.2


@pytest.mark.parametrize(("model", "has_temperature"), [
    ("gpt-4.1-2025-04-14", True), ("gpt-4o", True), ("o3-2025-04-16", False), ("o4-mini", False), ("gpt-5", False),
    ("GPT-5-mini", False),
])
def test_temperature_only_for_models_that_accept_it(model, has_temperature):
    assert ("temperature" in ai_generation_service.sampling_options(model, 0.2)) is has_temperature


@pytest.mark.parametrize(("model", "pinned"), [
    ("gpt-4.1-2025-04-14", True), ("gpt-4.1", False), ("o3-2025-04-16", True), ("gpt-4o-latest", False),
])
def test_dated_snapshots_count_as_pinned(model, pinned):
    assert ai_generation_service.is_pinned_model(model) is pinned


def test_drafts_are_only_visible_to_people_who_generate_or_approve(monkeypatch):
    draft, approved = SimpleNamespace(status="draft"), SimpleNamespace(status="approved")
    granted: set[str] = set()
    monkeypatch.setattr(ai_workflow_service, "has_permission", lambda _actor, _db, permission: permission in granted)

    assert ai_workflow_service.visible_versions([draft, approved], object(), None) == [approved]
    granted.add(ai_workflow_service.APPROVE)
    assert ai_workflow_service.visible_versions([draft, approved], object(), None) == [draft, approved]
    granted.clear()
    granted.add(ai_workflow_service.GENERATE)
    assert ai_workflow_service.visible_versions([draft, approved], object(), None) == [draft, approved]
