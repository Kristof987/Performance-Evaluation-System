from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import engine, Base, SessionLocal
import models
import schemas

#Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.post("/users", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    new_user = models.User(
        username=user.username,
        email=user.email,
        password_hash=user.password,  # ezt mindjárt javítjuk hashelésre
        company_role_id=user.company_role_id,
        system_role_id=user.system_role_id,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@app.post("/login", response_model=schemas.UserResponse)
def login(user_login: schemas.UserLogin, db: Session = Depends(get_db)):
    user = (
        db.query(models.User)
        .filter(models.User.username == user_login.username.strip())
        .filter(models.User.is_active.is_(True))
        .first()
    )

    if user is None:
        raise HTTPException(status_code=401, detail="Nem letezo vagy inaktiv user")

    user.last_login = func.now()
    db.commit()
    db.refresh(user)

    return user


@app.get("/campaigns", response_model=list[schemas.CampaignResponse])
def get_campaigns(db: Session = Depends(get_db)):
    return (
        db.query(models.Campaign)
        .order_by(models.Campaign.is_active.desc(), models.Campaign.start_date.desc())
        .all()
    )


@app.get("/campaigns/{campaign_id}", response_model=schemas.CampaignResponse)
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign = (
        db.query(models.Campaign)
        .filter(models.Campaign.id == campaign_id)
        .first()
    )

    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return campaign


@app.post("/campaigns", response_model=schemas.CampaignResponse)
def create_campaign(campaign: schemas.CampaignCreate, db: Session = Depends(get_db)):
    creator = (
        db.query(models.User)
        .filter(models.User.id == campaign.created_by)
        .filter(models.User.is_active.is_(True))
        .first()
    )

    if creator is None:
        raise HTTPException(status_code=400, detail="Invalid campaign creator")

    new_campaign = models.Campaign(
        name=campaign.name,
        description=campaign.description,
        start_date=campaign.start_date,
        end_date=campaign.end_date,
        is_active=campaign.is_active,
        comment=campaign.comment,
        created_by=campaign.created_by,
    )

    db.add(new_campaign)
    db.commit()
    db.refresh(new_campaign)

    return new_campaign
