"""The signed-in user's own account: profile, profile photo, security and personal preferences."""

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from integrations import auth0_management
from services import account_service, preferences_service, profile_photo_service

router = APIRouter()


@router.get("/users/{user_id}/account-settings/profile", response_model=schemas.AccountSettingsProfile)
def get_account_settings_profile(user_id: int, db: Session = Depends(get_db),
                                 actor: models.User = Depends(require_permission("settings.read"))):
    if user_id != actor.id:
        raise HTTPException(status_code=404, detail="Account profile not found")
    return account_service.account_profile(actor.id, db)


@router.get("/me/account-settings/profile", response_model=schemas.AccountSettingsProfile)
def get_my_account_settings_profile(db: Session = Depends(get_db),
                                    actor: models.User = Depends(require_permission("settings.read"))):
    return account_service.account_profile(actor.id, db)


@router.put("/me/profile-photo", response_model=schemas.ProfilePhotoResponse)
def upload_my_profile_photo(file: UploadFile = File(...), db: Session = Depends(get_db),
                            actor: models.User = Depends(require_permission("settings.manage_self"))):
    # Only ever the caller's own employee: the route has no ID that could point at someone else.
    data = file.file.read(profile_photo_service.MAX_UPLOAD_BYTES + 1)
    url = profile_photo_service.save_photo(account_service.own_employee(actor), data, db)
    return {"profile_image_url": url}


@router.delete("/me/profile-photo", response_model=schemas.ProfilePhotoResponse)
def delete_my_profile_photo(db: Session = Depends(get_db),
                            actor: models.User = Depends(require_permission("settings.manage_self"))):
    profile_photo_service.remove_photo(account_service.own_employee(actor), db)
    return {"profile_image_url": None}


@router.get("/photos/{photo_id}.jpg", include_in_schema=False)
def get_profile_photo(photo_id: str, db: Session = Depends(get_db)):
    photo = profile_photo_service.find_servable_photo(photo_id, db)
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(content=photo.content, media_type=photo.content_type, headers={
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/me/security", response_model=schemas.SecuritySettingsResponse)
def get_my_security(actor: models.User = Depends(require_permission("settings.read"))):
    return account_service.get_my_security(actor=actor)


@router.post("/me/security/password-reset", response_model=schemas.SettingsActionResponse)
def reset_my_password(db: Session = Depends(get_db),
                      actor: models.User = Depends(require_permission("settings.manage_self"))):
    auth0_management.send_password_reset(actor.id, actor.auth0_user_id, actor.email, db)
    return {"message": "If your account uses a password, a reset link was sent."}


@router.get("/me/preferences", response_model=schemas.PreferencesResponse)
def get_my_preferences(db: Session = Depends(get_db),
                       actor: models.User = Depends(require_permission("settings.read"))):
    return preferences_service.get_preferences(actor.id, db)


@router.patch("/me/preferences", response_model=schemas.PreferencesResponse)
def patch_my_preferences(update: schemas.PreferencesUpdate, db: Session = Depends(get_db),
                         actor: models.User = Depends(require_permission("settings.manage_self"))):
    return preferences_service.update_preferences(actor, update, db)
