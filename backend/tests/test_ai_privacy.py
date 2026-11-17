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
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_ANALYSIS_MODEL", "test-model")
    monkeypatch.setattr(ai_generation_service, "OpenAI", FakeClient)
    with pytest.raises(Exception):
        ai_generation_service._request_analysis({"scope": "employee", "facts": []})
    assert calls and calls[0]["store"] is False


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
