"""Employee profile photos: validated, cropped to a square, re-encoded and stored in the database.

Photos are served from an unguessable URL (/photos/<random id>.jpg) without sign-in, because an
<img> tag cannot send the API token. Replacing or removing a photo deletes the old ID, and photos
of inactive employees are not served.
"""

from io import BytesIO
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image, ImageOps
from sqlalchemy.orm import Session

import models


MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 40_000_000  # Rejects "decompression bomb" images that are small files but huge in memory.
OUTPUT_SIZE = 256
ALLOWED_FORMATS = {"JPEG", "PNG"}


def photo_url(photo_id: str) -> str:
    return f"/photos/{photo_id}.jpg"


def process_image(data: bytes) -> bytes:
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The image must be 5 MB or smaller")
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=400, detail="Upload a JPG or PNG image")
            if image.width * image.height > MAX_PIXELS:
                raise HTTPException(status_code=400, detail="The image dimensions are too large")
            rgba = ImageOps.exif_transpose(image).convert("RGBA")
            square = ImageOps.fit(rgba, (OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS)
    except (Image.DecompressionBombError, OSError, ValueError, SyntaxError) as exc:
        raise HTTPException(status_code=400, detail="The file is not a valid image") from exc
    photo = Image.new("RGB", square.size, "white")
    photo.paste(square, mask=square.getchannel("A"))
    output = BytesIO()
    photo.save(output, format="JPEG", quality=85)
    return output.getvalue()


def save_photo(employee: models.Employee, data: bytes, db: Session) -> str:
    content = process_image(data)
    db.query(models.ProfilePhoto).filter(models.ProfilePhoto.employee_id == employee.id).delete()
    photo = models.ProfilePhoto(id=uuid4().hex, employee_id=employee.id, content=content, content_type="image/jpeg")
    db.add(photo)
    employee.profile_image_url = photo_url(photo.id)
    db.commit()
    return employee.profile_image_url


def remove_photo(employee: models.Employee, db: Session) -> None:
    db.query(models.ProfilePhoto).filter(models.ProfilePhoto.employee_id == employee.id).delete()
    employee.profile_image_url = None
    db.commit()


def find_servable_photo(photo_id: str, db: Session) -> models.ProfilePhoto | None:
    if len(photo_id) != 32 or not all(char in "0123456789abcdef" for char in photo_id):
        return None
    return (db.query(models.ProfilePhoto)
            .join(models.Employee, models.Employee.id == models.ProfilePhoto.employee_id)
            .filter(models.ProfilePhoto.id == photo_id, models.Employee.is_active.is_(True))
            .first())
