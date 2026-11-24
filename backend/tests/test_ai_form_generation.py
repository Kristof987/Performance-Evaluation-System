"""AI questionnaire generation, run end to end against a fake provider client."""
from types import SimpleNamespace

import pytest

from database import SessionLocal
from integrations.llm import openai_provider
from services import ai_form_generation_service as generation
from services import workspace_settings_service
import schemas


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def scale(text):
    return generation._Question(text=text, type="Scale", required=True, options=[], scale_min=1, scale_max=5,
                                min_label="Rarely", max_label="Always")


def draft():
    return generation._Generated(
        title="Teamwork review",
        description="How the colleague works with the team.",
        sections=[generation._Section(name="Collaboration", questions=[
            scale("Shares knowledge with the team"),
            scale("Helps colleagues when they are stuck"),
            scale("Communicates changes early"),
            scale("Responds to feedback constructively"),
        ])],
        standalone_questions=[generation._Question(text="What should they keep doing?", type="Text", required=False,
                                                   options=[], scale_min=1, scale_max=5, min_label="", max_label="")],
    )


@pytest.fixture
def provider(monkeypatch):
    """Configures the workspace model and replaces the OpenAI client; records the model it was asked for."""
    calls = []

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = SimpleNamespace(parse=self.parse)

        def parse(self, **kwargs):
            calls.append(kwargs["model"])
            return SimpleNamespace(output_parsed=draft(), usage=SimpleNamespace(input_tokens=10, output_tokens=20))

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(openai_provider, "OpenAI", FakeClient)
    monkeypatch.setattr(workspace_settings_service, "ai_model", lambda _db: "workspace-model")
    return calls


def test_generation_uses_the_workspace_model_and_returns_a_draft(db, provider):
    request = schemas.FormAIGenerateRequest(description="Teamwork for developers", evaluation_type="peer",
                                            length="short")

    result = generation.generate(request, db)

    assert provider == ["workspace-model"]
    assert result["name"] == "Teamwork review"
    assert [question["text"] for question in result["sections"][0]["questions"]][0] == "Shares knowledge with the team"
    assert result["standalone_questions"][0]["type"] == "Text"
