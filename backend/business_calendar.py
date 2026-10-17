"""Calendar date used for campaign business decisions, independent of server TZ."""

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo


BUSINESS_TIMEZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "Europe/Budapest"))


def business_today() -> date:
    return datetime.now(BUSINESS_TIMEZONE).date()


def campaign_status(start_date: date, end_date: date | None, is_active: bool, today: date) -> str:
    if not is_active:
        return "Disabled"
    if start_date > today:
        return "Scheduled"
    if end_date is not None and end_date < today:
        return "Completed"
    return "Ongoing"
