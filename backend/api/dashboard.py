"""The HR home page: campaign overview, participants, deadlines and upcoming reviews."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import dashboard_service

router = APIRouter()


@router.get("/dashboard", response_model=schemas.DashboardResponse)
def get_dashboard(campaign_id: int | None = Query(default=None), db: Session = Depends(get_db),
                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    return dashboard_service.get_dashboard(campaign_id=campaign_id, db=db)
