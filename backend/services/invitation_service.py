"""Employee sign-in invitations: cooldown, invitation status on the user and the audit trail.

The Auth0 calls themselves (creating the login, sending the email) live in
integrations.auth0_management; this module decides when to call them and records the outcome.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models
from integrations import auth0_management
from services import workspace_settings_service

INVITATION_COOLDOWN_SECONDS = 60


def invite_user(user: models.User, actor: models.User, db: Session, *, enforce_cooldown: bool = False) -> models.User:
    """Create the employee's Auth0 login, link it and send the "set your password" email.

    Failures are stored on the user instead of raised, so creating the employee always succeeds.
    """
    user = db.query(models.User).filter(models.User.id == user.id).populate_existing().with_for_update().one()
    now = datetime.now(timezone.utc)
    if (enforce_cooldown and user.invitation_status == "sent" and user.invitation_sent_at is not None
            and (now - user.invitation_sent_at).total_seconds() < INVITATION_COOLDOWN_SECONDS):
        raise HTTPException(status_code=429, detail="Wait 60 seconds before sending another invitation",
                            headers={"Retry-After": str(INVITATION_COOLDOWN_SECONDS)})
    name = user.employee.full_name if user.employee else user.username
    if not auth0_management.password_reset_available():
        user.invitation_status, user.invitation_error = "not_sent", "not_configured"
        db.commit()
        return user
    try:
        if user.auth0_user_id is None:
            # Kept even if the email below fails (the failure is caught and committed); a resend then only emails.
            user.auth0_user_id = auth0_management.create_login(user.email)
        elif not user.auth0_user_id.startswith("auth0|"):
            raise auth0_management.InvitationFailure("external_identity")
        auth0_management.send_set_password_email(user.email)
        user.invitation_status, user.invitation_sent_at, user.invitation_error = "sent", now, None
        workspace_settings_service.record_audit(db, "accounts", actor, f"Sign-in invitation sent to {name}",
                                                {"user_id": user.id})
    except auth0_management.InvitationFailure as failure:
        user.invitation_status, user.invitation_error = "failed", failure.code
        workspace_settings_service.record_audit(db, "accounts", actor,
                                                f"Sign-in invitation to {name} failed ({failure.code})",
                                                {"user_id": user.id, "error": failure.code})
    db.commit()
    return user
