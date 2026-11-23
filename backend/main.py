from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import (
    ai_analysis,
    auth,
    campaign_emails,
    campaign_setup,
    campaigns,
    dashboard,
    evaluations,
    forms,
    me,
    people,
    reports,
    sections,
    workspace,
)
from services import ai_generation_jobs


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

# The order matters: FastAPI matches routes in registration order, so a more
# specific path must be included before a router with an overlapping pattern.
ROUTERS = (
    auth,
    me,
    workspace,
    people,
    forms,
    sections,
    campaign_emails,
    campaigns,
    campaign_setup,
    dashboard,
    evaluations,
    ai_analysis,
    reports,
)

for module in ROUTERS:
    app.include_router(module.router)
