"""Calendar date used for campaign business decisions, independent of server TZ."""

import os
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo


BUSINESS_TIMEZONE = ZoneInfo(os.getenv("APP_TIMEZONE", "Europe/Budapest"))


def business_today() -> date:
    return datetime.now(BUSINESS_TIMEZONE).date()


def business_date(value: date | datetime | None) -> date | None:
    if isinstance(value, datetime):
        return value.astimezone(BUSINESS_TIMEZONE).date()
    return value


def campaign_instant(value: date | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Campaign timestamps must include a timezone")
        return value.astimezone(timezone.utc)
    return datetime.combine(value, time.min, tzinfo=BUSINESS_TIMEZONE).astimezone(timezone.utc)


def campaign_status(start_date: date, end_date: date | None, is_active: bool, today: date) -> str:
    start_date = business_date(start_date)
    end_date = business_date(end_date)
    if not is_active:
        return "Disabled"
    if start_date > today:
        return "Scheduled"
    if end_date is not None and end_date < today:
        return "Completed"
    return "Ongoing"
