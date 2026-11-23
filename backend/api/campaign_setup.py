"""Campaign setup: participating groups, evaluation rules, the evaluation matrix, self-evaluations and issuing planned work."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import models
import schemas
from api.dependencies import get_db, require_permission
from services import campaign_setup_service

router = APIRouter()


@router.get("/campaigns/{campaign_id}/groups", response_model=schemas.CampaignGroupsResponse)
def get_campaign_groups(campaign_id: int, db: Session = Depends(get_db),
                        _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_setup_service.get_campaign_groups(campaign_id=campaign_id, db=db)


@router.put("/campaigns/{campaign_id}/groups", response_model=schemas.CampaignGroupsResponse)
def update_campaign_groups(campaign_id: int, payload: schemas.CampaignGroupsUpdate, db: Session = Depends(get_db),
                           manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_setup_service.update_campaign_groups(campaign_id=campaign_id, payload=payload, db=db, manager=manager)


@router.get("/campaigns/{campaign_id}/self-evaluations", response_model=schemas.CampaignSelfEvaluationsResponse)
def get_campaign_self_evaluations(campaign_id: int, db: Session = Depends(get_db),
                                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_setup_service.get_campaign_self_evaluations(campaign_id=campaign_id, db=db)


@router.put("/campaigns/{campaign_id}/self-evaluations", response_model=schemas.CampaignSelfEvaluationsResponse)
def update_campaign_self_evaluations(campaign_id: int, payload: schemas.CampaignSelfEvaluationsUpdate, db: Session = Depends(get_db),
                                      manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_setup_service.update_campaign_self_evaluations(campaign_id=campaign_id, payload=payload, db=db, manager=manager)


@router.get("/campaigns/{campaign_id}/evaluation-rules", response_model=schemas.CampaignEvaluationRulesResponse)
def get_campaign_evaluation_rules(campaign_id: int, db: Session = Depends(get_db),
                                  _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_setup_service.get_campaign_evaluation_rules(campaign_id=campaign_id, db=db)


@router.put("/campaigns/{campaign_id}/evaluation-rules", response_model=schemas.CampaignEvaluationRulesResponse)
def update_campaign_evaluation_rules(campaign_id: int, payload: schemas.CampaignEvaluationRulesUpdate, db: Session = Depends(get_db),
                                      manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_setup_service.update_campaign_evaluation_rules(campaign_id=campaign_id, payload=payload, db=db, manager=manager)


@router.get("/campaigns/{campaign_id}/evaluation-matrix", response_model=schemas.CampaignEvaluationMatrixResponse)
def get_campaign_evaluation_matrix(campaign_id: int, db: Session = Depends(get_db),
                                   _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_setup_service.get_campaign_evaluation_matrix(campaign_id=campaign_id, db=db)


@router.put("/campaigns/{campaign_id}/evaluation-matrix", response_model=schemas.CampaignEvaluationMatrixUpdateResponse)
def update_campaign_evaluation_matrix(campaign_id: int, payload: schemas.CampaignEvaluationMatrixUpdate, db: Session = Depends(get_db),
                                       manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_setup_service.update_campaign_evaluation_matrix(campaign_id=campaign_id, payload=payload, db=db, manager=manager)


@router.post("/campaigns/{campaign_id}/issue-planned", response_model=schemas.CampaignEvaluationMatrixResponse)
def issue_ready_campaign_evaluations(campaign_id: int, db: Session = Depends(get_db),
                                     manager: models.User = Depends(require_permission("campaigns.manage"))):
    return campaign_setup_service.issue_ready_campaign_evaluations(campaign_id=campaign_id, db=db, manager=manager)


@router.get("/campaigns/{campaign_id}/setup-preview", response_model=schemas.CampaignSetupPreviewResponse)
def get_campaign_setup_preview(campaign_id: int, group_ids: list[int] = Query(default=[]),
                               db: Session = Depends(get_db),
                               _reader: models.User = Depends(require_permission("campaigns.read"))):
    return campaign_setup_service.get_campaign_setup_preview(campaign_id=campaign_id, group_ids=group_ids, db=db)


@router.put("/campaigns/{campaign_id}/setup", response_model=schemas.CampaignEvaluationMatrixResponse)
def update_campaign_setup(campaign_id: int, payload: schemas.CampaignSetupUpdate, db: Session = Depends(get_db),
                          manager: models.User = Depends(require_permission("campaigns.manage"))):
    """Replace a draft/scheduled configuration in one transaction, without issuing forms."""
    return campaign_setup_service.update_campaign_setup(campaign_id=campaign_id, payload=payload, db=db, manager=manager)
