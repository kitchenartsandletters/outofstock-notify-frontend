from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.interest import router as interest_router
from app.routes.reports import router as reports_router
from app.routes.campaign_stats import router as campaign_stats_router
from app.routes.campaign_responses import router as campaign_responses_router
from app.routes.notes import router as notes_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://admin.kitchenartsandletters.com",
                   "https://www.kitchenartsandletters.com",
                   "http://localhost:5173"
                   ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the interest route
app.include_router(interest_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(campaign_stats_router, prefix="/api")
app.include_router(campaign_responses_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
