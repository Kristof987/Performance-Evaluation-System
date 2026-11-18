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


# --- Traceability ---------------------------------------------------------------------------

import ai_trace
import models
from database import SessionLocal


def test_prompt_version_changes_with_the_text_by_itself():
    first = ai_trace.prompt_version("employee-analysis", "Analyse the facts.")
    assert first == ai_trace.prompt_version("employee-analysis", "Analyse the facts.")
    assert first.startswith("employee-analysis@") and len(first.split("@")[1]) == 12
    assert first != ai_trace.prompt_version("employee-analysis", "Analyse the facts!")


def test_request_records_model_prompt_parameters_and_tokens(monkeypatch):
    class FakeResponses:
        def parse(self, **_kwargs):
            return SimpleNamespace(output_parsed=None, usage=SimpleNamespace(input_tokens=1200, output_tokens=300))

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_ANALYSIS_MODEL", "gpt-4.1-2025-04-14")
    monkeypatch.setattr(ai_generation_service, "OpenAI", FakeClient)
    trace = ai_trace.GenerationTrace(model="", prompt_name="employee-analysis", prompt_text="")
    for _attempt in range(2):  # a first try and a correction both count
        with pytest.raises(ai_generation_service.AnalysisGenerationError):
            ai_generation_service._request_analysis({"scope": "employee", "facts": []}, instructions="Rules.", trace=trace)
    assert trace.model == "gpt-4.1-2025-04-14"
    assert trace.prompt_text == "Rules."
    assert trace.parameters == {"max_output_tokens": 2048, "retries": 2, "temperature": 0.2}
    assert trace.usage == {"input_tokens": 2400, "output_tokens": 600, "attempts": 2}


def test_prompt_text_is_stored_once_and_audit_keeps_metadata_only():
    db = SessionLocal()
    try:
        trace = ai_trace.GenerationTrace(model="gpt-4.1-2025-04-14", prompt_name="test-prompt",
                                         prompt_text=f"Prompt {id(db)}", parameters={"temperature": 0.2})
        first = ai_trace.trace_fields(db, trace)
        again = ai_trace.trace_fields(db, trace)
        assert first["prompt_version"] == again["prompt_version"] == trace.prompt_version
        stored = db.query(models.AIPromptVersion).filter_by(version=trace.prompt_version).all()
        assert len(stored) == 1 and stored[0].content == trace.prompt_text
        actor = db.query(models.User).first()
        ai_trace.audit(db, actor, "AI analysis v1 generated: test", {"prompt_version": trace.prompt_version})
        db.flush()
        event = db.query(models.SettingsAuditEvent).order_by(models.SettingsAuditEvent.id.desc()).first()
        assert event.category == "ai" and event.details["prompt_version"] == trace.prompt_version
    finally:
        db.rollback()
        db.close()


def test_auth_me_tells_every_user_whether_ai_is_on(monkeypatch):
    from fastapi.testclient import TestClient

    import main
    import workspace_settings_service

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.is_active.is_(True)).first()
        if user is None:
            pytest.skip("No active user in the test database")
        main.app.dependency_overrides[main.get_current_user] = lambda: user
        main.app.dependency_overrides[main.get_db] = lambda: db
        monkeypatch.setattr(main, "record_sign_in", lambda *_args: None)
        for enabled in (True, False):
            monkeypatch.setattr(workspace_settings_service, "ai_enabled", lambda _db, value=enabled: value)
            assert TestClient(main.app).get("/auth/me").json()["ai_enabled"] is enabled
        # Every page shows dates in the business time zone the server reports here.
        assert TestClient(main.app).get("/auth/me").json()["timezone"] == main.BUSINESS_TIMEZONE.key
    finally:
        main.app.dependency_overrides.clear()
        db.rollback()
        db.close()
