from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services import ai_generation_jobs
from api import auth as auth_router
from api import me as me_router
from api import workspace as workspace_router
from api import people as people_router
from api import forms as forms_router
from api import sections as sections_router
from api import campaign_emails as campaign_emails_router
from api import campaigns as campaigns_router
from api import campaign_setup as campaign_setup_router
from api import dashboard as dashboard_router
from api import evaluations as evaluations_router
from api import ai_analysis as ai_analysis_router
from api import reports as reports_router

#Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop, worker = ai_generation_jobs.start_worker()
    try:
        yield
    finally:
        stop.set()
        worker.join(timeout=1)


app = FastAPI(lifespan=lifespan)

FRONTEND_URL = os.getenv("FRONTEND_URL")

allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if FRONTEND_URL:
    allowed_origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




app.include_router(auth_router.router)
app.include_router(me_router.router)
app.include_router(workspace_router.router)


app.include_router(people_router.router)


app.include_router(forms_router.router)
app.include_router(sections_router.router)


app.include_router(campaign_emails_router.router)
app.include_router(campaigns_router.router)


app.include_router(campaign_setup_router.router)


app.include_router(dashboard_router.router)
app.include_router(evaluations_router.router)


app.include_router(ai_analysis_router.router)
app.include_router(reports_router.router)
