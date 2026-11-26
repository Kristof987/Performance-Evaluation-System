from io import BytesIO
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import models
from services import profile_photo_service as service
from database import SessionLocal
from api.dependencies import get_current_user, get_db
from main import app


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        app.dependency_overrides.clear()
        session.rollback()
        session.close()


def image_bytes(image_format="PNG", size=(400, 300), mode="RGBA", **save_options):
    output = BytesIO()
    Image.new(mode, size, (200, 30, 30, 128) if mode == "RGBA" else 128).save(output, format=image_format, **save_options)
    return output.getvalue()


def make_employee(db, *permissions, active=True):
    suffix = uuid4().hex
    role = models.SystemRole(name=f"Photo role {suffix}")
    company_role = models.CompanyRole(name=f"Photo company role {suffix}")
    db.add_all([role, company_role])
    db.flush()
    for name in permissions:
        permission = db.query(models.SystemPermission).filter(models.SystemPermission.name == name).first()
        if permission is None:
            permission = models.SystemPermission(name=name)
            db.add(permission)
            db.flush()
        db.execute(models.system_role_permissions.insert().values(system_role_id=role.id, permission_id=permission.id))
    user = models.User(username=f"photo-{suffix}", email=f"{suffix}@example.com", password_hash="",
                       system_role_id=role.id, is_active=True)
    db.add(user)
    db.flush()
    employee = models.Employee(user_id=user.id, full_name=f"Photo {suffix}", company_role_id=company_role.id,
                               is_active=active)
    db.add(employee)
    db.flush()
    db.refresh(user)
    return user, employee


def test_image_is_cropped_reencoded_and_stripped():
    exif = Image.Exif()
    exif[0x010F] = "Secret Phone"  # Camera make; any metadata must disappear.
    source = image_bytes("JPEG", size=(800, 400), mode="RGB", exif=exif.tobytes())
    result = Image.open(BytesIO(service.process_image(source)))
    assert result.format == "JPEG" and result.size == (256, 256)
    assert "exif" not in result.info


def test_transparent_png_is_accepted():
    result = Image.open(BytesIO(service.process_image(image_bytes("PNG"))))
    assert result.mode == "RGB" and result.size == (256, 256)


@pytest.mark.parametrize("data, status", [
    (b"", 400),
    (b"not an image at all", 400),
    (image_bytes("GIF", mode="L"), 400),
    (image_bytes("WEBP"), 400),
    (b"0" * (service.MAX_UPLOAD_BYTES + 1), 413),
])
def test_invalid_uploads_are_rejected(data, status):
    with pytest.raises(HTTPException) as error:
        service.process_image(data)
    assert error.value.status_code == status


def test_huge_dimensions_are_rejected():
    with pytest.raises(HTTPException) as error:
        service.process_image(image_bytes("PNG", size=(7000, 6000), mode="L"))
    assert error.value.status_code == 400


def test_replacing_a_photo_invalidates_the_old_url(db):
    _user, employee = make_employee(db)
    first = service.save_photo(employee, image_bytes(), db)
    second = service.save_photo(employee, image_bytes(), db)
    assert first != second and second == employee.profile_image_url
    old_id, new_id = first.split("/")[-1][:-4], second.split("/")[-1][:-4]
    assert service.find_servable_photo(old_id, db) is None
    assert service.find_servable_photo(new_id, db) is not None
    service.remove_photo(employee, db)
    assert employee.profile_image_url is None and service.find_servable_photo(new_id, db) is None


def test_inactive_employee_photo_is_not_served(db):
    _user, employee = make_employee(db)
    photo_id = service.save_photo(employee, image_bytes(), db).split("/")[-1][:-4]
    employee.is_active = False
    db.flush()
    assert service.find_servable_photo(photo_id, db) is None
    assert service.find_servable_photo("../../etc/passwd", db) is None


def test_upload_and_serve_through_the_api(db):
    user, employee = make_employee(db, "settings.manage_self")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    uploaded = client.put("/me/profile-photo", files={"file": ("me.png", image_bytes(), "image/png")})
    assert uploaded.status_code == 200
    url = uploaded.json()["profile_image_url"]
    assert url == employee.profile_image_url and url.startswith("/photos/")

    app.dependency_overrides.pop(get_current_user)  # Serving needs no sign-in.
    served = client.get(url)
    assert served.status_code == 200 and served.headers["content-type"] == "image/jpeg"
    assert served.headers["x-content-type-options"] == "nosniff"

    app.dependency_overrides[get_current_user] = lambda: user
    assert client.delete("/me/profile-photo").json() == {"profile_image_url": None}
    assert client.get(url).status_code == 404
    client.close()


def test_upload_requires_permission_and_sign_in(db):
    user, _employee = make_employee(db)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    assert client.put("/me/profile-photo", files={"file": ("me.png", image_bytes(), "image/png")}).status_code == 401
    app.dependency_overrides[get_current_user] = lambda: user
    assert client.put("/me/profile-photo", files={"file": ("me.png", image_bytes(), "image/png")}).status_code == 403
    client.close()
