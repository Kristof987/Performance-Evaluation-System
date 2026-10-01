from datetime import datetime

from pydantic import BaseModel, EmailStr

# --------------------
# Company Role
# --------------------

class CompanyRoleCreate(BaseModel):
    name: str
    description: str | None = None


class CompanyRoleResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }


# --------------------
# System Permission
# --------------------

class SystemPermissionCreate(BaseModel):
    name: str
    description: str | None = None


class SystemPermissionResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }


# --------------------
# System Role
# --------------------

class SystemRoleCreate(BaseModel):
    name: str
    description: str | None = None


class SystemRoleResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {
        "from_attributes": True
    }


# --------------------
# User
# --------------------

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    company_role_id: int
    system_role_id: int


class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr
    company_role_id: int
    system_role_id: int
    profile_image_url: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_login: datetime | None

    model_config = {
        "from_attributes": True
    }