"""What produced each AI result: model, prompt version, parameters and token usage.

A prompt's version is a hash of the exact text sent, so it changes by itself whenever the
prompt changes. The full text is kept once per version so any result can be traced back to it.
"""

from dataclasses import dataclass, field
from hashlib import sha256

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import models
from services import workspace_settings_service


def prompt_version(name: str, text: str) -> str:
    return f"{name}@{sha256(text.encode('utf-8')).hexdigest()[:12]}"


@dataclass
class GenerationTrace:
    model: str
    prompt_name: str
    prompt_text: str
    parameters: dict = field(default_factory=dict)
    usage: dict = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0, "attempts": 0})

    @property
    def prompt_version(self) -> str:
        return prompt_version(self.prompt_name, self.prompt_text)

    def add_usage(self, response) -> None:
        usage = getattr(response, "usage", None)
        self.usage["attempts"] += 1
        for key in ("input_tokens", "output_tokens"):
            value = getattr(usage, key, None)
            if isinstance(value, int):
                self.usage[key] += value


def register_prompt(db: Session, trace: GenerationTrace) -> str:
    """Store the prompt text the first time a version is used; returns the version."""
    version = trace.prompt_version
    db.execute(insert(models.AIPromptVersion).values(
        version=version, name=trace.prompt_name, content=trace.prompt_text,
    ).on_conflict_do_nothing(index_elements=["version"]))
    return version


def trace_fields(db: Session, trace: GenerationTrace) -> dict:
    """Columns every generated analysis record carries."""
    return {"model_identifier": trace.model, "prompt_version": register_prompt(db, trace),
            "generation_parameters": trace.parameters, "token_usage": trace.usage}


def audit(db: Session, actor: models.User, summary: str, details: dict) -> None:
    """AI events go to the shared audit log as metadata only, never the generated text."""
    workspace_settings_service.record_audit(db, "ai", actor, summary, details)
