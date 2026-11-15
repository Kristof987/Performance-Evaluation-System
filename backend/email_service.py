"""Templated email over SMTP. Locally SMTP points at Mailpit, which keeps every message instead of sending it."""

import html
import logging
import os
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from string import Template


logger = logging.getLogger(__name__)
TEMPLATE_DIR = Path(__file__).with_name("email_templates")


class EmailNotConfigured(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def _template(name: str) -> Template:
    return Template((TEMPLATE_DIR / name).read_text(encoding="utf-8"))


def render(template: str, values: dict[str, object]) -> tuple[str, str, str]:
    """Fill `<template>.txt` (first line is the subject) and `<template>.html`; values are escaped for HTML."""
    text_values = {key: str(value) for key, value in values.items()}
    subject_line, _, body = _template(f"{template}.txt").substitute(text_values).partition("\n")
    if not subject_line.startswith("Subject: "):
        raise ValueError(f"{template}.txt must start with a 'Subject: ' line")
    html_body = _template(f"{template}.html").substitute(
        {key: html.escape(value, quote=True) for key, value in text_values.items()})
    return subject_line.removeprefix("Subject: ").strip(), body.lstrip("\n"), html_body


def send(recipient: str, subject: str, text_body: str, html_body: str) -> None:
    if not configured():
        raise EmailNotConfigured("Email sending is not configured")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((sender_name(), os.getenv("SMTP_FROM", "compass@localhost")))
    message["To"] = recipient
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    port = int(os.getenv("SMTP_PORT", "587"))
    with smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=15) as smtp:
        if os.getenv("SMTP_STARTTLS", "true").lower() not in {"0", "false", "no"}:
            smtp.starttls()
        if os.getenv("SMTP_USER"):
            smtp.login(os.environ["SMTP_USER"], os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(message)


def sender_name() -> str:
    return os.getenv("SMTP_FROM_NAME", "Compass")


def app_link(path: str) -> str:
    base = (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")
    return f"{base}{path}"
